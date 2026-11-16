// 0.1.3: updates never install while anything is locked, hidden or saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.js';
import { createController, LOCK_PAGE, APPLY_UPDATE_GRACE_MS } from '../src/controller.js';
import { tokenFromUrl } from '../src/hide.js';

const LOCK = `chrome-extension://testid/${LOCK_PAGE}`;
const PIN = '482913';

async function configured(settings) {
  const f = createFakeChrome();
  let t = 1_000_000;
  const scheduled = [];
  const clock = { now: () => t, advance: (ms) => { t += ms; }, schedule: (fn) => scheduled.push(fn), sleep: async () => {} };
  const c = createController(f.api, clock);
  await c.init();
  const msg = (m, page = 'src/pages/lock.html') => c.onMessage(m, f.sender(page));
  assert.equal((await msg({ type: 'setSecret', next: PIN, kind: 'pin' }, 'src/pages/onboarding.html')).ok, true);
  if (settings) assert.equal((await msg({ type: 'saveSettings', settings }, 'src/pages/options.html')).ok, true);
  clock.advance(31_000);
  const runScheduled = async () => { while (scheduled.length) await scheduled.shift()(); };
  return { f, c, clock, msg, runScheduled };
}
const tokenTabs = (f) => f.allTabs().filter((t) => tokenFromUrl(t.url, LOCK));

test('hidden tabs are kept from auto-discard; revealed tabs get it back', async () => {
  const { f, c, msg } = await configured();
  f.openWindow([{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  await c.lock();
  assert.ok(tokenTabs(f).every((t) => t.autoDiscardable === false));
  await msg({ type: 'unlock', secret: PIN });
  assert.ok(f.allTabs().every((t) => t.autoDiscardable === true));
});

test('update available while locked (default mode): remembered, no reload', async () => {
  const { f, c } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  await c.onUpdateAvailable({ version: '0.1.4' });
  assert.equal(f.api.runtime.reloads, 0);
  assert.deepEqual(f.api.storage.local._dump().updatePending, { version: '0.1.4', at: 1_031_000 });
  assert.equal((await c.status()).updatePending, true);
  await c.onAlarm({ name: 'tablock-tick' });
  assert.equal(f.api.runtime.reloads, 0, 'the 30 s safety net never reloads while locked');
});

test('unlock with nothing held → installs the pending update (after the reply), marks it as our own', async () => {
  const { f, c, msg, runScheduled } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  await c.onUpdateAvailable({ version: '0.1.4' });
  assert.equal((await msg({ type: 'unlock', secret: PIN })).ok, true);
  assert.equal(f.api.runtime.reloads, 0, 'not inside the unlock reply');
  await runScheduled();
  assert.equal(f.api.runtime.reloads, 1);
  assert.ok(f.api.storage.local._dump().applyingUpdate);
});

test('the flag survives a worker restart; applied on the next safe wake-up', async () => {
  const { f, c, clock } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.lock();
  await c.onUpdateAvailable({});
  const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
  await c2.init();
  assert.equal(f.api.runtime.reloads, 0, 'still locked');
  assert.ok(f.api.storage.local._dump().updatePending);
  await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  const c3 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
  await c3.init(); // e.g. the worker woke for the alarm
  assert.equal(f.api.runtime.reloads, 1);
});

test('never while anything is held: Lockdown vault, private tabs in memory, orphaned hidden tabs, a lock page open', async () => {
  // Lockdown vault while locked
  {
    const { f, c } = await configured({ mode: 'lockdown' });
    f.openWindow([{ url: 'https://a.example/' }]);
    await c.lock();
    await c.onUpdateAvailable({});
    assert.equal(await c._internal.updateBlocker(), 'locked');
    assert.equal(f.api.runtime.reloads, 0);
  }
  // unlocked but a vault chunk stayed (restore failed)
  {
    const { f, c } = await configured({ mode: 'lockdown' });
    f.openWindow([{ url: 'https://a.example/' }]);
    await c.lock();
    const d = f.api.storage.local._dump();
    d.lock = { phase: 'unlocked', since: 1 };
    f.api.storage.local._replace(d);
    await c.onUpdateAvailable({});
    assert.equal(await c._internal.updateBlocker(), 'saved-tabs');
    assert.equal(f.api.runtime.reloads, 0);
  }
  // private tabs kept in memory (a reload would empty storage.session)
  {
    const { f, c } = await configured();
    await f.api.storage.session.set({ pvault: [{ fake: 1 }] });
    await c.onUpdateAvailable({});
    assert.equal(await c._internal.updateBlocker(), 'private-tabs');
  }
  // orphaned hidden tabs waiting for Reopen/Discard
  {
    const { f, c, msg } = await configured();
    f.openWindow([{ url: 'https://gone.example/' }, { url: 'https://stay.example/' }]);
    await c.lock();
    await f.api.tabs.remove(tokenTabs(f)[0].id);
    await msg({ type: 'unlock', secret: PIN });
    await c.onUpdateAvailable({});
    assert.equal(await c._internal.updateBlocker(), 'hidden-tabs');
    assert.equal(f.api.runtime.reloads, 0);
  }
  // a Tab Lock lock page open (e.g. a PIN prompt)
  {
    const { f, c } = await configured();
    f.openWindow([{ url: `${LOCK}?gate=abc` }]);
    await c.onUpdateAvailable({});
    assert.equal(await c._internal.updateBlocker(), 'lock-page-open');
    assert.equal(f.api.runtime.reloads, 0);
  }
});

test('nothing held and unlocked: installs right away', async () => {
  const { f, c } = await configured();
  f.openWindow([{ url: 'https://a.example/' }]);
  await c.onUpdateAvailable({ version: '0.1.4' });
  assert.equal(f.api.runtime.reloads, 1);
});

test('our own update reload is not a browser start (no lock); a stale marker or a real start still locks', async () => {
  // fresh reload right after applying: no lock
  {
    const { f, c, clock } = await configured();
    f.openWindow([{ url: 'https://a.example/' }]);
    await c.onUpdateAvailable({});
    assert.equal(f.api.runtime.reloads, 1);
    f.api.storage.session._replace({}); // what a reload does
    const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
    await c2.init();
    assert.equal((await c2.status()).phase, 'unlocked');
    assert.equal(f.api.storage.local._dump().applyingUpdate, undefined, 'marker is single-use');
    assert.equal(f.api.runtime.reloads, 1, 'no reload loop: init after our own reload does not reload again');
    assert.equal(f.api.storage.local._dump().updatePending, undefined, 'pending flag cleared by the reload itself');
    await c2.onInstalled({ reason: 'update' });
    assert.equal(f.api.storage.local._dump().updatePending, undefined);
  }
  // marker older than the grace period (e.g. Brave quit and restarted later): a normal start → lock
  {
    const { f, c, clock } = await configured();
    f.openWindow([{ url: 'https://a.example/' }]);
    await c.onUpdateAvailable({});
    clock.advance(APPLY_UPDATE_GRACE_MS + 1);
    f.api.storage.session._replace({});
    const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
    await c2.init();
    assert.equal((await c2.status()).phase, 'locked');
  }
  // an update Brave installed by itself (no marker): treated as a start → lock (documented)
  {
    const { f, clock } = await configured();
    f.openWindow([{ url: 'https://a.example/' }]);
    f.api.storage.session._replace({});
    const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
    await c2.init();
    assert.equal((await c2.status()).phase, 'locked');
  }
});

test('0.1.2 hidden tabs unlock under 0.1.3 (same storage format)', async () => {
  const { f, c, clock } = await configured();
  f.openWindow([{ url: 'https://kept.example/' }]);
  await c.lock();
  // simulate 0.1.2: tabs had no autoDiscardable flag, no update fields
  for (const t of f.tabs.values()) delete t.autoDiscardable;
  const c2 = createController(f.api, { ...clock, schedule: () => {}, sleep: async () => {} });
  await c2.init();
  assert.ok(tokenTabs(f).every((t) => t.autoDiscardable === false), '0.1.3 applies no-discard to tabs 0.1.2 hid');
  const r = await c2.onMessage({ type: 'unlock', secret: PIN }, f.sender());
  assert.equal(r.ok, true);
  assert.equal(r.revealedTabs, 1);
  assert.ok(f.allTabs().some((t) => t.url === 'https://kept.example/'));
});
