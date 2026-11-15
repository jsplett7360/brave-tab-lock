// Tab Lock — wrong-PIN backoff. Pure functions; the state object is persisted in
// chrome.storage.local so it survives service-worker and browser restarts.
//
// The first FREE_ATTEMPTS failures cost nothing. After that, each further failure
// doubles the wait: 30 s, 60 s, 2 min, ... capped at 1 hour.

export const FREE_ATTEMPTS = 5;
export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 60 * 60_000;

export function initialBackoff() {
  return { failures: 0, nextAllowedAt: 0 };
}

export function delayForFailures(failures) {
  if (failures < FREE_ATTEMPTS) return 0;
  const exp = failures - FREE_ATTEMPTS;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(exp, 20));
}

export function normalize(state) {
  const f = Number.isInteger(state?.failures) && state.failures >= 0 ? state.failures : 0;
  const n = Number.isFinite(state?.nextAllowedAt) ? state.nextAllowedAt : 0;
  return { failures: f, nextAllowedAt: n };
}

/** ms the caller must still wait before another attempt (0 = may try now). */
export function waitMs(state, now) {
  const s = normalize(state);
  return Math.max(0, s.nextAllowedAt - now);
}

export function recordFailure(state, now) {
  const s = normalize(state);
  const failures = s.failures + 1;
  return { failures, nextAllowedAt: now + delayForFailures(failures) };
}

export function recordSuccess() {
  return initialBackoff();
}

/** Whether the optional "wipe vault after N failures" rule fires. */
export function shouldWipe(state, settings) {
  const w = settings?.wipeAfter;
  return !!(w && w.enabled && Number.isInteger(w.n) && w.n > 0 && normalize(state).failures >= w.n);
}
