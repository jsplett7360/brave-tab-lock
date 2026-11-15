import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.js';
import { captureWindows, restoreWindows, restorableUrl } from '../src/vault.js';

const own = (u) => u.startsWith('chrome-extension://testid/');

test('capture + restore keeps order, pinned state, groups (title/color) across 2 windows', async () => {
  const f = createFakeChrome();
  f.openWindow([
    { url: 'https://mail.example/', pinned: true },
    { url: 'https://a.example/', group: 'g' },
    { url: 'https://b.example/', group: 'g' },
    { url: 'chrome-extension://testid/src/pages/options.html' },
  ], { groupDefs: { g: { title: 'Work', color: 'blue' } } });
  f.openWindow([{ url: 'https://c.example/' }, { url: 'chrome://settings/' }]);
  f.openWindow([{ url: 'https://private.example/' }], { incognito: true });

  const snap = await captureWindows(f.api, { incognito: false, isOwnUrl: own });
  assert.equal(snap.length, 2);
  assert.deepEqual(snap[0].tabs.map((t) => t.url), ['https://mail.example/', 'https://a.example/', 'https://b.example/']);
  assert.equal(snap[0].groups[snap[0].tabs[1].group].title, 'Work');
  const priv = await captureWindows(f.api, { incognito: true, isOwnUrl: own });
  assert.equal(priv.length, 1);
  assert.equal(priv[0].incognito, true);

  for (const id of [...f.wins.keys()]) await f.api.windows.remove(id);
  const r = await restoreWindows(f.api, snap);
  assert.equal(r.windowIds.length, 2);
  assert.deepEqual(r.failedTabs, []);
  const w1 = (await f.api.windows.get(r.windowIds[0], { populate: true })).tabs;
  assert.deepEqual(w1.map((t) => t.url), ['https://mail.example/', 'https://a.example/', 'https://b.example/']);
  assert.equal(w1[0].pinned, true);
  assert.equal(w1[1].groupId, w1[2].groupId);
  assert.ok(w1[1].groupId >= 0);
  const g = await f.api.tabGroups.get(w1[1].groupId);
  assert.equal(g.title, 'Work');
  assert.equal(g.color, 'blue');
  const w2 = (await f.api.windows.get(r.windowIds[1], { populate: true })).tabs;
  assert.deepEqual(w2.map((t) => t.url), ['https://c.example/', 'chrome://settings/']);
});

test('a tab the browser refuses is reported, not fatal', async () => {
  const f = createFakeChrome();
  f.failUrl('file:///secret.pdf');
  const r = await restoreWindows(f.api, [{ incognito: false, state: 'normal', bounds: {}, groups: {},
    tabs: [{ url: 'https://ok.example/' }, { url: 'file:///secret.pdf', title: 'secret' }] }]);
  assert.equal(r.windowIds.length, 1);
  assert.deepEqual(r.failedTabs, [{ url: 'file:///secret.pdf', title: 'secret' }]);
});

test('window creation failure throws (caller keeps the vault)', async () => {
  const f = createFakeChrome();
  f.failNextWindowCreates(2); // first try + blank-window fallback
  await assert.rejects(restoreWindows(f.api, [{ tabs: [{ url: 'https://x.example/' }] }]));
});

test('restorableUrl', () => {
  assert.equal(restorableUrl(''), undefined);
  assert.equal(restorableUrl('javascript:alert(1)'), undefined);
  assert.equal(restorableUrl('https://x/'), 'https://x/');
});
