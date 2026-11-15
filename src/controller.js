// Tab Lock — core logic. `createController(api)` returns event handlers; sw.js wires
// them to chrome.* events. All state lives in chrome.storage (MV3 service workers are
// killed after ~30 s idle, so nothing important may live in a variable).
//
// chrome.storage.local (disk):   pinRec, keyRec, oldKeys, settings, backoff, lock,
//                                vault (sealed chunks: NORMAL windows only), notice
// chrome.storage.session (RAM):  pvault (sealed private-window chunks), ephemeral,
//                                graces, gates, optionsUntil, lockTabId,
//                                unfocusedSince, startupUntil
// chrome.storage.managed:        masterPin (from the optional macOS installer)
//
// Lock phases: unlocked → locking → locked → unlocking → unlocked.

import * as C from './crypto.js';
import * as B from './backoff.js';
import { sanitize } from './settings.js';
import { needsGate, classify } from './guard.js';
import { managedPinRecord } from './policy.js';
import { captureWindows, restoreWindows, restorableUrl, tabCount } from './vault.js';

export const LOCK_PAGE = 'src/pages/lock.html';
export const ONBOARDING_PAGE = 'src/pages/onboarding.html';
export const ALARM = 'tablock-tick';
export const ALARM_PERIOD_MIN = 0.5;
export const STARTUP_CAPTURE_MS = 30_000;
export const STARTUP_SWEEPS_MS = [1500, 4000, 8000, 15000];
const MAX_CHUNKS = 64;

export function createController(api, { now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const local = api.storage.local;
  const session = api.storage.session;
  const ownOrigin = api.runtime.getURL('');
  const lockUrl = api.runtime.getURL(LOCK_PAGE);
  const isOwnUrl = (u) => typeof u === 'string' && u.startsWith(ownOrigin);
  const isLockUrl = (u) => typeof u === 'string' && u.startsWith(lockUrl);

  // Serialise state-changing operations within this worker instance.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  let creatingLockPage = false;

  // ---- storage helpers --------------------------------------------------------------
  const getL = async (k) => (await local.get(k))[k];
  const getS = async (k) => (await session.get(k))[k];
  const settings = async () => sanitize(await getL('settings'));

  async function managedRecord() {
    try {
      return managedPinRecord(await api.storage.managed.get('masterPin'));
    } catch {
      return null; // no policy / schema → not managed
    }
  }
  async function pinRecord() {
    const m = await managedRecord();
    if (m) return { rec: m, managed: true };
    const rec = await getL('pinRec');
    return rec ? { rec, managed: false } : { rec: null, managed: false };
  }
  async function phase() {
    return (await getL('lock'))?.phase || 'unlocked';
  }
  const isLockedPhase = (p) => p === 'locked' || p === 'locking';

  // ---- key handling ------------------------------------------------------------------
  /** Managed master PIN present, but this profile hasn't been opened with it yet. */
  async function managedSetupPending() {
    const m = await managedRecord();
    if (!m) return false;
    const keyRec = await getL('keyRec');
    return !keyRec || keyRec.boundTo !== C.recordId(m);
  }

  async function ephemeralRecipient() {
    let eph = await getS('ephemeral');
    if (!eph) {
      eph = await C.createEphemeralKeyPair();
      await session.set({ ephemeral: eph });
    }
    return { pub: eph.pub, kid: 'session' };
  }

  /**
   * Public keys to seal to at lock time (the PIN isn't known then).
   * Normally: this profile's key. While a newly installed master PIN hasn't been entered
   * in this profile yet, ALSO a memory-only key, so that unlocking with the master PIN in
   * this browser session reopens the tabs without needing the old per-profile PIN.
   */
  async function sealingRecipients() {
    const keyRec = await getL('keyRec');
    const out = [];
    if (keyRec) out.push({ pub: keyRec.pub, kid: keyRec.kid });
    if (!keyRec || (await managedSetupPending())) out.push(await ephemeralRecipient());
    return out;
  }

  /** After a verified secret: ensure a key record bound to the current PIN record. */
  async function currentPrivateKey(secret, rec) {
    const id = C.recordId(rec);
    let keyRec = await getL('keyRec');
    if (keyRec) {
      try {
        const key = await C.unwrapPrivateKey(keyRec, secret);
        if (keyRec.boundTo !== id) {
          keyRec = { ...keyRec, boundTo: id };
          await local.set({ keyRec });
        }
        return { key, kid: keyRec.kid };
      } catch {
        // Master PIN changed by the installer: the old key can't be opened with the new
        // PIN. Retire it (its chunks need the previous PIN) and start a new one.
        const oldKeys = (await getL('oldKeys')) || {};
        oldKeys[keyRec.kid] = keyRec;
        await local.set({ oldKeys });
      }
    }
    keyRec = { ...(await C.createKeyRecord(secret, id)), kid: C.toB64(C.randomBytes(9)) };
    await local.set({ keyRec });
    return { key: await C.unwrapPrivateKey(keyRec, secret), kid: keyRec.kid };
  }

  // ---- backoff-wrapped verification ------------------------------------------------
  async function checkSecret(secret, rec) {
    const bo = B.normalize(await getL('backoff'));
    const wait = B.waitMs(bo, now());
    if (wait > 0) return { ok: false, error: 'backoff', waitMs: wait, failures: bo.failures };
    const ok = await C.verifySecret(secret, rec);
    if (ok) {
      await local.set({ backoff: B.recordSuccess() });
      return { ok: true };
    }
    const next = B.recordFailure(bo, now());
    await local.set({ backoff: next });
    let wiped = false;
    if (B.shouldWipe(next, await settings())) {
      await local.remove(['vault', 'oldKeys']);
      await session.remove(['pvault']);
      await local.set({ notice: 'wiped' });
      wiped = true;
    }
    return { ok: false, error: 'wrong', waitMs: B.waitMs(next, now()), failures: next.failures, wiped };
  }

  // ---- lock page -------------------------------------------------------------------
  async function ensureLockPage() {
    const id = await getS('lockTabId');
    if (Number.isInteger(id)) {
      try {
        const t = await api.tabs.get(id);
        if (isLockUrl(t.pendingUrl || t.url) && !t.incognito) {
          await api.windows.update(t.windowId, { focused: true }).catch(() => {});
          return t;
        }
      } catch { /* gone */ }
    }
    const all = await api.tabs.query({});
    const existing = all.find((t) => !t.incognito && isLockUrl(t.pendingUrl || t.url));
    if (existing) {
      await session.set({ lockTabId: existing.id });
      return existing;
    }
    creatingLockPage = true;
    try {
      const win = await api.windows.create({ url: lockUrl, focused: true, type: 'normal', state: 'maximized' });
      const tab = win.tabs?.[0];
      if (tab) await session.set({ lockTabId: tab.id });
      return tab;
    } finally {
      creatingLockPage = false;
    }
  }

  // Close TABS, not windows: Brave's "confirm before closing a window with multiple
  // tabs" dialog (pref brave.enable_window_closing_confirm) makes windows.remove resolve
  // while the window stays open. Removing a window's last tab closes it without that.
  async function closeAllExceptLock(lockTab) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ids = (await api.tabs.query({})).filter((t) => t.id !== lockTab?.id).map((t) => t.id);
      if (!ids.length) return true;
      await api.tabs.remove(ids).catch(() => {});
    }
    return (await api.tabs.query({})).every((t) => t.id === lockTab?.id);
  }

  async function appendChunk(area, key, windows) {
    if (!windows.length) return;
    const chunk = { ...(await C.sealFor(windows, await sealingRecipients())), at: now(), tabs: tabCount(windows) };
    const store = area === 'local' ? local : session;
    const list = ((await store.get(key))[key] || []).slice(-(MAX_CHUNKS - 1));
    list.push(chunk);
    await store.set({ [key]: list });
    const back = (await store.get(key))[key] || [];
    if (back.length !== list.length) throw new Error('vault write could not be verified');
  }

  // ---- lock --------------------------------------------------------------------------
  function lock(reason = 'manual') {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const p = await phase();
      if (p === 'locked') {
        await sweepWhileLocked(await ensureLockPage());
        return { ok: true, already: true };
      }
      await local.set({ lock: { phase: 'locking', since: now(), reason } });
      let saveError = null;
      try {
        const normal = await captureWindows(api, { incognito: false, isOwnUrl });
        await appendChunk('local', 'vault', normal);
        let incognito = [];
        try { incognito = await captureWindows(api, { incognito: true, isOwnUrl }); } catch { /* no private access */ }
        await appendChunk('session', 'pvault', incognito); // memory only — never disk
      } catch (e) {
        saveError = String(e?.message || e);
      }
      const lockTab = await ensureLockPage();
      if (saveError) {
        // Never close tabs we failed to save. The lock page still covers the browser.
        await local.set({ lock: { phase: 'locked', since: now(), reason }, notice: 'save-failed' });
        return { ok: false, error: 'save-failed', detail: saveError };
      }
      await closeAllExceptLock(lockTab);
      await local.set({ lock: { phase: 'locked', since: now(), reason } });
      await session.remove(['unfocusedSince']);
      return { ok: true };
    });
  }

  const worthSaving = (u) => !!restorableUrl(u) && !isOwnUrl(u) && !/^chrome:\/\/newtab\/?$/i.test(u);

  /**
   * Already locked: close everything but the lock page. Within STARTUP_CAPTURE_MS of
   * browser start, tabs Brave restored (possibly before our listeners existed) are
   * vaulted first. If saving fails, they are left open rather than lost.
   */
  async function sweepWhileLocked(lockTab) {
    const startupUntil = await getS('startupUntil');
    if (startupUntil && now() < startupUntil) {
      const keepWorth = (ws) => ws.map((w) => ({ ...w, tabs: w.tabs.filter((t) => worthSaving(t.url)) })).filter((w) => w.tabs.length);
      try {
        await appendChunk('local', 'vault', keepWorth(await captureWindows(api, { incognito: false, isOwnUrl })));
        let inc = [];
        try { inc = await captureWindows(api, { incognito: true, isOwnUrl }); } catch { /* no private access */ }
        await appendChunk('session', 'pvault', keepWorth(inc));
      } catch {
        return false;
      }
    }
    return closeAllExceptLock(lockTab);
  }

  // ---- restore -----------------------------------------------------------------------
  /** Restore every chunk we hold a key for. Chunks are deleted only after success. */
  async function restoreAll(keys) {
    const result = { restoredWindows: 0, failedTabs: [], errors: [] };
    for (const [area, key] of [['local', 'vault'], ['session', 'pvault']]) {
      const store = area === 'local' ? local : session;
      const list = ((await store.get(key))[key]) || [];
      const keep = [];
      for (const chunk of list) {
        if (!C.sealedKids(chunk).some((kid) => keys[kid])) { keep.push(chunk); continue; }
        try {
          const windows = await C.openWithAny(chunk, keys);
          const cats = new Set();
          for (const w of windows) for (const t of w.tabs) { const c = classify(t.url); if (c) cats.add(c); }
          // The user just proved the PIN: don't bounce restored protected pages.
          await grantGraces(cats);
          const r = await restoreWindows(api, windows);
          result.restoredWindows += r.windowIds.length;
          result.failedTabs.push(...r.failedTabs);
        } catch (e) {
          keep.push(chunk);
          result.errors.push(String(e?.message || e));
        }
      }
      if (keep.length) await store.set({ [key]: keep });
      else await store.remove(key);
    }
    return result;
  }

  async function keysFor(secret, rec) {
    const cur = await currentPrivateKey(secret, rec);
    const keys = { [cur.kid]: cur.key };
    const eph = await getS('ephemeral');
    if (eph) keys.session = await C.importEphemeralPrivate(eph.priv);
    return keys;
  }

  async function grantGraces(cats) {
    if (!cats.size) return;
    const s = await settings();
    const graces = (await getS('graces')) || {};
    for (const c of cats) graces[c] = now() + s.graceMin * 60_000;
    await session.set({ graces });
  }

  async function finishUnlock(result) {
    await refreshBadge(); // e.g. master-PIN setup just completed by this unlock
    const pending = await pendingInfo();
    const problem = result.errors.length || result.failedTabs.length || pending.oldChunks || pending.lostChunks;
    await local.set({ lock: { phase: 'unlocked', since: now() } });
    await session.remove(['startupUntil']);
    if (result.errors.length) await local.set({ notice: 'restore-failed' });
    const lockTabId = await getS('lockTabId');
    if (!problem && Number.isInteger(lockTabId)) {
      if (result.restoredWindows > 0) await api.tabs.remove(lockTabId).catch(() => {});
      else await api.tabs.update(lockTabId, { url: 'chrome://newtab/' }).catch(() => {});
      await session.remove(['lockTabId']);
    }
    return {
      ok: true,
      restoredWindows: result.restoredWindows,
      failedTabs: result.failedTabs,
      restoreErrors: result.errors.length,
      ...pending,
    };
  }

  function unlock(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      await local.set({ lock: { phase: 'unlocking', since: now() } });
      const keys = await keysFor(secret, rec);
      return finishUnlock(await restoreAll(keys));
    });
  }

  /** "Retry restore" (unlocked or locked) — needs the PIN again (keys aren't kept). */
  function retryRestore(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const wasLocked = isLockedPhase(await phase());
      if (wasLocked) await local.set({ lock: { phase: 'unlocking', since: now() } });
      return finishUnlock(await restoreAll(await keysFor(secret, rec)));
    });
  }

  /** Restore chunks sealed before a master-PIN change, using the previous PIN. */
  function recoverOld(oldSecret) {
    return serial(async () => {
      const bo = B.normalize(await getL('backoff'));
      const wait = B.waitMs(bo, now());
      if (wait > 0) return { ok: false, error: 'backoff', waitMs: wait };
      const oldKeys = (await getL('oldKeys')) || {};
      const keys = {};
      for (const [kid, kr] of Object.entries(oldKeys)) {
        try { keys[kid] = await C.unwrapPrivateKey(kr, oldSecret); } catch { /* not this one */ }
      }
      if (!Object.keys(keys).length) {
        const next = B.recordFailure(bo, now());
        await local.set({ backoff: next });
        return { ok: false, error: 'wrong', waitMs: B.waitMs(next, now()), failures: next.failures };
      }
      await local.set({ backoff: B.recordSuccess() });
      const result = await restoreAll(keys);
      for (const kid of Object.keys(keys)) if (!result.errors.length) delete oldKeys[kid];
      await local.set({ oldKeys });
      await pruneOldKeys();
      return finishUnlock(result);
    });
  }

  /** Discard chunks that can't be opened (old PIN forgotten, or memory-only key lost). */
  function discardUnopenable(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const cur = (await getL('keyRec'))?.kid;
      const eph = await getS('ephemeral');
      const usable = (c) => C.sealedKids(c).some((kid) => kid === cur || (kid === 'session' && eph));
      const vault = ((await getL('vault')) || []).filter(usable);
      const pvault = ((await getS('pvault')) || []).filter(usable);
      await (vault.length ? local.set({ vault }) : local.remove('vault'));
      await (pvault.length ? session.set({ pvault }) : session.remove('pvault'));
      await local.remove('oldKeys');
      return finishUnlock({ restoredWindows: 0, failedTabs: [], errors: [] });
    });
  }

  async function pruneOldKeys() {
    const oldKeys = (await getL('oldKeys')) || {};
    const used = new Set([...((await getL('vault')) || []), ...((await getS('pvault')) || [])].flatMap((c) => C.sealedKids(c)));
    for (const kid of Object.keys(oldKeys)) if (!used.has(kid)) delete oldKeys[kid];
    await (Object.keys(oldKeys).length ? local.set({ oldKeys }) : local.remove('oldKeys'));
  }

  async function pendingInfo() {
    const vault = (await getL('vault')) || [];
    const pvault = (await getS('pvault')) || [];
    const cur = (await getL('keyRec'))?.kid;
    const oldKeys = (await getL('oldKeys')) || {};
    const eph = await getS('ephemeral');
    let savedChunks = 0, oldChunks = 0, lostChunks = 0, savedTabs = 0;
    for (const c of [...vault, ...pvault]) {
      savedChunks++;
      savedTabs += c.tabs || 0;
      const kids = C.sealedKids(c);
      if (kids.includes(cur) || (eph && kids.includes('session'))) continue;
      if (kids.some((kid) => oldKeys[kid])) oldChunks++;
      else lostChunks++;
    }
    return { savedChunks, savedTabs, oldChunks, lostChunks };
  }

  // ---- protected pages ---------------------------------------------------------------
  async function gate(tab, url) {
    const { rec } = await pinRecord();
    if (!rec || (await phase()) !== 'unlocked') return false;
    const s = await settings();
    const cat = needsGate(url, s.protect, await getS('graces'), now());
    if (!cat) return false;
    const token = C.toB64(C.randomBytes(12)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
    const gates = (await getS('gates')) || {};
    for (const [k, g] of Object.entries(gates)) if (now() - g.at > 10 * 60_000) delete gates[k];
    gates[token] = { tabId: tab.id, url, cat, at: now() };
    await session.set({ gates });
    await api.tabs.update(tab.id, { url: `${lockUrl}?gate=${token}` }).catch(() => {});
    return true;
  }

  function openGate(token, secret) {
    return serial(async () => {
      const gates = (await getS('gates')) || {};
      const g = gates[token];
      if (!g) return { ok: false, error: 'expired' };
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      await grantGraces(new Set([g.cat]));
      delete gates[token];
      await session.set({ gates });
      // Only ever navigate back to the internal URL we classified ourselves.
      if (classify(g.url) === g.cat) await api.tabs.update(g.tabId, { url: g.url }).catch(() => {});
      return { ok: true };
    });
  }

  // ---- tab/window event handlers -------------------------------------------------------
  async function onStrayTab(tab) {
    const url = tab.pendingUrl || tab.url || '';
    if (!tab.incognito && (isLockUrl(url) || creatingLockPage)) return;
    const p = await phase();
    if (!isLockedPhase(p)) return;
    if (p === 'locking') return; // lock() is capturing right now
    // Shortly after browser start, session-restore tabs can arrive after we locked:
    // vault them instead of losing them.
    const startupUntil = await getS('startupUntil');
    if (startupUntil && now() < startupUntil && worthSaving(url)) {
      const win = { incognito: !!tab.incognito, state: 'normal', bounds: {}, groups: {}, focused: false,
        tabs: [{ url, title: tab.title || '', pinned: !!tab.pinned, active: false, group: null }] };
      await serial(() => appendChunk(tab.incognito ? 'session' : 'local', tab.incognito ? 'pvault' : 'vault', [win])).catch(() => {});
    }
    const lockTabId = await getS('lockTabId');
    if (tab.id === lockTabId) await api.tabs.update(tab.id, { url: lockUrl }).catch(() => {});
    else await api.tabs.remove(tab.id).catch(() => {});
    await serial(ensureLockPage).catch(() => {});
  }

  async function onTabCreated(tab) {
    if (isLockedPhase(await phase())) return onStrayTab(tab);
    const url = tab.pendingUrl || tab.url;
    if (url) await gate(tab, url);
  }

  async function onTabUpdated(tabId, change, tab) {
    if (!change.url) return;
    if (isLockedPhase(await phase())) return onStrayTab(tab);
    await gate(tab, change.url);
  }

  async function onTabRemoved(tabId) {
    if (tabId !== (await getS('lockTabId'))) return;
    await session.remove(['lockTabId']);
    if ((await phase()) === 'locked') await serial(ensureLockPage).catch(() => {});
  }

  async function onFocusChanged(windowId) {
    if (windowId === api.windows.WINDOW_ID_NONE) {
      if (!(await getS('unfocusedSince'))) await session.set({ unfocusedSince: now() });
    } else {
      await session.remove(['unfocusedSince']);
    }
  }

  async function onIdleState(state) {
    if (state === 'idle' || state === 'locked') await lock(state === 'locked' ? 'screen-locked' : 'idle');
  }

  async function onAlarm(alarm) {
    if (alarm?.name !== ALARM) return;
    const p = await phase();
    if (p === 'locked') {
      await serial(async () => sweepWhileLocked(await ensureLockPage())).catch(() => {}); // safety net
      return;
    }
    if (p !== 'unlocked') return;
    const s = await settings();
    const since = await getS('unfocusedSince');
    if (s.lockOnUnfocus && since && now() - since >= s.timeoutMin * 60_000) await lock('unfocused');
  }

  /** Runs every time the worker wakes. Re-arms alarms/idle and repairs interrupted ops. */
  async function init() {
    const s = await settings();
    try { api.idle.setDetectionInterval(Math.max(15, s.timeoutMin * 60)); } catch { /* keep default */ }
    const a = await api.alarms.get(ALARM);
    if (!a) await api.alarms.create(ALARM, { periodInMinutes: ALARM_PERIOD_MIN });
    await refreshBadge();
    // chrome.storage.session is empty after every browser start, so a missing marker
    // means "fresh browser session" — more reliable than runtime.onStartup alone
    // (not delivered in every launch mode).
    if (!(await getS('startupDone'))) return startup();
    const p = await phase();
    if (p === 'locking' || p === 'unlocking') {
      // The worker died mid-operation. Treat as locked and re-run lock (append-only, so
      // nothing already saved is lost; at worst some tabs are saved twice).
      await local.set({ lock: { phase: 'unlocked', since: now() } });
      await lock('recovered');
    } else if (p === 'locked') {
      await serial(ensureLockPage).catch(() => {});
    } else {
      // Unknown focus state at wake-up: if no Brave window is focused, start counting.
      try {
        const w = await api.windows.getLastFocused();
        if (!w?.focused && !(await getS('unfocusedSince'))) await session.set({ unfocusedSince: now() });
      } catch { /* no windows */ }
      await promptManagedSetup();
    }
  }

  /**
   * A master PIN just arrived (or is still not entered in this profile): open the setup
   * page once per browser session so the user enters it right away. Until then, locks
   * also seal to a memory-only key (see sealingRecipients).
   */
  async function promptManagedSetup() {
    if ((await phase()) !== 'unlocked' || !(await managedSetupPending())) return;
    if (await getS('setupPrompted')) return;
    await session.set({ setupPrompted: now() });
    await api.tabs.create({ url: api.runtime.getURL(ONBOARDING_PAGE) }).catch(() => {});
  }

  async function onStorageChanged(changes, area) {
    if (area !== 'managed') return;
    await refreshBadge();
    await promptManagedSetup();
  }

  async function onStartup() {
    if (!(await getS('startupDone'))) await startup();
  }

  async function startup() {
    await session.set({ startupDone: now(), startupUntil: now() + STARTUP_CAPTURE_MS });
    const s = await settings();
    if (s.lockOnStartup || (await phase()) !== 'unlocked') {
      await lock('startup');
      // Brave can open tabs (session restore, command-line URLs) after onStartup and
      // before our listeners see them. Sweep a few times early on; the 30 s alarm is
      // the backstop. (Short timers are fine: the worker is kept alive by these events.)
      for (const ms of STARTUP_SWEEPS_MS) {
        schedule(() => serial(async () => {
          if ((await phase()) === 'locked') await sweepWhileLocked(await ensureLockPage());
        }).catch(() => {}), ms);
      }
    } else {
      await promptManagedSetup();
    }
  }

  async function onInstalled(details) {
    if (details?.reason === 'install') await api.tabs.create({ url: api.runtime.getURL(ONBOARDING_PAGE) });
  }

  async function refreshBadge() {
    const { rec } = await pinRecord();
    const needsSetup = !rec || (await managedSetupPending());
    try {
      await api.action.setBadgeText({ text: needsSetup ? '!' : '' });
      if (needsSetup) await api.action.setBadgeBackgroundColor({ color: '#b3261e' });
    } catch { /* action API optional in tests */ }
  }

  async function onActionClicked() {
    const { rec } = await pinRecord();
    if (rec) await lock('toolbar');
    else await api.tabs.create({ url: api.runtime.getURL(ONBOARDING_PAGE) });
  }

  async function onCommand(cmd) {
    if (cmd === 'lock-now') await lock('shortcut');
  }

  // ---- configuration -----------------------------------------------------------------
  async function optionsAuthorized() {
    const { rec } = await pinRecord();
    if (!rec) return true; // first run: nothing to protect yet
    return ((await getS('optionsUntil')) || 0) > now();
  }

  function authOptions(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: true };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const s = await settings();
      await session.set({ optionsUntil: now() + s.graceMin * 60_000 });
      return { ok: true };
    });
  }

  function setSecret({ current, next, kind }) {
    return serial(async () => {
      const { rec, managed } = await pinRecord();
      if (managed) return { ok: false, error: 'managed' };
      const bad = C.validateSecret(next, kind);
      if (bad) return { ok: false, error: 'invalid', message: bad };
      if (rec) {
        const chk = await checkSecret(current, rec);
        if (!chk.ok) return chk;
      }
      const newRec = await C.hashSecret(next, kind);
      let keyRec = await getL('keyRec');
      if (keyRec && rec) {
        keyRec = { ...(await C.rewrapKeyRecord(keyRec, current, next, C.recordId(newRec))), kid: keyRec.kid };
      } else {
        keyRec = { ...(await C.createKeyRecord(next, C.recordId(newRec))), kid: C.toB64(C.randomBytes(9)) };
      }
      await local.set({ pinRec: newRec, keyRec, backoff: B.initialBackoff() });
      await session.set({ optionsUntil: now() + (await settings()).graceMin * 60_000 });
      await refreshBadge();
      return { ok: true };
    });
  }

  /** Managed mode: one-time per-profile setup with the master PIN (creates the key pair). */
  function setupManaged(secret) {
    return serial(async () => {
      const { rec, managed } = await pinRecord();
      if (!managed) return { ok: false, error: 'not-managed' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      await currentPrivateKey(secret, rec);
      await refreshBadge();
      return { ok: true };
    });
  }

  async function saveSettings(input) {
    if (!(await optionsAuthorized())) return { ok: false, error: 'auth' };
    const s = sanitize(input);
    await local.set({ settings: s });
    try { api.idle.setDetectionInterval(Math.max(15, s.timeoutMin * 60)); } catch { /* ignore */ }
    return { ok: true, settings: s };
  }

  async function status(extra = {}) {
    const { rec, managed } = await pinRecord();
    const bo = B.normalize(await getL('backoff'));
    const out = {
      configured: !!rec,
      managed,
      managedSetupDone: managed ? !!(await getL('keyRec')) && (await getL('keyRec')).boundTo === C.recordId(rec) : null,
      kind: rec?.kind || null,
      phase: await phase(),
      waitMs: B.waitMs(bo, now()),
      failures: bo.failures,
      notice: (await getL('notice')) || null,
      ...(await pendingInfo()),
    };
    if (extra.gate) {
      const g = ((await getS('gates')) || {})[extra.gate];
      out.gate = g ? { cat: g.cat } : null;
    }
    if (extra.options) {
      out.optionsAuthorized = await optionsAuthorized();
      out.settings = out.optionsAuthorized ? await settings() : null;
    }
    try { out.incognitoAllowed = await api.extension.isAllowedIncognitoAccess(); } catch { out.incognitoAllowed = null; }
    return out;
  }

  // ---- messaging (own pages only) -------------------------------------------------------
  async function onMessage(msg, sender) {
    if (sender?.id !== api.runtime.id || !isOwnUrl(sender?.url || '')) return { ok: false, error: 'forbidden' };
    switch (msg?.type) {
      case 'status': return status({ gate: msg.gate, options: msg.options });
      case 'unlock': return unlock(String(msg.secret ?? ''));
      case 'retryRestore': return retryRestore(String(msg.secret ?? ''));
      case 'recoverOld': return recoverOld(String(msg.secret ?? ''));
      case 'discardUnopenable': return discardUnopenable(String(msg.secret ?? ''));
      case 'openGate': return openGate(String(msg.token ?? ''), String(msg.secret ?? ''));
      case 'authOptions': return authOptions(String(msg.secret ?? ''));
      case 'setSecret': return setSecret({ current: String(msg.current ?? ''), next: String(msg.next ?? ''), kind: msg.kind });
      case 'setupManaged': return setupManaged(String(msg.secret ?? ''));
      case 'saveSettings': return saveSettings(msg.settings);
      case 'clearNotice': await local.remove('notice'); return { ok: true };
      case 'lockNow': return lock('page');
      default: return { ok: false, error: 'unknown' };
    }
  }

  return {
    init, onStartup, onInstalled, onTabCreated, onTabUpdated, onTabRemoved, onFocusChanged,
    onIdleState, onAlarm, onActionClicked, onCommand, onMessage, onStorageChanged, lock, unlock, status,
    // exposed for tests
    _internal: { ensureLockPage, pendingInfo, phase },
  };
}
