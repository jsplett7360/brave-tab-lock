// Tab Lock — core logic. `createController(api)` returns event handlers; sw.js wires
// them to chrome.* events. All state lives in chrome.storage (MV3 service workers are
// killed after ~30 s idle, so nothing important may live in a variable).
//
// chrome.storage.local (disk):   pinRec, keyRec, oldKeys, recRec (recovery code record),
//                                settings, backoff, lock, notice,
//                                vault (Lockdown mode: sealed chunks, NORMAL windows only),
//                                hidden (default mode: sealed {token: {url,title}} chunks)
// chrome.storage.session (RAM):  pvault (sealed private-window chunks), ephemeral,
//                                graces, gates, optionsUntil, lockTabId, tabTokens,
//                                failedTabs, unfocusedSince, startupUntil
// chrome.storage.managed:        masterPin (from the optional macOS installer)
//
// Lock phases: unlocked → locking → locked → unlocking → unlocked.
// Two modes (settings.mode, copied into `lock` when locking):
//   'hide'     (default) every tab shows lock.html#<token> in place — keeps its Brave
//              Container, logins, group, pin and position. Optional scope 'sites'.
//   'lockdown' close + encrypt + reopen (the Vault). A `lock` record without `mode`
//              (written by 0.1.0/0.1.1) is a Lockdown lock.
// Private windows always use the close + memory-only path (extension pages can't load
// in private windows in "spanning" incognito mode).

import * as C from './crypto.js';
import * as B from './backoff.js';
import { sanitize, matchesSite } from './settings.js';
import * as H from './hide.js';
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
const MAX_HIDDEN_CHUNKS = 256;
export const HIDE_SETTLE_MS = 1000;  // then retry tabs a "Leave site?" prompt kept open
export const REVEAL_WAIT_MS = 2000;  // how long to wait for Back to land before navigating

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export function createController(api, { now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), sleep = sleepMs } = {}) {
  const local = api.storage.local;
  const session = api.storage.session;
  const ownOrigin = api.runtime.getURL('');
  const lockUrl = api.runtime.getURL(LOCK_PAGE);
  const isOwnUrl = (u) => typeof u === 'string' && u.startsWith(ownOrigin);
  const isLockUrl = (u) => typeof u === 'string' && u.startsWith(lockUrl);
  const isPlainLockUrl = (u) => u === lockUrl;
  const tokenOf = (u) => H.tokenFromUrl(u, lockUrl);
  const gateTokenOf = (u) => (isLockUrl(u) ? new URL(u).searchParams.get('gate') : null);
  const tabUrl = (t) => t?.pendingUrl || t?.url || '';

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
  async function lockState() {
    return (await getL('lock')) || { phase: 'unlocked' };
  }
  async function phase() {
    return (await lockState()).phase || 'unlocked';
  }
  const isLockedPhase = (p) => p === 'locked' || p === 'locking';
  const lockMode = (ls) => (ls?.mode === 'hide' ? 'hide' : 'lockdown');
  const isSitesLock = (ls) => lockMode(ls) === 'hide' && ls.scope === 'sites';
  const inLockScope = (ls, url) => !isSitesLock(ls) || matchesSite(url, ls.sites);
  async function setPhase(ph, extra = {}) {
    const ls = await lockState();
    const keep = ph === 'unlocked' ? {} : { reason: ls.reason, mode: ls.mode, scope: ls.scope, sites: ls.sites };
    await local.set({ lock: { ...keep, ...extra, phase: ph, since: now() } });
  }

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
  async function checkSecret(secret, rec, kinds) {
    const bo = B.normalize(await getL('backoff'));
    const wait = B.waitMs(bo, now());
    if (wait > 0) return { ok: false, error: 'backoff', waitMs: wait, failures: bo.failures };
    const ok = await C.verifySecret(secret, rec, kinds);
    if (ok) {
      await local.set({ backoff: B.recordSuccess() });
      return { ok: true };
    }
    const next = B.recordFailure(bo, now());
    await local.set({ backoff: next });
    let wiped = false;
    if (B.shouldWipe(next, await settings())) {
      await local.remove(['vault', 'oldKeys', 'hidden']);
      await session.remove(['pvault', 'tabTokens']);
      await local.set({ notice: 'wiped' });
      // Default mode: the hidden tabs still hold their pages in their Back history, so
      // erasing means closing them. Keep (or open) a plain lock page first.
      const all = await api.tabs.query({});
      const hiddenIds = all.filter((t) => tokenOf(tabUrl(t))).map((t) => t.id);
      if (hiddenIds.length) {
        if (!all.some((t) => isPlainLockUrl(tabUrl(t)))) await api.tabs.create({ url: lockUrl, active: true }).catch(() => {});
        await api.tabs.remove(hiddenIds).catch(() => {});
      }
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
      if (isSitesLock(await lockState())) {
        // Sites mode: the rest of the browser stays usable, so just add a tab.
        try {
          const tab = await api.tabs.create({ url: lockUrl, active: true });
          await session.set({ lockTabId: tab.id });
          return tab;
        } catch { /* no window to put it in — fall through */ }
      }
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
  const SHOW_LOCK_REASONS = new Set(['toolbar', 'shortcut', 'page']);

  function lock(reason = 'manual') {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const ls = await lockState();
      if (ls.phase === 'locked') {
        // Sites mode keeps the browser usable, so a lock page is only shown on request.
        if (isSitesLock(ls) && SHOW_LOCK_REASONS.has(reason)) await ensureLockPage();
        await sweep();
        return { ok: true, already: true };
      }
      await session.remove(['optionsUntil', 'graces']); // locking ends every PIN grace
      const s = await settings();
      return s.mode === 'hide' ? hideLock(reason, s) : lockdownLock(reason);
    });
  }

  /** Lockdown mode (the Vault): encrypt + close every tab; reopen them on unlock. */
  async function lockdownLock(reason) {
    await local.set({ lock: { phase: 'locking', since: now(), reason, mode: 'lockdown' } });
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
      await local.set({ lock: { phase: 'locked', since: now(), reason, mode: 'lockdown' }, notice: 'save-failed' });
      return { ok: false, error: 'save-failed', detail: saveError };
    }
    await closeAllExceptLock(lockTab);
    await local.set({ lock: { phase: 'locked', since: now(), reason, mode: 'lockdown' } });
    await session.remove(['unfocusedSince']);
    return { ok: true };
  }

  /**
   * Default mode: every tab in scope is navigated, in place, to lock.html#<token>.
   * Private-window tabs in scope are closed and kept in memory only (as in Lockdown).
   */
  async function hideLock(reason, s) {
    const info = { mode: 'hide', scope: s.scope, sites: s.scope === 'sites' ? s.sites : [] };
    const ls = { phase: 'locking', ...info };
    await local.set({ lock: { ...ls, since: now(), reason } });
    let saveError = null;
    let hidden = 0;
    try {
      const inc = await capturePrivate(ls);
      const all = await api.tabs.query({});
      hidden = await hideTabs(all.filter((t) => !t.incognito && hideCandidate(t, ls)));
      if (inc.ids.length) await api.tabs.remove(inc.ids).catch(() => {});
    } catch (e) {
      saveError = String(e?.message || e);
    }
    if (!isSitesLock(ls)) await ensureLockPage(); // all tabs: there is always a PIN prompt
    await local.set({ lock: { ...info, phase: 'locked', since: now(), reason }, ...(saveError ? { notice: 'save-failed' } : {}) });
    await session.remove(['unfocusedSince']);
    return saveError ? { ok: false, error: 'save-failed', detail: saveError } : { ok: true, hidden };
  }

  /** Private tabs in scope → sealed into the memory-only pvault. Returns their ids. */
  async function capturePrivate(ls, { onlyWorthSaving = false } = {}) {
    let wins = [];
    const include = (t) => inLockScope(ls, tabUrl(t)) && (!onlyWorthSaving || worthSaving(tabUrl(t)));
    try { wins = await captureWindows(api, { incognito: true, isOwnUrl, include }); } catch { return { ids: [] }; }
    await appendChunk('session', 'pvault', wins);
    const ids = (await api.tabs.query({})).filter((t) => t.incognito && !isOwnUrl(tabUrl(t)) && inLockScope(ls, tabUrl(t))).map((t) => t.id);
    return { ids };
  }

  /** Should this (normal-window) tab be hidden by a lock with state `ls`? */
  function hideCandidate(t, ls) {
    const url = tabUrl(t);
    if (tokenOf(url) || isPlainLockUrl(url)) return false; // already a lock page
    if (isOwnUrl(url)) return !isSitesLock(ls);              // settings/setup/gate pages: all-tabs mode only
    return inLockScope(ls, url);
  }

  async function appendHiddenChunk(entries, extra = {}) {
    const toks = Object.keys(entries);
    if (!toks.length) return;
    const chunk = { ...(await C.sealFor({ tabs: entries }, await sealingRecipients())), at: now(), toks, ...extra };
    const list = ((await getL('hidden')) || []).slice(-(MAX_HIDDEN_CHUNKS - 1));
    list.push(chunk);
    await local.set({ hidden: list });
    const back = (await getL('hidden')) || [];
    if (back.length !== list.length) throw new Error('hidden-tab write could not be verified');
  }

  /**
   * Save {url, title} for each tab (sealed), then navigate each tab to its lock URL. A tab
   * whose page holds the navigation with a "Leave site?" prompt is put to sleep
   * (tabs.discard: unloads without the prompt; gives the tab a NEW id) and hidden again.
   * Throws (and navigates nothing) if saving fails.
   */
  async function hideTabs(list) {
    if (!list.length) return 0;
    const gates = (await getS('gates')) || {};
    const entries = {};
    const plan = [];
    for (const t of list) {
      const url = tabUrl(t);
      const g = gates[gateTokenOf(url)];
      const token = H.newToken(C.randomBytes);
      // A PIN prompt for a protected page: remember the page it protects.
      entries[token] = { url: g ? g.url : url, title: g ? '' : (t.title || '') };
      plan.push({ id: t.id, token });
    }
    await appendHiddenChunk(entries);
    const map = (await getS('tabTokens')) || {};
    for (const p of plan) map[p.id] = p.token;
    await session.set({ tabTokens: map });
    for (const p of plan) await api.tabs.update(p.id, { url: H.hideUrl(lockUrl, p.token) }).catch(() => {});
    await settleHidden(plan);
    return plan.length;
  }

  async function settleHidden(plan) {
    await sleep(HIDE_SETTLE_MS);
    for (const p of plan) {
      let t;
      try { t = await api.tabs.get(p.id); } catch { continue; } // closed meanwhile
      // `url` is what the tab SHOWS. While a "Leave site?" prompt holds the navigation,
      // `pendingUrl` already is the lock page but `url` is still the site.
      if (tokenOf(t.url) === p.token) continue;
      await unstick(p.id, p.token);
    }
  }

  /** Put a tab to sleep (no "Leave site?" prompt; new tab id) and hide it again. */
  async function unstick(tabId, token) {
    try {
      const d = await api.tabs.discard(tabId);
      const id = Number.isInteger(d?.id) ? d.id : tabId;
      await api.tabs.update(id, { url: H.hideUrl(lockUrl, token) });
      if (id !== tabId) {
        const map = (await getS('tabTokens')) || {};
        delete map[tabId];
        map[id] = token;
        await session.set({ tabTokens: map });
      }
      return true;
    } catch {
      return false; // the 30 s safety net retries
    }
  }

  /** Map tab id → token from the tabs' current URLs (ids change on restart/discard). */
  async function rebuildTabTokens(all) {
    const map = (await getS('tabTokens')) || {};
    const ids = new Set(all.map((t) => t.id));
    for (const id of Object.keys(map)) if (!ids.has(Number(id))) delete map[id];
    for (const t of all) { const tok = tokenOf(tabUrl(t)); if (tok) map[t.id] = tok; }
    await session.set({ tabTokens: map });
    return map;
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

  /** Re-apply the lock: whichever mode the current lock was made in. */
  async function sweep() {
    const ls = await lockState();
    if (ls.phase !== 'locked') return false;
    if (lockMode(ls) === 'lockdown') return sweepWhileLocked(await ensureLockPage());
    return sweepHidden(ls);
  }

  /**
   * Default mode, already locked. Tabs that left their lock page (Back, typed address) go
   * back to it; tabs Brave restored at startup (all-tabs mode) or any tab on a listed
   * site (sites mode) are hidden; anything else opened while locked is closed (all-tabs
   * mode). Private tabs in scope: kept in memory at startup, then closed.
   */
  async function sweepHidden(ls) {
    const sites = isSitesLock(ls);
    if (!sites) await ensureLockPage();
    const all = await api.tabs.query({});
    const map = await rebuildTabTokens(all);
    const startupUntil = await getS('startupUntil');
    const inStartup = !!startupUntil && now() < startupUntil;
    const toHide = [];
    const toClose = [];
    for (const t of all) {
      const url = tabUrl(t);
      // A lock page restored before Tab Lock was running (e.g. it was re-enabled) shows the
      // browser's error page, whose title is just its address: load it again.
      if (tokenOf(t.url) && t.status === 'complete' && (!t.title || t.title.startsWith(ownOrigin))) {
        await api.tabs.reload(t.id).catch(() => {});
        continue;
      }
      const pendingTok = tokenOf(t.pendingUrl);
      if (!t.incognito && pendingTok && !isLockUrl(t.url)) { await unstick(t.id, pendingTok); continue; } // held by "Leave site?"
      if (isLockUrl(url)) continue; // hidden tab, plain lock page or PIN prompt
      if (t.incognito) {
        if (!isOwnUrl(url) && inLockScope(ls, url)) toClose.push(t);
      } else if (map[t.id]) {
        await api.tabs.update(t.id, { url: H.hideUrl(lockUrl, map[t.id]) }).catch(() => {});
      } else if (sites) {
        if (inLockScope(ls, url)) toHide.push(t);
      } else if (isOwnUrl(url) || (inStartup && worthSaving(url))) {
        toHide.push(t);
      } else {
        toClose.push(t);
      }
    }
    try {
      await hideTabs(toHide);
    } catch {
      return false; // never close what we couldn't save; the safety net retries
    }
    const priv = toClose.filter((t) => t.incognito);
    if (priv.length && inStartup) {
      try { await capturePrivate(ls, { onlyWorthSaving: true }); } catch { return false; }
    }
    if (toClose.length) await api.tabs.remove(toClose.map((t) => t.id)).catch(() => {});
    return true;
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

  /**
   * Default mode: put every hidden tab back on its page, in the same tab (so it keeps its
   * container and logins). Chunks are deleted after; tokens whose tab no longer exists
   * (closed while locked, or not restored after a restart) are kept, re-sealed as an
   * "orphan" chunk, and offered as "Reopen N tabs" / "Discard".
   */
  async function revealAll(keys) {
    const res = { revealedTabs: 0, failedTabs: [], errors: [], orphanTabs: 0 };
    const list = (await getL('hidden')) || [];
    if (!list.length) return res;
    const entries = {};
    const keep = [];
    for (const chunk of list) {
      if (!C.sealedKids(chunk).some((kid) => keys[kid])) { keep.push(chunk); continue; }
      try {
        Object.assign(entries, (await C.openWithAny(chunk, keys))?.tabs || {});
      } catch (e) {
        keep.push(chunk);
        res.errors.push(String(e?.message || e));
      }
    }
    const cats = new Set();
    for (const e of Object.values(entries)) { const c = classify(e.url); if (c) cats.add(c); }
    await grantGraces(cats); // the user just proved the PIN: don't bounce protected pages

    const found = new Set();
    const jobs = [];
    for (const t of await api.tabs.query({})) {
      const tok = tokenOf(tabUrl(t));
      if (!tok || !entries[tok]) continue;
      found.add(tok);
      jobs.push(revealTab(t.id, tok, entries[tok]).then((ok) => {
        if (ok) res.revealedTabs++;
        else res.failedTabs.push({ url: entries[tok].url, title: entries[tok].title });
      }));
    }
    await Promise.all(jobs);

    const openNow = new Set((await api.tabs.query({})).map((t) => tabUrl(t)));
    const orphans = {};
    for (const [tok, e] of Object.entries(entries)) {
      if (found.has(tok) || !worthSaving(e.url) || openNow.has(e.url)) continue;
      orphans[tok] = e;
    }
    const next = [...keep];
    const n = Object.keys(orphans).length;
    if (n) {
      next.push({ ...(await C.sealFor({ tabs: orphans }, await sealingRecipients())), at: now(), toks: Object.keys(orphans), orphan: true });
      res.orphanTabs = n;
    }
    await (next.length ? local.set({ hidden: next }) : local.remove('hidden'));
    return res;
  }

  /** Back first (keeps scroll and unsaved input when the page is in the back/forward cache), else navigate. */
  async function revealTab(tabId, token, entry) {
    const target = restorableUrl(entry.url) || 'chrome://newtab/';
    const here = H.hideUrl(lockUrl, token);
    let backed = false;
    try { await api.tabs.goBack(tabId); backed = true; } catch { /* no usable history entry */ }
    if (backed) {
      const landed = await waitToLeave(tabId, here);
      if (landed && H.samePage(landed, target)) return true;
    }
    try {
      await api.tabs.update(tabId, { url: target });
      return true;
    } catch {
      return false;
    }
  }

  async function waitToLeave(tabId, here) {
    for (let waited = 0; waited <= REVEAL_WAIT_MS; waited += 100) {
      let t;
      try { t = await api.tabs.get(tabId); } catch { return null; }
      const u = tabUrl(t);
      if (u && u !== here) return u;
      await sleep(100);
    }
    return null;
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

  async function finishUnlock(result, mode = 'lockdown') {
    await refreshBadge(); // e.g. master-PIN setup just completed by this unlock
    const pending = await pendingInfo();
    const problem = !!(result.errors.length || result.failedTabs.length || pending.oldChunks || pending.lostChunks || pending.orphanTabs
      || (await getS('recoveryUsed')));
    await local.set({ lock: { phase: 'unlocked', since: now() } });
    await session.remove(['startupUntil', 'tabTokens']);
    if (result.errors.length) await local.set({ notice: 'restore-failed' });
    if (result.failedTabs.length) await session.set({ failedTabs: result.failedTabs });
    else await session.remove('failedTabs');
    if (mode === 'hide') {
      await tidyPlainLockPages(problem);
    } else {
      const lockTabId = await getS('lockTabId');
      if (!problem && Number.isInteger(lockTabId)) {
        if (result.restoredWindows > 0) await api.tabs.remove(lockTabId).catch(() => {});
        else await api.tabs.update(lockTabId, { url: 'chrome://newtab/' }).catch(() => {});
        await session.remove(['lockTabId']);
      }
    }
    return {
      ok: true,
      restoredWindows: result.restoredWindows || 0,
      revealedTabs: result.revealedTabs || 0,
      failedTabs: result.failedTabs,
      restoreErrors: result.errors.length,
      ...pending,
    };
  }

  /**
   * Default mode, after unlock: the hidden tabs are back on their pages. Plain lock pages
   * (opened when there was nothing to hide) are closed — unless something needs the user's
   * attention, then one stays (or opens) to show it, because the tab the PIN was typed in
   * has already gone back to its page.
   */
  async function tidyPlainLockPages(problem) {
    const all = await api.tabs.query({});
    const plain = all.filter((t) => !t.incognito && isPlainLockUrl(tabUrl(t)));
    if (problem) {
      if (plain.length) {
        await api.tabs.update(plain[0].id, { active: true }).catch(() => {});
        await session.set({ lockTabId: plain[0].id });
      } else {
        const t = await api.tabs.create({ url: lockUrl, active: true }).catch(() => null);
        if (t) await session.set({ lockTabId: t.id });
      }
      return;
    }
    for (const t of plain) {
      const others = all.some((o) => o.windowId === t.windowId && o.id !== t.id);
      if (others) await api.tabs.remove(t.id).catch(() => {});
      else await api.tabs.update(t.id, { url: 'chrome://newtab/' }).catch(() => {});
    }
    await session.remove(['lockTabId']);
  }

  /** Verified: open everything this PIN can open (hidden tabs, then the Vault). */
  async function openAll(secret, rec, mode) {
    const keys = await keysFor(secret, rec);
    const hid = await revealAll(keys);
    const res = await restoreAll(keys);
    return finishUnlock({
      restoredWindows: res.restoredWindows,
      revealedTabs: hid.revealedTabs,
      failedTabs: [...hid.failedTabs, ...res.failedTabs],
      errors: [...hid.errors, ...res.errors],
    }, mode);
  }

  function unlock(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const mode = lockMode(await lockState());
      await setPhase('unlocking');
      return openAll(secret, rec, mode);
    });
  }

  /** "Retry restore" (unlocked or locked) — needs the PIN again (keys aren't kept). */
  function retryRestore(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const ls = await lockState();
      if (isLockedPhase(ls.phase)) await setPhase('unlocking');
      return openAll(secret, rec, isLockedPhase(ls.phase) ? lockMode(ls) : 'hide');
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
      const ls = await lockState();
      const hid = await revealAll(keys);
      const result = await restoreAll(keys);
      const errors = [...hid.errors, ...result.errors];
      for (const kid of Object.keys(keys)) if (!errors.length) delete oldKeys[kid];
      await local.set({ oldKeys });
      await pruneOldKeys();
      return finishUnlock({ ...result, revealedTabs: hid.revealedTabs, failedTabs: [...hid.failedTabs, ...result.failedTabs], errors },
        isLockedPhase(ls.phase) ? lockMode(ls) : 'hide');
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
      const hidden = ((await getL('hidden')) || []).filter(usable);
      await (vault.length ? local.set({ vault }) : local.remove('vault'));
      await (pvault.length ? session.set({ pvault }) : session.remove('pvault'));
      await (hidden.length ? local.set({ hidden }) : local.remove('hidden'));
      await local.remove('oldKeys');
      const ls = await lockState();
      return finishUnlock({ restoredWindows: 0, failedTabs: [], errors: [] }, isLockedPhase(ls.phase) ? lockMode(ls) : 'hide');
    });
  }

  async function pruneOldKeys() {
    const oldKeys = (await getL('oldKeys')) || {};
    const used = new Set([...((await getL('vault')) || []), ...((await getS('pvault')) || []), ...((await getL('hidden')) || [])].flatMap((c) => C.sealedKids(c)));
    for (const kid of Object.keys(oldKeys)) if (!used.has(kid)) delete oldKeys[kid];
    await (Object.keys(oldKeys).length ? local.set({ oldKeys }) : local.remove('oldKeys'));
  }

  async function pendingInfo() {
    const vault = (await getL('vault')) || [];
    const pvault = (await getS('pvault')) || [];
    const hidden = (await getL('hidden')) || [];
    const cur = (await getL('keyRec'))?.kid;
    const oldKeys = (await getL('oldKeys')) || {};
    const eph = await getS('ephemeral');
    let savedChunks = 0, oldChunks = 0, lostChunks = 0, savedTabs = 0, orphanTabs = 0, hiddenTabs = 0;
    const classifyChunk = (c) => {
      const kids = C.sealedKids(c);
      if (kids.includes(cur) || (eph && kids.includes('session'))) return 'ok';
      return kids.some((kid) => oldKeys[kid]) ? 'old' : 'lost';
    };
    for (const c of [...vault, ...pvault]) {
      savedChunks++;
      savedTabs += c.tabs || 0;
      const k = classifyChunk(c);
      if (k === 'old') oldChunks++;
      else if (k === 'lost') lostChunks++;
    }
    for (const c of hidden) {
      const k = classifyChunk(c);
      if (c.orphan) { if (k === 'ok') orphanTabs += c.toks?.length || 0; else if (k === 'old') oldChunks++; else lostChunks++; continue; }
      hiddenTabs += c.toks?.length || 0;
      if (k === 'old') oldChunks++;
      else if (k === 'lost') lostChunks++;
    }
    return { savedChunks, savedTabs, oldChunks, lostChunks, orphanTabs, hiddenTabs };
  }

  /** The tab a stale lock page (unlocked, its token no longer saved) belongs to: go back. */
  async function leaveStale(tabId, token) {
    if (!Number.isInteger(tabId) || isLockedPhase(await phase())) return { ok: false };
    if (H.chunkTokens((await getL('hidden')) || []).has(token)) return { ok: false, error: 'pending' };
    const here = H.hideUrl(lockUrl, token);
    let landed = null;
    try { await api.tabs.goBack(tabId); landed = await waitToLeave(tabId, here); } catch { /* no history */ }
    if (!landed || isLockUrl(landed)) await api.tabs.update(tabId, { url: 'chrome://newtab/' }).catch(() => {});
    return { ok: true };
  }

  /** D4: reopen (as new tabs) or discard tabs that were hidden but are no longer open. */
  function reopenHidden(secret, discard = false) {
    return serial(async () => {
      if (isLockedPhase(await phase())) return { ok: false, error: 'locked' };
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      const list = (await getL('hidden')) || [];
      const keys = discard ? {} : await keysFor(secret, rec);
      const keep = [];
      const failedTabs = [];
      let reopened = 0;
      for (const c of list) {
        if (!c.orphan) { keep.push(c); continue; }
        if (discard) continue;
        let tabs;
        try { tabs = (await C.openWithAny(c, keys))?.tabs || {}; } catch { keep.push(c); continue; }
        for (const e of Object.values(tabs)) {
          try { await api.tabs.create({ url: restorableUrl(e.url), active: false }); reopened++; } catch { failedTabs.push(e); }
        }
      }
      await (keep.length ? local.set({ hidden: keep }) : local.remove('hidden'));
      if (failedTabs.length) await session.set({ failedTabs }); else await session.remove('failedTabs');
      return { ok: true, reopened, failedTabs, ...(await pendingInfo()) };
    });
  }

  // ---- protected pages ---------------------------------------------------------------
  async function gate(tab, url, whileSitesLocked = false) {
    const { rec } = await pinRecord();
    if (!rec || (!whileSitesLocked && (await phase()) !== 'unlocked')) return false;
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

  /**
   * Default mode, locked: a tab was created or navigated.
   * - its own lock page → remember tab id ↔ token (ids change on restart and discard);
   * - a hidden tab left its lock page (Back button, typed address) → straight back;
   * - sites mode: a listed site is hidden at once, other pages work (protected pages gated);
   * - all tabs: restored at startup → hidden; anything else opened while locked → closed.
   */
  async function onHiddenEvent(tab, url, ls) {
    if (ls.phase === 'locking') return; // lock() is working right now
    const tok = tokenOf(url);
    const map = (await getS('tabTokens')) || {};
    if (tok) {
      if (map[tab.id] !== tok) { map[tab.id] = tok; await session.set({ tabTokens: map }); }
      return;
    }
    if (isLockUrl(url)) return; // plain lock page or a PIN prompt
    if (!tab.incognito && map[tab.id]) {
      await api.tabs.update(tab.id, { url: H.hideUrl(lockUrl, map[tab.id]) }).catch(() => {});
      return;
    }
    if (isSitesLock(ls)) {
      if (!matchesSite(url, ls.sites)) { if (!tab.incognito) await gate(tab, url, true); return; }
      if (tab.incognito) { await api.tabs.remove(tab.id).catch(() => {}); return; }
      await serial(() => hideTabs([{ ...tab, url, pendingUrl: undefined }])).catch(() => {});
      return;
    }
    const startupUntil = await getS('startupUntil');
    if (!tab.incognito && startupUntil && now() < startupUntil && worthSaving(url)) {
      await serial(() => hideTabs([{ ...tab, url, pendingUrl: undefined }])).catch(() => {});
      return;
    }
    return onStrayTab(tab);
  }

  async function onTabCreated(tab) {
    const ls = await lockState();
    if (isLockedPhase(ls.phase)) {
      if (lockMode(ls) === 'hide') return onHiddenEvent(tab, tabUrl(tab), ls);
      return onStrayTab(tab);
    }
    const url = tab.pendingUrl || tab.url;
    if (url) await gate(tab, url);
  }

  async function onTabUpdated(tabId, change, tab) {
    if (!change.url) return;
    const ls = await lockState();
    if (isLockedPhase(ls.phase)) {
      if (lockMode(ls) === 'hide') return onHiddenEvent(tab, change.url, ls);
      return onStrayTab(tab);
    }
    await gate(tab, change.url);
  }

  async function onTabRemoved(tabId, info) {
    const map = (await getS('tabTokens')) || {};
    if (map[tabId]) { delete map[tabId]; await session.set({ tabTokens: map }); }
    const ls = await lockState();
    const wasLockTab = tabId === (await getS('lockTabId'));
    if (wasLockTab) await session.remove(['lockTabId']);
    if (ls.phase !== 'locked') return;
    if (lockMode(ls) === 'hide') {
      // All-tabs mode always shows a PIN prompt somewhere. (A whole window closing — e.g.
      // the browser quitting — is left to the 30 s safety net.)
      if (isSitesLock(ls) || info?.isWindowClosing) return;
      const any = (await api.tabs.query({})).some((t) => !t.incognito && isLockUrl(tabUrl(t)));
      if (!any) await serial(ensureLockPage).catch(() => {});
      return;
    }
    if (wasLockTab) await serial(ensureLockPage).catch(() => {});
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
      await serial(sweep).catch(() => {}); // safety net
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
      await setPhase('unlocked');
      await lock('recovered');
    } else if (p === 'locked') {
      await serial(async () => {
        const ls = await lockState();
        if (lockMode(ls) === 'hide') await rebuildTabTokens(await api.tabs.query({}));
        if (!isSitesLock(ls)) await ensureLockPage();
      }).catch(() => {});
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
        schedule(() => serial(sweep).catch(() => {}), ms);
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
      await local.remove('recRec'); // recovery codes are off under a master PIN
      await refreshBadge();
      return { ok: true };
    });
  }

  // ---- recovery code ---------------------------------------------------------------
  async function recoveryInfo(managed) {
    if (managed) return { available: false };
    const recRec = await getL('recRec');
    const keyRec = await getL('keyRec');
    return { available: true, set: !!recRec, valid: !!recRec && !!keyRec && recRec.kid === keyRec.kid, created: recRec?.created || null };
  }

  /** New code (replaces any old one). Needs the current PIN. The code leaves only in this reply. */
  function createRecovery(secret) {
    return serial(async () => {
      const { rec, managed } = await pinRecord();
      if (managed) return { ok: false, error: 'recovery-managed' };
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      await currentPrivateKey(secret, rec); // make sure a key record exists and opens
      const code = C.generateRecoveryCode();
      const recRec = await C.createRecoveryRecord(code, await getL('keyRec'), secret, { created: now() });
      await local.set({ recRec });
      return { ok: true, code: C.formatRecoveryCode(code) };
    });
  }

  function removeRecovery(secret) {
    return serial(async () => {
      const { rec } = await pinRecord();
      if (!rec) return { ok: false, error: 'not-configured' };
      const chk = await checkSecret(secret, rec);
      if (!chk.ok) return chk;
      await local.remove('recRec');
      return { ok: true };
    });
  }

  /**
   * Forgot PIN: the recovery code resets it. Wrong codes share the PIN's backoff counter
   * (and its optional erase-after-N). The code is single-use: its record is deleted.
   * If locked, this also unlocks (the code opens the same private key as the PIN did).
   */
  function recoverWithCode(code, next, kind) {
    return serial(async () => {
      const { managed } = await pinRecord();
      if (managed) return { ok: false, error: 'recovery-managed' };
      const recRec = await getL('recRec');
      const keyRec = await getL('keyRec');
      if (!recRec || !keyRec) return { ok: false, error: 'no-recovery' };
      const bad = C.validateSecret(next, kind);
      if (bad) return { ok: false, error: 'invalid', message: bad };
      const chk = await checkSecret(C.normalizeRecoveryCode(code) || '', recRec.hash, ['recovery']);
      if (!chk.ok) return chk;
      if (recRec.kid !== keyRec.kid) return { ok: false, error: 'recovery-stale' };
      const newRec = await C.hashSecret(next, kind);
      const newKey = { ...(await C.rewrapFromRecovery(keyRec, recRec, code, next, C.recordId(newRec))), kid: keyRec.kid };
      await local.set({ pinRec: newRec, keyRec: newKey, backoff: B.initialBackoff() });
      await local.remove('recRec');
      await session.set({ recoveryUsed: true }); // a Tab Lock page offers a new code
      await refreshBadge();
      const ls = await lockState();
      if (!isLockedPhase(ls.phase)) return { ok: true, recovered: true };
      await setPhase('unlocking');
      return { ...(await openAll(next, newRec, lockMode(ls))), recovered: true };
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
    const ls = await lockState();
    const s = await settings();
    const out = {
      configured: !!rec,
      managed,
      lockMode: isLockedPhase(ls.phase) ? lockMode(ls) : s.mode,
      lockScope: isLockedPhase(ls.phase) ? (isSitesLock(ls) ? 'sites' : 'all') : s.scope,
      recovery: await recoveryInfo(managed),
      failedTabs: (await getS('failedTabs')) || [],
      recoveryUsed: !!(await getS('recoveryUsed')),
      managedSetupDone: managed ? !!(await getL('keyRec')) && (await getL('keyRec')).boundTo === C.recordId(rec) : null,
      kind: rec?.kind || null,
      phase: await phase(),
      waitMs: B.waitMs(bo, now()),
      failures: bo.failures,
      notice: (await getL('notice')) || null,
      ...(await pendingInfo()),
    };
    if (extra.token) {
      const hidden = (await getL('hidden')) || [];
      const c = hidden.find((h) => !h.orphan && (h.toks || []).includes(extra.token));
      out.tokenPending = !!c;
    }
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
      case 'status': return status({ gate: msg.gate, options: msg.options, token: typeof msg.token === 'string' ? msg.token : undefined });
      case 'unlock': return unlock(String(msg.secret ?? ''));
      case 'retryRestore': return retryRestore(String(msg.secret ?? ''));
      case 'recoverOld': return recoverOld(String(msg.secret ?? ''));
      case 'discardUnopenable': return discardUnopenable(String(msg.secret ?? ''));
      case 'openGate': return openGate(String(msg.token ?? ''), String(msg.secret ?? ''));
      case 'authOptions': return authOptions(String(msg.secret ?? ''));
      case 'setSecret': return setSecret({ current: String(msg.current ?? ''), next: String(msg.next ?? ''), kind: msg.kind });
      case 'setupManaged': return setupManaged(String(msg.secret ?? ''));
      case 'saveSettings': return saveSettings(msg.settings);
      case 'clearNotice': await local.remove('notice'); await session.remove(['failedTabs', 'recoveryUsed']); return { ok: true };
      case 'leaveStale': return leaveStale(sender?.tab?.id, String(msg.token ?? ''));
      case 'reopenHidden': return reopenHidden(String(msg.secret ?? ''));
      case 'discardHidden': return reopenHidden(String(msg.secret ?? ''), true);
      case 'createRecovery': return createRecovery(String(msg.secret ?? ''));
      case 'removeRecovery': return removeRecovery(String(msg.secret ?? ''));
      case 'recoverWithCode': return recoverWithCode(String(msg.code ?? ''), String(msg.next ?? ''), msg.kind);
      case 'lockNow': return lock('page');
      default: return { ok: false, error: 'unknown' };
    }
  }

  return {
    init, onStartup, onInstalled, onTabCreated, onTabUpdated, onTabRemoved, onFocusChanged,
    onIdleState, onAlarm, onActionClicked, onCommand, onMessage, onStorageChanged, lock, unlock, status,
    // exposed for tests
    _internal: { ensureLockPage, pendingInfo, phase, sweep },
  };
}
