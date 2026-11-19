// 0.1.5: Tab Lock never focuses, raises, un-minimizes or activates anything on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.js';
import { createController, LOCK_PAGE, ALARM } from '../src/controller.js';
import { tokenFromUrl } from '../src/hide.js';

const LOCK = `chrome-extension://testid/${LOCK_PAGE}`;
const PIN = '482913';

async function configured(settings) {
  const f = createFakeChrome();
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; }, schedule: () => {}, sleep: async () => {} };
  const c = createController(f.api, clock);
  await c.init();
  const msg = (m, page = 'src/pages/lock.html') => c.onMessage(m, f.sender(page));
  assert.equal((await msg({ type: 'setSecret', next: PIN, kind: 'pin' }, 'src/pages/onboarding.html')).ok, true);
  if (settings) assert.equal((await msg({ type: 'saveSettings', settings }, 'src/pages/options.html')).ok, true);
  clock.advance(31_000);
  // Record every call that could bring a window or tab to the front.
  const calls = [];
  const wrap = (obj, name, label) => {
    const orig = obj[name].bind(obj);
    obj[name] = async (...args) => { calls.push({ fn: label, args }); return orig(...args); };
  };
  wrap(f.api.windows, 'update', 'windows.update');
  wrap(f.api.windows, 'create', 'windows.create');
  wrap(f.api.tabs, 'update', 'tabs.update');
  wrap(f.api.tabs, 'create', 'tabs.create');
  return { f, c, clock, msg, calls };
}

/** Calls that would focus, raise, un-minimize or activate. */
function raising(calls) {
  return calls.filter(({ fn, args }) => {
    const p = fn === 'windows.update' || fn === 'tabs.update' ? args[1] : args[0];
    if (!p || typeof p !== 'object') return false;
    if (fn === 'windows.update') return p.focused === true || p.drawAttention === true || (p.state && p.state !== 'minimized');
    if (fn === 'windows.create') return p.focused !== false || p.state === 'maximized' || p.state === 'fullscreen';
    return p.active === true || p.highlighted === true;
  });
}

async function safetyNetAndEvents(c, clock, f) {
  for (let i = 0; i < 5; i++) { clock.advance(30_000); await c.onAlarm({ name: ALARM }); }
  await c.onIdleState('idle');
  await c.onIdleState('locked');
  await c.lock('unfocused');
  await c.onFocusChanged(f.api.windows.WINDOW_ID_NONE);
}

test('default mode: automatic lock, safety net and idle/screen-lock events never raise a (minimized) window', async () => {
  const { f, c, clock, calls } = await configured();
  const w1 = f.openWindow([{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  f.openWindow([{ url: 'https://c.example/' }]);
  await f.api.windows.update(w1, { state: 'minimized' });
  calls.length = 0;
  assert.equal((await c.lock('idle')).ok, true);
  await safetyNetAndEvents(c, clock, f);
  assert.deepEqual(raising(calls), []);
  assert.equal((await f.api.windows.get(w1)).state, 'minimized', 'still minimized');
  assert.equal(f.allTabs().filter((t) => tokenFromUrl(t.url, LOCK)).length, 3, 'every tab still hidden');
});

test('default mode: closing hidden tabs while locked re-creates a lock page without raising it', async () => {
  const { f, c, calls } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock('screen-locked');
  const t = f.allTabs()[0];
  calls.length = 0;
  await f.api.tabs.remove(t.id);
  await c.onTabRemoved(t.id, { isWindowClosing: false });
  assert.ok(f.allTabs().some((x) => x.url.startsWith(LOCK)), 'a PIN prompt exists');
  assert.deepEqual(raising(calls), []);
});

test('Lockdown: automatic lock opens the lock window unfocused, not maximized; the safety net never raises it', async () => {
  const { f, c, clock, calls } = await configured({ mode: 'lockdown' });
  f.openWindow([{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  calls.length = 0;
  assert.equal((await c.lock('idle')).ok, true);
  const created = calls.filter((x) => x.fn === 'windows.create');
  assert.equal(created.length, 1);
  assert.equal(created[0].args[0].focused, false);
  assert.equal(created[0].args[0].state, undefined);
  const lockWin = (await f.api.windows.getAll({ populate: true })).find((w) => w.tabs.some((t) => t.url === LOCK));
  await f.api.windows.update(lockWin.id, { state: 'minimized' });
  calls.length = 0;
  await safetyNetAndEvents(c, clock, f);
  assert.deepEqual(raising(calls), []);
  assert.equal((await f.api.windows.get(lockWin.id)).state, 'minimized', 'still minimized');
  assert.ok(!f.allTabs().some((t) => /a\.example|b\.example/.test(t.url)), 'tabs stay closed');
});

test('Lockdown: closing the lock window re-creates it unfocused', async () => {
  const { f, c, calls } = await configured({ mode: 'lockdown' });
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock('unfocused');
  const lockTab = f.allTabs().find((t) => t.url === LOCK);
  calls.length = 0;
  await f.api.tabs.remove(lockTab.id);
  await c.onTabRemoved(lockTab.id, { isWindowClosing: true });
  assert.ok(f.allTabs().some((t) => t.url === LOCK));
  assert.deepEqual(raising(calls), []);
});

test('Lockdown: locking by hand (toolbar/shortcut/page) focuses the new lock window; unlock restores', async () => {
  for (const reason of ['toolbar', 'shortcut', 'page']) {
    const { f, c, msg, calls } = await configured({ mode: 'lockdown' });
    f.openWindow([{ url: 'https://a.example/' }]);
    calls.length = 0;
    await c.lock(reason);
    const created = calls.filter((x) => x.fn === 'windows.create');
    assert.equal(created[0].args[0].focused, true, reason);
    assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
    assert.ok(f.allTabs().some((t) => t.url === 'https://a.example/'), reason);
  }
});

test('browser start while locked (default mode) does not raise anything', async () => {
  const { f, c, clock, calls } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock('idle');
  f.api.storage.session._replace({});
  const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
  calls.length = 0;
  await c2.init();
  await c2.onStartup();
  for (let i = 0; i < 3; i++) { clock.advance(30_000); await c2.onAlarm({ name: ALARM }); }
  assert.deepEqual(raising(calls), []);
});
