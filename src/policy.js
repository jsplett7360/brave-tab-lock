// Tab Lock — managed (master PIN) policy parsing. The macOS installer writes a
// PBKDF2 record into Brave's managed extension storage (chrome.storage.managed),
// shared by every profile.

import { checkPinRecord } from './crypto.js';

/** Returns a valid managed PIN record or null (malformed/weak policy is ignored). */
export function managedPinRecord(managed) {
  const m = managed?.masterPin;
  if (!m) return null;
  const rec = { v: 1, alg: 'PBKDF2-SHA256', kind: m.kind, iterations: m.iterations, salt: m.salt, hash: m.hash };
  try {
    return checkPinRecord(rec);
  } catch {
    return null;
  }
}
