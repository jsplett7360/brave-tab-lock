// Tab Lock — crypto primitives. WebCrypto only; no home-rolled crypto.
//
// PIN verification: PBKDF2-SHA-256, 16-byte random salt, >= 600,000 iterations
// (OWASP Password Storage Cheat Sheet), constant-time compare.
//
// Vault: envelope encryption. Each profile has an RSA-OAEP-3072 key pair. The private
// key is encrypted (AES-GCM-256) with a key derived from the PIN via PBKDF2 using a
// SEPARATE salt. Locking happens while the user is away (PIN unknown), so each lock
// encrypts the vault with a fresh random AES-GCM-256 key that is sealed with the PUBLIC
// key. Opening the vault therefore still requires the PIN. Fresh 12-byte IV per write.
// The PIN and every derived key exist only in memory, never in storage.

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const RECORD_VERSION = 1;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- encoding helpers -------------------------------------------------------------

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64) {
  if (typeof b64 !== 'string') throw new TypeError('expected base64 string');
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** Constant-time comparison of two byte arrays (time depends only on length). */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---- secret (PIN / passphrase) rules ----------------------------------------------

export const MIN_PIN_DIGITS = 6;
export const MIN_PASSPHRASE_CHARS = 8;

/** Returns null if acceptable, else a human-readable reason. */
export function validateSecret(secret, kind) {
  if (typeof secret !== 'string') return 'Enter a PIN or passphrase.';
  if (kind === 'pin') {
    if (!/^[0-9]+$/.test(secret)) return 'A PIN may contain digits only.';
    if (secret.length < MIN_PIN_DIGITS) return `A PIN needs at least ${MIN_PIN_DIGITS} digits.`;
    return null;
  }
  if (kind === 'passphrase') {
    if (secret.length < MIN_PASSPHRASE_CHARS) {
      return `A passphrase needs at least ${MIN_PASSPHRASE_CHARS} characters.`;
    }
    return null;
  }
  return 'Unknown secret type.';
}

// ---- PBKDF2 -----------------------------------------------------------------------

async function pbkdf2Bits(secret, salt, iterations, bits = 256) {
  const base = await subtle.importKey('raw', enc.encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const out = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, bits);
  return new Uint8Array(out);
}

/** Exposed for known-answer tests and installer cross-checks. */
export async function pbkdf2Sha256(secret, saltBytes, iterations, bits = 256) {
  return pbkdf2Bits(secret, saltBytes, iterations, bits);
}

/** Create a verification record for a PIN/passphrase. Contains no secret material. */
export async function hashSecret(secret, kind, { iterations = PBKDF2_ITERATIONS, salt = randomBytes(SALT_BYTES) } = {}) {
  if (iterations < MIN_ITERATIONS) throw new RangeError('iterations below minimum');
  const hash = await pbkdf2Bits(secret, salt, iterations);
  return { v: RECORD_VERSION, alg: 'PBKDF2-SHA256', kind, iterations, salt: toB64(salt), hash: toB64(hash) };
}

/**
 * Throws on a malformed or too-weak record; returns the record otherwise.
 * `kinds`: which record kinds are acceptable here (PIN records by default; a recovery
 * code's record has kind 'recovery' and is only accepted where asked for).
 */
export function checkPinRecord(rec, kinds = ['pin', 'passphrase']) {
  if (!rec || typeof rec !== 'object') throw new TypeError('missing PIN record');
  if (rec.alg !== 'PBKDF2-SHA256') throw new TypeError('unsupported algorithm');
  if (!Number.isInteger(rec.iterations) || rec.iterations < MIN_ITERATIONS) throw new RangeError('iterations below minimum');
  if (!kinds.includes(rec.kind)) throw new TypeError('bad kind');
  const salt = fromB64(rec.salt);
  const hash = fromB64(rec.hash);
  if (salt.length < SALT_BYTES) throw new RangeError('salt too short');
  if (hash.length !== 32) throw new RangeError('bad hash length');
  return rec;
}

export async function verifySecret(secret, rec, kinds) {
  checkPinRecord(rec, kinds);
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const got = await pbkdf2Bits(secret, fromB64(rec.salt), rec.iterations);
  return constantTimeEqual(got, fromB64(rec.hash));
}

// ---- key-encryption key (separate salt) -------------------------------------------

async function deriveKek(secret, salt, iterations) {
  const bits = await pbkdf2Bits(secret, salt, iterations);
  return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

/**
 * Create a new per-profile key pair, private key encrypted under the PIN.
 * `boundTo` is the verification hash this key record was created with (lets us detect
 * a master-PIN change). Returns a storable record (no secrets in clear).
 */
export async function createKeyRecord(secret, boundTo, { iterations = PBKDF2_ITERATIONS } = {}) {
  const pair = await subtle.generateKey(RSA, true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const rec = await wrapPrivate(pkcs8, secret, iterations);
  pkcs8.fill(0);
  return { v: RECORD_VERSION, pub: toB64(spki), ...rec, boundTo };
}

async function wrapPrivate(pkcs8, secret, iterations) {
  const kekSalt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveKek(secret, kekSalt, iterations);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, kek, pkcs8));
  return { kekSalt: toB64(kekSalt), kekIterations: iterations, privIv: toB64(iv), priv: toB64(ct) };
}

async function exportPrivatePkcs8(keyRec, secret) {
  if (!Number.isInteger(keyRec.kekIterations) || keyRec.kekIterations < MIN_ITERATIONS) throw new RangeError('iterations below minimum');
  const kek = await deriveKek(secret, fromB64(keyRec.kekSalt), keyRec.kekIterations);
  // Throws (OperationError) on a wrong secret — AES-GCM authenticates.
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(keyRec.privIv) }, kek, fromB64(keyRec.priv)));
}

/** Decrypt the private key with the PIN. Throws if the PIN doesn't open it. */
export async function unwrapPrivateKey(keyRec, secret) {
  const pkcs8 = await exportPrivatePkcs8(keyRec, secret);
  try {
    return await subtle.importKey('pkcs8', pkcs8, RSA, false, ['decrypt']);
  } finally {
    pkcs8.fill(0);
  }
}

/** Re-encrypt the private key under a new PIN (PIN change). */
export async function rewrapKeyRecord(keyRec, oldSecret, newSecret, boundTo, { iterations = PBKDF2_ITERATIONS } = {}) {
  const pkcs8 = await exportPrivatePkcs8(keyRec, oldSecret);
  try {
    const rec = await wrapPrivate(pkcs8, newSecret, iterations);
    return { v: RECORD_VERSION, pub: keyRec.pub, ...rec, boundTo };
  } finally {
    pkcs8.fill(0);
  }
}

// ---- recovery code ---------------------------------------------------------------
// 128 random bits, Crockford base32 (no I, L, O, U), 26 characters, shown in groups of 4.
// Never stored: only a PBKDF2 hash of it (own salt) and a second copy of the profile's
// private key encrypted under a key derived from it (own KEK salt). So the code alone can
// reset the PIN AND open saved/hidden tabs, exactly like the PIN.

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_BYTES = 16;
export const RECOVERY_CHARS = 26; // ceil(128 / 5)

export function encodeCrockford(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** Group a canonical code for display: XXXX-XXXX-…-XX. */
export function formatRecoveryCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

/** Canonical 26-character form of what the user typed, or null if it can't be a code. */
export function normalizeRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== RECOVERY_CHARS) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}

/** A fresh code (canonical form). The caller shows it once and never stores it. */
export function generateRecoveryCode() {
  const bytes = randomBytes(RECOVERY_BYTES);
  try {
    return encodeCrockford(bytes);
  } finally {
    bytes.fill(0);
  }
}

/**
 * Recovery record for `code`, given the key record and the PIN that opens it now.
 * { v, kind:'recovery-wrap', kid, hash: <PIN-style record, kind 'recovery'>, kekSalt,
 *   kekIterations, privIv, priv, created }. Nothing in it is secret on its own.
 */
export async function createRecoveryRecord(code, keyRec, pin, { iterations = PBKDF2_ITERATIONS, created = Date.now() } = {}) {
  const canon = normalizeRecoveryCode(code);
  if (!canon) throw new TypeError('bad recovery code');
  const hash = await hashSecret(canon, 'recovery', { iterations });
  const pkcs8 = await exportPrivatePkcs8(keyRec, pin);
  try {
    const wrap = await wrapPrivate(pkcs8, canon, iterations);
    return { v: RECORD_VERSION, kind: 'recovery-wrap', kid: keyRec.kid, hash, ...wrap, created };
  } finally {
    pkcs8.fill(0);
  }
}

/** Constant-time check of a typed code against a recovery record (same PBKDF2 cost as a PIN). */
export async function verifyRecoveryCode(code, recRec) {
  const canon = normalizeRecoveryCode(code);
  if (!canon) return false;
  return verifySecret(canon, recRec?.hash, ['recovery']);
}

/**
 * Forgot-PIN reset: open the private key with the recovery code and re-encrypt it under
 * the new PIN. Same key pair, so everything sealed to it still opens.
 */
export async function rewrapFromRecovery(keyRec, recRec, code, newSecret, boundTo, { iterations = PBKDF2_ITERATIONS } = {}) {
  const canon = normalizeRecoveryCode(code);
  if (!canon) throw new TypeError('bad recovery code');
  if (recRec.kid !== keyRec.kid) throw new Error('recovery code belongs to an older key');
  const pkcs8 = await exportPrivatePkcs8(recRec, canon);
  try {
    const rec = await wrapPrivate(pkcs8, newSecret, iterations);
    return { v: RECORD_VERSION, pub: keyRec.pub, ...rec, boundTo };
  } finally {
    pkcs8.fill(0);
  }
}

// ---- session-only key pair (fallback when no PIN-bound key exists yet) -----------

/** A key pair whose private key is returned in clear — caller keeps it in memory only. */
export async function createEphemeralKeyPair() {
  const pair = await subtle.generateKey(RSA, true, ['encrypt', 'decrypt']);
  return {
    pub: toB64(new Uint8Array(await subtle.exportKey('spki', pair.publicKey))),
    priv: toB64(new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))),
  };
}

export async function importEphemeralPrivate(privB64) {
  return subtle.importKey('pkcs8', fromB64(privB64), RSA, false, ['decrypt']);
}

// ---- sealing (vault) ---------------------------------------------------------------

/** Encrypt a JSON-serialisable value to the given public key (base64 SPKI). */
export async function seal(value, pubB64) {
  const pub = await subtle.importKey('spki', fromB64(pubB64), RSA, false, ['encrypt']);
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(value))));
  const raw = new Uint8Array(await subtle.exportKey('raw', dek));
  const wk = new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw));
  raw.fill(0);
  return { v: RECORD_VERSION, alg: 'RSA-OAEP-3072+AES-GCM-256', wk: toB64(wk), iv: toB64(iv), ct: toB64(ct) };
}

/** Decrypt a sealed record with an RSA-OAEP private CryptoKey. Throws on tamper. */
export async function open(sealed, privateKey) {
  const raw = new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromB64(sealed.wk)));
  try {
    const dek = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, dek, fromB64(sealed.ct));
    return JSON.parse(dec.decode(pt));
  } finally {
    raw.fill(0);
  }
}

/**
 * Multi-recipient seal (record version 2): one AES-GCM-256 data key, wrapped separately
 * for each recipient's RSA-OAEP public key. `recipients` = [{ kid, pub }].
 */
export async function sealFor(value, recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) throw new TypeError('no recipients');
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(value))));
  const raw = new Uint8Array(await subtle.exportKey('raw', dek));
  try {
    const wks = [];
    for (const r of recipients) {
      const pub = await subtle.importKey('spki', fromB64(r.pub), RSA, false, ['encrypt']);
      wks.push({ kid: r.kid, wk: toB64(new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw))) });
    }
    return { v: 2, alg: 'RSA-OAEP-3072+AES-GCM-256', wks, iv: toB64(iv), ct: toB64(ct) };
  } finally {
    raw.fill(0);
  }
}

/** Key ids a sealed record can be opened with (handles version 1 and 2). */
export function sealedKids(sealed) {
  return Array.isArray(sealed?.wks) ? sealed.wks.map((w) => w.kid) : [sealed?.kid];
}

/** Open a version-1 or version-2 sealed record with any matching key in `keysByKid`. */
export async function openWithAny(sealed, keysByKid) {
  if (!Array.isArray(sealed?.wks)) {
    const k = keysByKid[sealed?.kid];
    if (!k) throw new Error('no key for this record');
    return open(sealed, k);
  }
  let lastErr = new Error('no key for this record');
  for (const { kid, wk } of sealed.wks) {
    const k = keysByKid[kid];
    if (!k) continue;
    try {
      return await open({ wk, iv: sealed.iv, ct: sealed.ct }, k);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Short, non-secret fingerprint of a PIN record (used for `boundTo`). */
export function recordId(pinRec) {
  return pinRec ? `${pinRec.salt}:${pinRec.hash}` : null;
}
