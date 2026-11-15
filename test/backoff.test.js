import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backoff.js';

test('first five failures are free, then 30 s doubling, capped at 1 h', () => {
  let s = B.initialBackoff();
  const t = 1_000_000;
  for (let i = 1; i <= 4; i++) { s = B.recordFailure(s, t); assert.equal(B.waitMs(s, t), 0, `failure ${i}`); }
  s = B.recordFailure(s, t); assert.equal(B.waitMs(s, t), 30_000);
  s = B.recordFailure(s, t); assert.equal(B.waitMs(s, t), 60_000);
  s = B.recordFailure(s, t); assert.equal(B.waitMs(s, t), 120_000);
  for (let i = 0; i < 30; i++) s = B.recordFailure(s, t);
  assert.equal(B.waitMs(s, t), 3_600_000);
});

test('wait decreases with time; success resets', () => {
  let s = { failures: 5, nextAllowedAt: 50_000 };
  assert.equal(B.waitMs(s, 20_000), 30_000);
  assert.equal(B.waitMs(s, 60_000), 0);
  s = B.recordSuccess();
  assert.deepEqual(s, { failures: 0, nextAllowedAt: 0 });
});

test('normalize survives garbage (persisted state could be tampered with)', () => {
  assert.deepEqual(B.normalize(undefined), { failures: 0, nextAllowedAt: 0 });
  assert.deepEqual(B.normalize({ failures: -3, nextAllowedAt: 'x' }), { failures: 0, nextAllowedAt: 0 });
  assert.equal(B.recordFailure({ failures: 'a' }, 0).failures, 1);
});

test('shouldWipe only when enabled and threshold reached', () => {
  assert.equal(B.shouldWipe({ failures: 50 }, { wipeAfter: { enabled: false, n: 20 } }), false);
  assert.equal(B.shouldWipe({ failures: 19 }, { wipeAfter: { enabled: true, n: 20 } }), false);
  assert.equal(B.shouldWipe({ failures: 20 }, { wipeAfter: { enabled: true, n: 20 } }), true);
});
