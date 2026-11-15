import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, needsGate } from '../src/guard.js';
import { sanitize, DEFAULTS } from '../src/settings.js';

test('classify protected pages (both brave:// and chrome:// spellings)', () => {
  const cases = {
    'chrome://history/': 'history',
    'brave://history': 'history',
    'chrome://history-clusters/': 'history',
    'chrome://settings/': 'settings',
    'brave://settings/privacy': 'settings',
    'chrome://settings/braveSync': 'settings',
    'chrome://password-manager/passwords': 'passwords',
    'brave://password-manager/settings': 'passwords',
    'chrome://settings/passwords': 'passwords',
    'chrome://settings/autofill': 'passwords',
    'chrome://extensions/': 'extensions',
    'chrome://extensions/shortcuts': 'extensions',
    'brave://extensions/?id=abc': 'extensions',
    'chrome://downloads/': 'downloads',
    'CHROME://SETTINGS/': 'settings',
  };
  for (const [u, cat] of Object.entries(cases)) assert.equal(classify(u), cat, u);
});

test('non-protected URLs', () => {
  for (const u of ['chrome://newtab/', 'brave://wallet/', 'https://example.com/settings', 'about:blank', '', null,
    'chrome-extension://x/src/pages/lock.html', 'chrome://settingsx/', 'chrome://settings-frame-evil']) {
    assert.equal(classify(u), null, String(u));
  }
});

test('needsGate honours toggles and grace', () => {
  const protect = { ...DEFAULTS.protect, downloads: false };
  assert.equal(needsGate('chrome://history/', protect, {}, 1000), 'history');
  assert.equal(needsGate('chrome://downloads/', protect, {}, 1000), null);
  assert.equal(needsGate('chrome://history/', protect, { history: 2000 }, 1000), null);
  assert.equal(needsGate('chrome://history/', protect, { history: 2000 }, 3000), 'history');
  assert.equal(needsGate('chrome://settings/', protect, { history: 5000 }, 1000), 'settings', 'grace is per category');
});

test('settings sanitize clamps and drops unknown keys', () => {
  assert.deepEqual(sanitize(undefined), JSON.parse(JSON.stringify(DEFAULTS)));
  const s = sanitize({ timeoutMin: 0, graceMin: 99, evil: 1, protect: { history: false, x: true }, wipeAfter: { enabled: true, n: 2 } });
  assert.equal(s.timeoutMin, DEFAULTS.timeoutMin);
  assert.equal(s.graceMin, DEFAULTS.graceMin);
  assert.equal(s.protect.history, false);
  assert.equal('x' in s.protect, false);
  assert.equal('evil' in s, false);
  assert.deepEqual(s.wipeAfter, { enabled: true, n: 20 });
  assert.equal(sanitize({ timeoutMin: 1 }).timeoutMin, 1);
});
