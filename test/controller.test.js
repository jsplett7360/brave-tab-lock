import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.js';
import { createController, LOCK_PAGE } from '../src/controller.js';
import * as C from '../src/crypto.js';

const LOCK = `chrome-extension://testid/${LOCK_PAGE}`;
const PIN = '482913';

function setup(opts) {
  const f = createFakeChrome(opts);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; }, schedule: () => {} };
  const c = createController(f.api, clock);
  const msg = (m, page) => c.onMessage(m, f.sender(page));
  return { f, c, clock, msg };
}

async function configured(opts) {
  const s = setup(opts);
  await s.c.init();
  const r = await s.msg({ type: 'setSecret', next: PIN, kind: 'pin' }, 'src/pages/onboarding.html');
  assert.equal(r.ok, true);
  s.clock.advance(31_000); // past the startup capture window
  return s;
}

const urls = (f) => f.allTabs().map((t) => t.url).sort();

test('nothing locks before a PIN is set', async () => {
  const { c, f } = setup();
  await c.init();
  f.openWindow([{ url: 'https://a.example/' }]);
  assert.equal((await c.lock()).error, 'not-configured');
  assert.deepEqual(urls(f), ['https://a.example/']);
  assert.equal(f.api.action.badge, '!');
});

test('lock: vaults + closes everything, only the lock page remains; private tabs never on disk', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://bank.example/account' }, { url: 'https://news.example/' }]);
  f.openWindow([{ url: 'https://other.example/' }]);
  f.openWindow([{ url: 'https://private-secret.example/' }], { incognito: true });
  f.writes.length = 0;
  assert.equal((await c.lock('test')).ok, true);
  assert.deepEqual(urls(f), [LOCK]);
  assert.equal((await c.status()).phase, 'locked');
  const local = f.api.storage.local._dump();
  const session = f.api.storage.session._dump();
  assert.equal(local.vault.length, 1);
  assert.equal(session.pvault.length, 1);
  assert.equal('pvault' in local, false);
  const diskJson = JSON.stringify(local) + f.writes.filter((w) => w.area === 'local').map((w) => w.json).join('');
  for (const secret of ['bank.example', 'news.example', 'private-secret', PIN]) assert.ok(!diskJson.includes(secret), `${secret} on disk`);
  const sessionWrites = f.writes.filter((w) => w.area === 'session').map((w) => w.json).join('');
  assert.ok(!sessionWrites.includes('private-secret'), 'private tabs are encrypted even in memory');
});

test('while locked: new tabs (e.g. Cmd+Shift+T, new windows, brave:// pages) are closed', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  const wid = f.openWindow([{ url: 'https://reopened.example/' }]);
  const tab = f.allTabs().find((t) => t.windowId === wid);
  await c.onTabCreated(tab);
  const lockTab = f.allTabs().find((t) => t.url === LOCK);
  const t2 = await f.api.tabs.create({ windowId: lockTab.windowId, url: 'chrome://settings/' });
  await c.onTabCreated(t2);
  await f.api.tabs.update(lockTab.id, { url: 'chrome://history/' });
  await c.onTabUpdated(lockTab.id, { url: 'chrome://history/' }, await f.api.tabs.get(lockTab.id));
  assert.deepEqual(urls(f), [LOCK]);
});

test('closing the lock page while locked brings it back', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  const lockTab = f.allTabs().find((t) => t.url === LOCK);
  await f.api.tabs.remove(lockTab.id);
  await c.onTabRemoved(lockTab.id);
  assert.deepEqual(urls(f), [LOCK]);
});

test('unlock restores windows/pinned/groups and deletes the vault', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://p.example/', pinned: true }, { url: 'https://g1.example/', group: 'g' }, { url: 'https://g2.example/', group: 'g' }],
    { groupDefs: { g: { title: 'Trip', color: 'green' } } });
  f.openWindow([{ url: 'https://w2.example/' }]);
  f.openWindow([{ url: 'https://incog.example/' }], { incognito: true });
  await c.lock();
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.restoredWindows, 3);
  assert.deepEqual(urls(f), ['https://g1.example/', 'https://g2.example/', 'https://incog.example/', 'https://p.example/', 'https://w2.example/']);
  const p = f.allTabs().find((t) => t.url === 'https://p.example/');
  assert.equal(p.pinned, true);
  const g1 = f.allTabs().find((t) => t.url === 'https://g1.example/');
  assert.equal((await f.api.tabGroups.get(g1.groupId)).title, 'Trip');
  assert.equal(f.allTabs().find((t) => t.url === 'https://incog.example/').incognito, true);
  assert.equal(f.api.storage.local._dump().vault, undefined);
  assert.equal(f.api.storage.session._dump().pvault, undefined);
  assert.equal((await c.status()).phase, 'unlocked');
});

test('wrong PIN: backoff after 5, persisted across worker restarts', async () => {
  const { c, f, msg, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  for (let i = 0; i < 4; i++) assert.equal((await msg({ type: 'unlock', secret: '000000' })).waitMs, 0);
  const fifth = await msg({ type: 'unlock', secret: '000000' });
  assert.equal(fifth.error, 'wrong');
  assert.equal(fifth.waitMs, 30_000);
  // "restart" the worker: new controller, same storage
  const c2 = createController(f.api, clock);
  await c2.init();
  const blocked = await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.equal(blocked.error, 'backoff');
  assert.deepEqual(urls(f), [LOCK], 'still locked');
  clock.advance(30_001);
  assert.equal((await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender())).ok, true);
  assert.equal((await c2.status()).failures, 0);
});

test('locked state survives a worker restart and a browser restart', async () => {
  const { c, f, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  // browser restart: session storage cleared, all windows gone, Brave reopens only the lock tab... or nothing
  f.api.storage.session._replace({});
  for (const id of [...f.wins.keys()]) await f.api.windows.remove(id);
  const c2 = createController(f.api, clock);
  await c2.init();
  await c2.onStartup();
  assert.deepEqual(urls(f), [LOCK]);
  assert.equal(f.api.storage.local._dump().vault.length, 1, 'vault kept');
  const r = await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.equal(r.ok, true);
  assert.deepEqual(urls(f), ['https://a.example/']);
});

test('session-restore tabs arriving after a startup lock are vaulted, not lost', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://early.example/' }]);
  await f.api.storage.session.remove('startupDone'); // as after a browser restart
  await c.onStartup();
  const wid = f.openWindow([{ url: 'https://late.example/' }]);
  await c.onTabCreated(f.allTabs().find((t) => t.windowId === wid));
  assert.deepEqual(urls(f), [LOCK]);
  await msg({ type: 'unlock', secret: PIN });
  assert.deepEqual(urls(f), ['https://early.example/', 'https://late.example/']);
});

test('worker dies mid-lock ("locking") → next wake re-locks without losing saved tabs', async () => {
  const { c, f, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  // simulate: a crash left phase=locking with a tab still open
  await f.api.storage.local.set({ lock: { phase: 'locking' } });
  f.openWindow([{ url: 'https://b.example/' }]);
  const c2 = createController(f.api, clock);
  await c2.init();
  assert.equal((await c2.status()).phase, 'locked');
  assert.deepEqual(urls(f), [LOCK]);
  await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.deepEqual(urls(f), ['https://a.example/', 'https://b.example/']);
});

test('restore failure keeps the vault; retry succeeds', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  f.failNextWindowCreates(2); // first try + blank-window fallback
  const r = await msg({ type: 'unlock', secret: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.restoreErrors, 1);
  assert.equal(f.api.storage.local._dump().vault.length, 1, 'vault kept');
  assert.ok(f.allTabs().some((t) => t.url === LOCK), 'lock page stays to offer retry');
  const r2 = await msg({ type: 'retryRestore', secret: PIN });
  assert.equal(r2.restoredWindows, 1);
  assert.equal(f.api.storage.local._dump().vault, undefined);
});

test('protected pages: redirect to PIN, correct PIN grants a grace window', async () => {
  const { c, f, msg, clock } = await configured();
  const wid = f.openWindow([{ url: 'chrome://newtab/' }]);
  const tab = f.allTabs().find((t) => t.windowId === wid);
  await f.api.tabs.update(tab.id, { url: 'chrome://settings/passwords' });
  await c.onTabUpdated(tab.id, { url: 'chrome://settings/passwords' }, await f.api.tabs.get(tab.id));
  const gated = await f.api.tabs.get(tab.id);
  assert.match(gated.url, /lock\.html\?gate=/);
  const token = new URL(gated.url).searchParams.get('gate');
  assert.deepEqual((await msg({ type: 'status', gate: token })).gate, { cat: 'passwords' });
  assert.equal((await msg({ type: 'openGate', token, secret: '999999' })).error, 'wrong');
  assert.equal((await msg({ type: 'openGate', token, secret: PIN })).ok, true);
  assert.equal((await f.api.tabs.get(tab.id)).url, 'chrome://settings/passwords');
  await c.onTabUpdated(tab.id, { url: 'chrome://settings/passwords' }, await f.api.tabs.get(tab.id));
  assert.equal((await f.api.tabs.get(tab.id)).url, 'chrome://settings/passwords', 'grace');
  // a different category still needs the PIN
  await f.api.tabs.update(tab.id, { url: 'chrome://extensions/' });
  await c.onTabUpdated(tab.id, { url: 'chrome://extensions/' }, await f.api.tabs.get(tab.id));
  assert.match((await f.api.tabs.get(tab.id)).url, /gate=/);
  clock.advance(2 * 60_000 + 1);
  await f.api.tabs.update(tab.id, { url: 'chrome://password-manager/passwords' });
  await c.onTabUpdated(tab.id, { url: 'chrome://password-manager/passwords' }, await f.api.tabs.get(tab.id));
  assert.match((await f.api.tabs.get(tab.id)).url, /gate=/, 'grace expired');
  assert.equal((await msg({ type: 'openGate', token: 'forged', secret: PIN })).error, 'expired');
});

test('settings need the PIN; disabled categories are not gated', async () => {
  const { c, f, msg, clock } = await configured();
  clock.advance(3 * 60_000); // setup grace over
  assert.equal((await msg({ type: 'saveSettings', settings: { protect: { history: false } } }, 'src/pages/options.html')).error, 'auth');
  assert.equal((await msg({ type: 'authOptions', secret: PIN }, 'src/pages/options.html')).ok, true);
  assert.equal((await msg({ type: 'saveSettings', settings: { protect: { history: false } } }, 'src/pages/options.html')).ok, true);
  const wid = f.openWindow([{ url: 'chrome://history/' }]);
  const tab = f.allTabs().find((t) => t.windowId === wid);
  await c.onTabCreated(tab);
  assert.equal((await f.api.tabs.get(tab.id)).url, 'chrome://history/');
});

test('PIN change rewraps the key; vault saved before the change opens with the new PIN', async () => {
  const { c, f, msg } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  // simulate a change while locked is impossible via UI; do it unlocked:
  await msg({ type: 'unlock', secret: PIN });
  await c.lock();
  // unlock, change, lock again with an older chunk still present? keep it simple:
  await msg({ type: 'unlock', secret: PIN });
  assert.equal((await msg({ type: 'setSecret', current: 'nope00', next: 'a long passphrase', kind: 'passphrase' }, 'src/pages/options.html')).error, 'wrong');
  assert.equal((await msg({ type: 'setSecret', current: PIN, next: 'short', kind: 'passphrase' }, 'src/pages/options.html')).error, 'invalid');
  assert.equal((await msg({ type: 'setSecret', current: PIN, next: 'a long passphrase', kind: 'passphrase' }, 'src/pages/options.html')).ok, true);
  await c.lock();
  assert.equal((await msg({ type: 'unlock', secret: PIN })).error, 'wrong');
  assert.equal((await msg({ type: 'unlock', secret: 'a long passphrase' })).ok, true);
  assert.deepEqual(urls(f), ['https://a.example/']);
});

test('messages from anything but our own pages are refused', async () => {
  const { c } = await configured();
  assert.equal((await c.onMessage({ type: 'status' }, { id: 'other', url: 'chrome-extension://other/x.html' })).error, 'forbidden');
  assert.equal((await c.onMessage({ type: 'status' }, { id: 'testid', url: 'https://evil.example/' })).error, 'forbidden');
});

test('wipe after N failures (optional, off by default)', async () => {
  const { c, f, msg, clock } = await configured();
  await msg({ type: 'saveSettings', settings: { wipeAfter: { enabled: true, n: 6 } } }, 'src/pages/options.html');
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  let last;
  for (let i = 0; i < 6; i++) { last = await msg({ type: 'unlock', secret: '000000' }); clock.advance(3_600_000); }
  assert.equal(last.wiped, true);
  assert.equal(f.api.storage.local._dump().vault, undefined);
  assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
  assert.equal((await c.status()).notice, 'wiped');
});

test('idle, screen-lock, unfocus and shortcut triggers', async () => {
  const { c, f, msg, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.onIdleState('active');
  assert.equal((await c.status()).phase, 'unlocked');
  await c.onIdleState('idle');
  assert.equal((await c.status()).phase, 'locked');
  await msg({ type: 'unlock', secret: PIN });
  await c.onIdleState('locked');
  assert.equal((await c.status()).phase, 'locked');
  await msg({ type: 'unlock', secret: PIN });
  await c.onCommand('lock-now');
  assert.equal((await c.status()).phase, 'locked');
  await msg({ type: 'unlock', secret: PIN });
  await c.onFocusChanged(-1);
  clock.advance(4 * 60_000);
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal((await c.status()).phase, 'unlocked', 'not yet');
  await c.onFocusChanged(3); // refocused → timer resets
  clock.advance(2 * 60_000);
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal((await c.status()).phase, 'unlocked');
  await c.onFocusChanged(-1);
  clock.advance(5 * 60_000);
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal((await c.status()).phase, 'locked');
  assert.equal(f.api.idle.interval, 300);
});

test('managed master PIN: overrides local, PIN change disabled, setup once, then lock/unlock', async () => {
  const { c, f, msg } = setup();
  const masterRec = await C.hashSecret('master passphrase', 'passphrase');
  f.setManaged({ masterPin: { kind: 'passphrase', iterations: masterRec.iterations, salt: masterRec.salt, hash: masterRec.hash } });
  await c.init();
  let st = await c.status();
  assert.equal(st.managed, true);
  assert.equal(st.managedSetupDone, false);
  assert.equal((await msg({ type: 'setSecret', next: '123456', kind: 'pin' })).error, 'managed');
  assert.equal((await msg({ type: 'setupManaged', secret: 'wrong passphrase' })).error, 'wrong');
  assert.equal((await msg({ type: 'setupManaged', secret: 'master passphrase' })).ok, true);
  assert.equal((await c.status()).managedSetupDone, true);
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  assert.equal((await msg({ type: 'unlock', secret: 'master passphrase' })).ok, true);
  assert.deepEqual(urls(f), ['https://a.example/']);
});

test('managed, before per-profile setup: lock uses a memory-only key (lost on restart → reported)', async () => {
  const { c, f, msg, clock } = setup();
  const rec = await C.hashSecret('master passphrase', 'passphrase');
  f.setManaged({ masterPin: { kind: 'passphrase', iterations: rec.iterations, salt: rec.salt, hash: rec.hash } });
  await c.init();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  assert.equal(f.api.storage.local._dump().vault[0].kid, 'session');
  // same session: unlock works
  assert.equal((await msg({ type: 'unlock', secret: 'master passphrase' })).restoredWindows, 1);
  // new lock (now with a key record) → fine; simulate an old session chunk lost on restart:
  await f.api.storage.local.set({ vault: [{ kid: 'session', v: 1, wk: 'x', iv: 'x', ct: 'x', tabs: 1 }] });
  f.api.storage.session._replace({});
  const c2 = createController(f.api, clock);
  const r = await c2.onMessage({ type: 'unlock', secret: 'master passphrase' }, f.sender());
  assert.equal(r.lostChunks, 1);
  assert.equal((await c2.onMessage({ type: 'discardUnopenable', secret: 'master passphrase' }, f.sender())).ok, true);
  assert.equal(f.api.storage.local._dump().vault, undefined);
});

test('master PIN changed by installer: old vault needs the previous PIN', async () => {
  const { c, f, msg } = setup();
  const r1 = await C.hashSecret('old master pass', 'passphrase');
  f.setManaged({ masterPin: { kind: 'passphrase', iterations: r1.iterations, salt: r1.salt, hash: r1.hash } });
  await c.init();
  await msg({ type: 'setupManaged', secret: 'old master pass' });
  f.openWindow([{ url: 'https://before.example/' }]);
  await c.lock();
  const r2 = await C.hashSecret('new master pass', 'passphrase');
  f.setManaged({ masterPin: { kind: 'passphrase', iterations: r2.iterations, salt: r2.salt, hash: r2.hash } });
  assert.equal((await msg({ type: 'unlock', secret: 'old master pass' })).error, 'wrong');
  const u = await msg({ type: 'unlock', secret: 'new master pass' });
  assert.equal(u.ok, true);
  assert.equal(u.oldChunks, 1);
  assert.equal((await c.status()).phase, 'unlocked');
  assert.equal((await msg({ type: 'recoverOld', secret: 'not it at all' })).error, 'wrong');
  const rec = await msg({ type: 'recoverOld', secret: 'old master pass' });
  assert.equal(rec.restoredWindows, 1);
  assert.ok(urls(f).includes('https://before.example/'));
  assert.equal(f.api.storage.local._dump().oldKeys, undefined);
});

test('already locked at startup: tabs Brave opened before our listeners are vaulted, then closed', async () => {
  const { c, f, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  // browser restart: Brave reopens the lock tab plus a restored tab and a new-tab page
  f.api.storage.session._replace({});
  const lockWin = f.allTabs().find((t) => t.url === LOCK).windowId;
  await f.api.tabs.create({ windowId: lockWin, url: 'https://restored.example/' });
  f.openWindow([{ url: 'chrome://newtab/' }]);
  const c2 = createController(f.api, clock);
  await c2.init();
  await c2.onStartup();
  assert.deepEqual(urls(f), [LOCK]);
  await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.deepEqual(urls(f), ['https://a.example/', 'https://restored.example/'], 'new-tab pages are not worth saving');
});

test('locked tick (safety net) closes stragglers outside the startup window', async () => {
  const { c, f } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  f.openWindow([{ url: 'https://sneaky.example/' }]); // no event delivered
  await c.onAlarm({ name: 'tablock-tick' });
  assert.deepEqual(urls(f), [LOCK]);
});
