// Default mode ("hide in place"), sites mode, recovery code, and migration from 0.1.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.js';
import { createController, LOCK_PAGE } from '../src/controller.js';
import { tokenFromUrl } from '../src/hide.js';
import * as C from '../src/crypto.js';

const LOCK = `chrome-extension://testid/${LOCK_PAGE}`;
const PIN = '482913';
const NEW_PIN = '771204';

function setup(opts, seed) {
  const f = createFakeChrome(opts);
  if (seed) f.api.storage.local._replace(seed);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; }, schedule: () => {}, sleep: async () => {} };
  const c = createController(f.api, clock);
  const msg = (m, page = 'src/pages/lock.html', tab) => c.onMessage(m, { ...f.sender(page), tab });
  return { f, c, clock, msg };
}

async function configured(settings, opts) {
  const s = setup(opts);
  await s.c.init();
  assert.equal((await s.msg({ type: 'setSecret', next: PIN, kind: 'pin' }, 'src/pages/onboarding.html')).ok, true);
  if (settings) assert.equal((await s.msg({ type: 'saveSettings', settings }, 'src/pages/options.html')).ok, true);
  s.clock.advance(31_000);
  return s;
}

const byUrl = (f, u) => f.allTabs().find((t) => t.url === u);
const tokenTabs = (f) => f.allTabs().filter((t) => tokenFromUrl(t.url, LOCK));

test('default mode is hide-in-place; settings default + sanitize', async () => {
  const { c } = await configured();
  const st = await c.status();
  assert.equal(st.lockMode, 'hide');
  assert.equal(st.lockScope, 'all');
});

test('hide in place: same tab ids, lock URL = opaque token only, pinned/group/index kept, nothing readable on disk', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://bank.example/account', title: 'My Bank', pinned: true }, { url: 'https://g.example/', group: 'g' }, { url: 'https://news.example/' }],
    { groupDefs: { g: { title: 'Trip', color: 'green' } } });
  const before = f.allTabs().map((t) => ({ id: t.id, index: t.index, pinned: t.pinned, groupId: t.groupId }));
  f.writes.length = 0;
  const r = await c.lock('test');
  assert.equal(r.ok, true);
  assert.equal(r.hidden, 3);
  const after = f.allTabs();
  assert.equal(after.length, 3, 'no tab closed, no lock window added');
  for (const b of before) {
    const t = after.find((x) => x.id === b.id);
    assert.ok(t, 'same tab id');
    assert.deepEqual({ index: t.index, pinned: t.pinned, groupId: t.groupId }, { index: b.index, pinned: b.pinned, groupId: b.groupId });
    assert.match(t.url, /^chrome-extension:\/\/testid\/src\/pages\/lock\.html#[0-9a-f]{32}$/);
  }
  const disk = JSON.stringify(f.api.storage.local._dump()) + f.writes.filter((w) => w.area === 'local').map((w) => w.json).join('');
  for (const secret of ['bank.example', 'My Bank', 'news.example', 'g.example', PIN]) assert.ok(!disk.includes(secret), `${secret} on disk`);
  assert.equal((await c.status()).phase, 'locked');
  assert.equal((await c.status()).hiddenTabs, 3);
});

test('unlock: Back first (same tab, lock entry stays forward), hidden chunks deleted', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://mail.example/inbox' }, { url: 'https://b.example/' }]);
  const ids = f.allTabs().map((t) => t.id);
  await c.lock();
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.revealedTabs, 2);
  assert.deepEqual(f.allTabs().map((t) => t.url).sort(), ['https://b.example/', 'https://mail.example/inbox']);
  assert.deepEqual(f.allTabs().map((t) => t.id).sort(), ids.sort(), 'same tabs');
  const h = f.history(ids[0]);
  assert.equal(h.entries[h.index], 'https://mail.example/inbox');
  assert.equal(h.index, 0, 'went Back (no new entry)');
  assert.equal(f.api.storage.local._dump().hidden, undefined);
  assert.equal((await c.status()).phase, 'unlocked');
});

test('unlock: Back unusable (page never had user input) → navigates to the saved address', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://a.example/x?y=1' }]);
  const id = f.allTabs()[0].id;
  f.skipBack(id);
  await c.lock();
  assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
  assert.equal(f.allTabs()[0].url, 'https://a.example/x?y=1');
  assert.equal(f.allTabs()[0].id, id);
});

test('"Leave site?" page: discarded (new tab id) then hidden; unlocks to its page', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://form.example/draft' }, { url: 'https://other.example/' }]);
  const formId = byUrl(f, 'https://form.example/draft').id;
  f.blockNavigation(formId);
  await c.lock();
  assert.equal(f.allTabs().find((t) => t.id === formId), undefined, 'old id gone (discard replaces it)');
  assert.equal(tokenTabs(f).length, 2);
  assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
  assert.ok(byUrl(f, 'https://form.example/draft'));
});

test('while locked: Back on a hidden tab is sent straight back to the same lock page', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://secret.example/' }]);
  await c.lock();
  const t = tokenTabs(f)[0];
  const lockUrl = t.url;
  await f.api.tabs.goBack(t.id); // user presses Back
  await c.onTabUpdated(t.id, { url: 'https://secret.example/' }, await f.api.tabs.get(t.id));
  assert.equal((await f.api.tabs.get(t.id)).url, lockUrl);
});

test('while locked (all tabs): new tabs/windows and brave:// pages are closed; PIN prompt stays', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  const wid = f.openWindow([{ url: 'https://new.example/' }]);
  await c.onTabCreated(f.allTabs().find((t) => t.windowId === wid));
  const nt = await f.api.tabs.create({ url: 'chrome://settings/' });
  await c.onTabCreated(nt);
  assert.equal(f.allTabs().length, 1);
  assert.ok(tokenFromUrl(f.allTabs()[0].url, LOCK));
});

test('closing every hidden tab while locked opens a PIN prompt; unlock reopens the closed tab with the same PIN', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://closed.example/' }]);
  await c.lock();
  const t = tokenTabs(f)[0];
  await f.api.tabs.remove(t.id);
  await c.onTabRemoved(t.id, { isWindowClosing: false });
  assert.deepEqual(f.allTabs().map((x) => x.url), [LOCK]);
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.reopenedTabs, 1);
  assert.equal(r.orphanTabs, 0);
  assert.ok(byUrl(f, 'https://closed.example/'));
  assert.equal((await c.status()).orphanTabs, 0);
  assert.equal(f.api.storage.local._dump().hidden, undefined);
});

test('if a dropped tab\'s window can\'t be reopened, it is kept and offered back (D4 fallback)', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://closed.example/' }]);
  await c.lock();
  const t = tokenTabs(f)[0];
  await f.api.tabs.remove(t.id);
  await c.onTabRemoved(t.id, { isWindowClosing: false });
  f.failNextWindowCreates(2);
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.orphanTabs, 1);
  assert.ok(byUrl(f, LOCK), 'a status page stays open to show it');
  const ro = await msg({ type: 'reopenHidden', secret: PIN });
  assert.equal(ro.ok, true);
  assert.equal(ro.reopened, 1);
  assert.ok(byUrl(f, 'https://closed.example/'));
  assert.equal((await c.status()).orphanTabs, 0);
});

test('restart without session restore: one unlock reopens every hidden tab in its window, pin and group', async () => {
  const { c, f, clock, msg } = await configured();
  f.openWindow([{ url: 'https://pin.example/', pinned: true }, { url: 'https://g1.example/', group: 'g' }, { url: 'https://g2.example/', group: 'g' }],
    { groupDefs: { g: { title: 'Work', color: 'blue' } } });
  f.openWindow([{ url: 'https://other.example/' }]);
  await c.lock();
  assert.equal(tokenTabs(f).length, 4);
  // the browser restarts and opens only a new tab page (Chrome's default for a new profile)
  for (const w of await f.api.windows.getAll()) await f.api.windows.remove(w.id);
  f.api.storage.session._replace({});
  f.openWindow([{ url: 'chrome://newtab/' }]);
  const c2 = createController(f.api, { ...clock, sleep: async () => {} });
  await c2.init();
  await c2.onStartup();
  assert.equal((await c2.status()).phase, 'locked');
  const r = await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.equal(r.ok, true);
  assert.equal(r.reopenedTabs, 4);
  assert.equal(r.orphanTabs, 0, 'no second PIN needed');
  const wins = await f.api.windows.getAll({ populate: true });
  const win1 = wins.find((w) => w.tabs.some((t) => t.url === 'https://pin.example/'));
  assert.deepEqual(win1.tabs.map((t) => t.url), ['https://pin.example/', 'https://g1.example/', 'https://g2.example/']);
  assert.equal(win1.tabs[0].pinned, true);
  const gid = win1.tabs[1].groupId;
  assert.ok(gid >= 0 && win1.tabs[2].groupId === gid);
  const g = await f.api.tabGroups.get(gid);
  assert.deepEqual({ title: g.title, color: g.color }, { title: 'Work', color: 'blue' });
  const win2 = wins.find((w) => w.tabs.some((t) => t.url === 'https://other.example/'));
  assert.notEqual(win1.id, win2.id, 'separate windows kept');
  assert.equal(wins.length, 2, 'the startup window holding only the lock page is closed');
  assert.equal(f.api.storage.local._dump().hidden, undefined);
  const disk = JSON.stringify(f.api.storage.local._dump());
  for (const secret of ['pin.example', 'Work']) assert.ok(!disk.includes(secret), `${secret} on disk`);
});

test('D4 discard: orphaned hidden tabs can be discarded with the PIN', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://gone.example/' }, { url: 'https://stay.example/' }]);
  await c.lock();
  const gone = tokenTabs(f)[0];
  await f.api.tabs.remove(gone.id);
  f.failNextWindowCreates(2); // reopening fails → kept for Reopen/Discard
  await msg({ type: 'unlock', secret: PIN });
  assert.equal((await c.status()).orphanTabs, 1);
  assert.equal((await msg({ type: 'discardHidden', secret: '000000' })).error, 'wrong');
  assert.equal((await msg({ type: 'discardHidden', secret: PIN })).ok, true);
  assert.equal((await c.status()).orphanTabs, 0);
  assert.equal(f.api.storage.local._dump().hidden, undefined);
});

test('browser restart while locked: tab ids change, tokens still match, unlock reveals them', async () => {
  const { c, f, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  await c.lock();
  // restart: session storage cleared; restored tabs come back with NEW ids (simulated by discard)
  f.api.storage.session._replace({});
  for (const t of tokenTabs(f)) await f.api.tabs.discard(t.id);
  const c2 = createController(f.api, { ...clock, sleep: async () => {} });
  await c2.init();
  assert.equal((await c2.status()).phase, 'locked');
  assert.equal(tokenTabs(f).length, 2, 'restored lock pages kept, not closed');
  const r = await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.equal(r.ok, true);
  assert.equal(r.revealedTabs, 2);
  assert.deepEqual(f.allTabs().map((t) => t.url).sort(), ['https://a.example/', 'https://b.example/']);
});

test('a lock page that loaded before Tab Lock was running (error page) is reloaded by the safety net', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  const t = tokenTabs(f)[0];
  Object.assign(f.tabs.get(t.id), { status: 'complete', title: t.url }); // what Brave shows for a missing extension page
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal(f.tabs.get(t.id).reloads, 1);
  Object.assign(f.tabs.get(t.id), { title: 'Locked — Tab Lock' });
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal(f.tabs.get(t.id).reloads, 1, 'a rendered lock page is left alone');
});

test('lockOnStartup with an unlocked browser: restored tabs are hidden in place, not closed', async () => {
  const { f, clock } = await configured();
  f.openWindow([{ url: 'https://restored.example/' }]);
  f.api.storage.session._replace({});
  const c2 = createController(f.api, { ...clock, sleep: async () => {} });
  await c2.init();
  assert.equal((await c2.status()).phase, 'locked');
  assert.equal(f.allTabs().length, 1);
  assert.ok(tokenFromUrl(f.allTabs()[0].url, LOCK));
});

test('private windows: closed and kept in memory only, reopened on unlock (D7)', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://normal.example/' }]);
  f.openWindow([{ url: 'https://private-secret.example/' }], { incognito: true });
  f.writes.length = 0;
  await c.lock();
  assert.equal(f.allTabs().filter((t) => t.incognito).length, 0);
  assert.equal(f.api.storage.session._dump().pvault.length, 1);
  assert.ok(!JSON.stringify(f.api.storage.local._dump()).includes('private-secret'));
  assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
  const p = byUrl(f, 'https://private-secret.example/');
  assert.equal(p.incognito, true);
  assert.ok(byUrl(f, 'https://normal.example/'));
});

test('sites mode: only listed sites hidden; others usable; a listed site opened later is hidden; protected pages gated', async () => {
  const { c, f, msg } = await configured({ scope: 'sites', sites: ['mail.proton.me', '*.bank.com'] });
  f.openWindow([{ url: 'https://mail.proton.me/u/0/inbox' }, { url: 'https://news.example/' }, { url: 'https://online.bank.com/' }]);
  await c.lock();
  assert.equal((await c.status()).lockScope, 'sites');
  assert.equal(tokenTabs(f).length, 2);
  assert.ok(byUrl(f, 'https://news.example/'), 'unlisted site untouched');
  assert.equal(f.allTabs().length, 3, 'no lock window in sites mode');
  // a new tab on an unlisted site is fine
  const ok = await f.api.tabs.create({ url: 'https://weather.example/' });
  await c.onTabCreated(ok);
  assert.ok(byUrl(f, 'https://weather.example/'));
  // navigating it to a listed site hides it
  await f.api.tabs.update(ok.id, { url: 'https://bank.com/login' });
  await c.onTabUpdated(ok.id, { url: 'https://bank.com/login' }, await f.api.tabs.get(ok.id));
  assert.ok(tokenFromUrl((await f.api.tabs.get(ok.id)).url, LOCK));
  // protected page in an unlisted tab → PIN prompt
  const news = byUrl(f, 'https://news.example/');
  await f.api.tabs.update(news.id, { url: 'chrome://history/' });
  await c.onTabUpdated(news.id, { url: 'chrome://history/' }, await f.api.tabs.get(news.id));
  assert.match((await f.api.tabs.get(news.id)).url, /lock\.html\?gate=/);
  // unlock
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.revealedTabs, 3);
  assert.ok(byUrl(f, 'https://bank.com/login'));
  assert.ok(byUrl(f, 'https://mail.proton.me/u/0/inbox'));
});

test('sites mode: toolbar while locked opens a PIN tab; idle does not', async () => {
  const { c, f } = await configured({ scope: 'sites', sites: ['a.example'] });
  f.openWindow([{ url: 'https://b.example/' }]);
  await c.lock();
  await c.onIdleState('idle');
  assert.equal(byUrl(f, LOCK), undefined);
  await c.onActionClicked();
  assert.ok(byUrl(f, LOCK));
});

test('Lockdown mode setting still closes + vaults (Advanced); sites scope ignored in Lockdown', async () => {
  const { c, f } = await configured({ mode: 'lockdown', scope: 'sites', sites: ['a.example'] });
  f.openWindow([{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  await c.lock();
  assert.deepEqual(f.allTabs().map((t) => t.url), [LOCK]);
  assert.equal(f.api.storage.local._dump().vault.length, 1);
});

test('wrong-PIN erase in default mode closes the hidden tabs (their history held the pages)', async () => {
  const { c, f, msg, clock } = await configured({ wipeAfter: { enabled: true, n: 6 } });
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  let r;
  for (let i = 0; i < 6; i++) { r = await msg({ type: 'unlock', secret: '000000' }); clock.advance(4_000_000); }
  assert.equal(r.wiped, true);
  assert.equal(tokenTabs(f).length, 0);
  assert.ok(byUrl(f, LOCK));
  assert.equal(f.api.storage.local._dump().hidden, undefined);
});

test('stale lock page (Forward, after unlock) goes back; pending token does not', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  const t = tokenTabs(f)[0];
  const tok = tokenFromUrl(t.url, LOCK);
  assert.equal((await msg({ type: 'status', token: tok })).tokenPending, true);
  assert.equal((await msg({ type: 'leaveStale', token: tok }, undefined, { id: t.id })).ok, false, 'not while locked');
  await msg({ type: 'unlock', secret: PIN });
  await f.api.tabs.update(t.id, { url: t.url }); // user presses Forward
  assert.equal((await msg({ type: 'status', token: tok })).tokenPending, false);
  assert.equal((await msg({ type: 'leaveStale', token: tok }, undefined, { id: t.id })).ok, true);
  assert.equal((await f.api.tabs.get(t.id)).url, 'https://a.example/');
});

// ---- recovery code ---------------------------------------------------------------------

test('recovery code: create (needs PIN), never stored in clear, resets PIN while locked AND reveals tabs; single use', async () => {
  const { c, f, msg } = await configured();
  assert.equal((await msg({ type: 'createRecovery', secret: '000000' })).error, 'wrong');
  const cr = await msg({ type: 'createRecovery', secret: PIN });
  assert.equal(cr.ok, true);
  assert.match(cr.code, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
  const canon = C.normalizeRecoveryCode(cr.code);
  const disk = JSON.stringify(f.api.storage.local._dump()) + f.writes.map((w) => w.json).join('');
  assert.ok(!disk.includes(canon) && !disk.includes(cr.code), 'code never written');
  assert.equal((await c.status()).recovery.valid, true);

  f.openWindow([{ url: 'https://hidden.example/' }]);
  await c.lock();
  // typed sloppily: lower case, spaces, O for 0, I/L for 1
  const sloppy = cr.code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
  const r = await msg({ type: 'recoverWithCode', code: sloppy, next: NEW_PIN, kind: 'pin' });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
  assert.ok(byUrl(f, 'https://hidden.example/'), 'hidden tab revealed after reset');
  assert.equal((await c.status()).phase, 'unlocked');
  assert.equal((await c.status()).recovery.set, false, 'used code is gone');
  // new PIN works, old does not, code no longer works
  await c.lock();
  assert.equal((await msg({ type: 'unlock', secret: PIN })).error, 'wrong');
  assert.equal((await msg({ type: 'recoverWithCode', code: cr.code, next: '111111', kind: 'pin' })).error, 'no-recovery');
  assert.equal((await msg({ type: 'unlock', secret: NEW_PIN })).ok, true);
});

test('recovery code also opens a Lockdown vault after a reset', async () => {
  const { c, f, msg } = await configured({ mode: 'lockdown' });
  const { code } = await msg({ type: 'createRecovery', secret: PIN });
  f.openWindow([{ url: 'https://vaulted.example/' }]);
  await c.lock();
  const r = await msg({ type: 'recoverWithCode', code, next: 'a long new passphrase', kind: 'passphrase' });
  assert.equal(r.ok, true);
  assert.equal(r.restoredWindows, 1);
  assert.ok(byUrl(f, 'https://vaulted.example/'));
});

test('recovery: wrong codes share the PIN backoff; regenerate invalidates the old code; remove works', async () => {
  const { c, msg } = await configured();
  const first = (await msg({ type: 'createRecovery', secret: PIN })).code;
  const second = (await msg({ type: 'createRecovery', secret: PIN })).code;
  assert.notEqual(first, second);
  assert.equal((await msg({ type: 'recoverWithCode', code: first, next: NEW_PIN, kind: 'pin' })).error, 'wrong', 'old code invalid');
  for (let i = 0; i < 3; i++) await msg({ type: 'recoverWithCode', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ', next: NEW_PIN, kind: 'pin' });
  assert.equal((await msg({ type: 'unlock', secret: '000000' })).failures, 5, 'one shared counter');
  // 5 failures (3 codes + 2 PINs incl. the old code) → even the RIGHT code must wait now
  const sixth = await msg({ type: 'recoverWithCode', code: second, next: NEW_PIN, kind: 'pin' });
  assert.equal(sixth.error, 'backoff');
  assert.ok(sixth.waitMs > 0);
  assert.equal((await msg({ type: 'removeRecovery', secret: PIN })).error, 'backoff');
});

test('recovery: invalid new PIN is rejected before using an attempt; remove needs PIN', async () => {
  const { c, msg } = await configured();
  const { code } = await msg({ type: 'createRecovery', secret: PIN });
  assert.equal((await msg({ type: 'recoverWithCode', code, next: '12', kind: 'pin' })).error, 'invalid');
  assert.equal((await c.status()).failures, 0);
  assert.equal((await msg({ type: 'removeRecovery', secret: PIN })).ok, true);
  assert.equal((await c.status()).recovery.set, false);
});

test('recovery is disabled under a managed master PIN (and an old code is dropped at setup)', async () => {
  const { c, f, msg } = setup();
  await c.init();
  await msg({ type: 'setSecret', next: PIN, kind: 'pin' });
  await msg({ type: 'createRecovery', secret: PIN });
  const masterRec = await C.hashSecret('master passphrase', 'passphrase');
  f.setManaged({ masterPin: { kind: 'passphrase', iterations: masterRec.iterations, salt: masterRec.salt, hash: masterRec.hash } });
  assert.equal((await c.status()).recovery.available, false);
  assert.equal((await msg({ type: 'createRecovery', secret: 'master passphrase' })).error, 'recovery-managed');
  assert.equal((await msg({ type: 'recoverWithCode', code: 'x', next: NEW_PIN, kind: 'pin' })).error, 'recovery-managed');
  assert.equal((await msg({ type: 'setupManaged', secret: 'master passphrase' })).ok, true);
  assert.equal(f.api.storage.local._dump().recRec, undefined);
});

test('PIN change keeps the recovery code valid (same key pair)', async () => {
  const { c, f, msg } = await configured();
  const { code } = await msg({ type: 'createRecovery', secret: PIN });
  assert.equal((await msg({ type: 'setSecret', current: PIN, next: NEW_PIN, kind: 'pin' }, 'src/pages/options.html')).ok, true);
  assert.equal((await c.status()).recovery.valid, true);
  f.openWindow([{ url: 'https://x.example/' }]);
  await c.lock();
  assert.equal((await msg({ type: 'recoverWithCode', code, next: '909090', kind: 'pin' })).ok, true);
  assert.ok(byUrl(f, 'https://x.example/'));
});

// ---- migration -----------------------------------------------------------------------

test('migration: a browser locked by 0.1.1 (Vault, no mode, old settings) unlocks under 0.1.2, then uses the new default', async () => {
  // Make a genuine 0.1.1-shaped state: Lockdown lock (v2 vault chunk), then strip what 0.1.1 never wrote.
  const a = await configured({ mode: 'lockdown' });
  a.f.openWindow([{ url: 'https://old.example/' }, { url: 'https://old2.example/' }]);
  await a.c.lock();
  const disk = a.f.api.storage.local._dump();
  const { mode, ...lock011 } = disk.lock;
  assert.equal(mode, 'lockdown');
  disk.lock = lock011;
  disk.settings = { timeoutMin: 5, lockOnStartup: true, lockOnUnfocus: true, graceMin: 2, protect: disk.settings.protect, wipeAfter: { enabled: false, n: 20 } };
  assert.equal(disk.vault[0].v, 2);
  a.f.api.storage.local._replace(disk);
  // "update": a fresh worker with the new code over the same storage and tabs
  const c2 = createController(a.f.api, { ...a.clock, sleep: async () => {} });
  await c2.init();
  assert.equal((await c2.status()).phase, 'locked');
  const r = await c2.onMessage({ type: 'unlock', secret: PIN }, a.f.sender());
  assert.equal(r.ok, true);
  assert.equal(r.restoredWindows, 1);
  assert.deepEqual(a.f.allTabs().map((t) => t.url).sort(), ['https://old.example/', 'https://old2.example/']);
  assert.equal((await c2.status()).lockMode, 'hide', 'next lock uses the new default (D5)');
  await c2.lock();
  assert.equal(tokenTabs(a.f).length, 2);
});

test('placesToWindows: old records without a place reopen together; pinned first, order kept', async () => {
  const { placesToWindows, tabPlace } = await import('../src/hide.js');
  const legacy = placesToWindows({ a: { url: 'https://a/' }, b: { url: 'https://b/' } });
  assert.equal(legacy.length, 1);
  assert.deepEqual(legacy[0].tabs.map((t) => [t.url, t.token]), [['https://a/', 'a'], ['https://b/', 'b']]);
  const at = (o) => tabPlace({ windowId: 7, ...o }, { 3: { title: 'T', color: 'red' } }, { 7: { state: 'normal', left: 1, top: 2, width: 300, height: 400 } });
  const w = placesToWindows({
    x: { url: 'https://x/', at: at({ index: 2, groupId: 3 }) },
    y: { url: 'https://y/', at: at({ index: 0, pinned: true }) },
    z: { url: 'https://z/', at: at({ index: 1 }) },
  });
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].tabs.map((t) => t.url), ['https://y/', 'https://z/', 'https://x/']);
  assert.deepEqual(w[0].bounds, { left: 1, top: 2, width: 300, height: 400 });
  assert.deepEqual(w[0].groups, { 3: { title: 'T', color: 'red', collapsed: false } });
  assert.equal(w[0].tabs[2].group, '3');
});
