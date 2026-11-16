import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, parseSitePattern, parseSiteList, matchesSite, effectiveScope, DEFAULTS } from '../src/settings.js';
import { newToken, tokenFromUrl, hideUrl, samePage } from '../src/hide.js';
import * as C from '../src/crypto.js';

test('defaults: hide mode, all tabs; unknown values fall back; empty site list → all', () => {
  const s = sanitize({});
  assert.equal(s.mode, 'hide');
  assert.equal(s.scope, 'all');
  assert.deepEqual(s.sites, []);
  assert.equal(sanitize({ mode: 'evil', scope: 'nope' }).mode, DEFAULTS.mode);
  assert.equal(sanitize({ scope: 'sites', sites: [] }).scope, 'all');
  assert.equal(sanitize({ scope: 'sites', sites: ['A.example'] }).scope, 'sites');
  assert.equal(effectiveScope(sanitize({ mode: 'lockdown', scope: 'sites', sites: ['a.example'] })), 'all');
});

test('site patterns: exact, wildcard, pasted address, IDN, port, rejects', () => {
  assert.deepEqual(parseSitePattern('Mail.Proton.me'), { pattern: 'mail.proton.me' });
  assert.deepEqual(parseSitePattern('*.bank.com'), { pattern: '*.bank.com' });
  assert.deepEqual(parseSitePattern('https://mail.proton.me/u/0/inbox?x=1'), { pattern: 'mail.proton.me' });
  assert.deepEqual(parseSitePattern('mail.proton.me/inbox'), { pattern: 'mail.proton.me' });
  assert.deepEqual(parseSitePattern('bücher.example'), { pattern: 'xn--bcher-kva.example' });
  assert.deepEqual(parseSitePattern('localhost:8765'), { pattern: 'localhost' });
  for (const bad of ['', '   ', 'a*b.com', '*.com', '*.', 'ftp://x.example', 'exa mple.com', '*.https://a.com']) {
    assert.ok(parseSitePattern(bad).error, `should reject ${JSON.stringify(bad)}`);
  }
  const { sites, errors } = parseSiteList('mail.proton.me\n\n*.bank.com\nmail.proton.me\nbad*one\n');
  assert.deepEqual(sites, ['mail.proton.me', '*.bank.com']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 5);
});

test('matchesSite: exact host only; wildcard = apex + subdomains; http/https only', () => {
  const sites = ['mail.proton.me', '*.bank.com'];
  assert.equal(matchesSite('https://mail.proton.me/u/0', sites), true);
  assert.equal(matchesSite('https://proton.me/', sites), false);
  assert.equal(matchesSite('https://evil-mail.proton.me/', sites), false);
  assert.equal(matchesSite('https://bank.com/', sites), true);
  assert.equal(matchesSite('https://a.b.bank.com:8443/x', sites), true);
  assert.equal(matchesSite('https://notbank.com/', sites), false);
  assert.equal(matchesSite('https://bank.com.evil.example/', sites), false);
  assert.equal(matchesSite('chrome://settings/', sites), false);
  assert.equal(matchesSite('not a url', sites), false);
});

test('hide tokens: 128 random bits, hex; only exact lock#token URLs parse', () => {
  const t = newToken(C.randomBytes);
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.notEqual(t, newToken(C.randomBytes));
  const L = 'chrome-extension://x/src/pages/lock.html';
  assert.equal(tokenFromUrl(hideUrl(L, t), L), t);
  assert.equal(tokenFromUrl(L, L), null);
  assert.equal(tokenFromUrl(`${L}?gate=abc`, L), null);
  assert.equal(tokenFromUrl(`${L}#https://bank.example`, L), null);
  assert.equal(samePage('https://a.example/x#top', 'https://a.example/x'), true);
  assert.equal(samePage('https://a.example/x', 'https://a.example/y'), false);
});

test('recovery code: 128 bits, Crockford alphabet, 26 chars, grouping, tolerant input', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    const c = C.generateRecoveryCode();
    assert.equal(c.length, 26);
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    codes.add(c);
  }
  assert.equal(codes.size, 50);
  assert.equal(C.encodeCrockford(new Uint8Array(16)), '0'.repeat(26));
  assert.equal(C.encodeCrockford(new Uint8Array(16).fill(255)), 'Z'.repeat(25) + 'W'); // last char carries 3 bits: 111 + 00 padding = 28 = W
  const c = C.generateRecoveryCode();
  const shown = C.formatRecoveryCode(c);
  assert.match(shown, /^(.{4}-){6}.{2}$/);
  assert.equal(C.normalizeRecoveryCode(shown.toLowerCase().replace(/-/g, ' ')), c);
  assert.equal(C.normalizeRecoveryCode('0000-0000-0000-0000-0000-0000-0'), null);
  assert.equal(C.normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU-UUUU-UUUU-UU'), null);
  assert.equal(C.normalizeRecoveryCode('oooo-iiii-llll-0000-0000-0000-00'), '0000111111110000000000000' + '0');
});

test('recovery record: verifies only the right code; opens the same private key; never contains the code', async () => {
  const pinRec = await C.hashSecret('482913', 'pin');
  const keyRec = { ...(await C.createKeyRecord('482913', C.recordId(pinRec))), kid: 'k1' };
  const code = C.generateRecoveryCode();
  const rr = await C.createRecoveryRecord(code, keyRec, '482913');
  assert.ok(!JSON.stringify(rr).includes(code));
  assert.equal(rr.hash.kind, 'recovery');
  assert.equal(rr.hash.iterations, 600_000);
  assert.notEqual(rr.kekSalt, keyRec.kekSalt);
  assert.equal(await C.verifyRecoveryCode(C.formatRecoveryCode(code), rr), true);
  assert.equal(await C.verifyRecoveryCode(C.generateRecoveryCode(), rr), false);
  // a recovery hash is not accepted as a PIN record
  await assert.rejects(() => C.verifySecret(code, rr.hash), /bad kind/);
  // reset: new PIN opens the same key → a sealed value still opens
  const sealed = await C.sealFor({ tabs: { t: { url: 'https://x' } } }, [{ kid: 'k1', pub: keyRec.pub }]);
  const newPin = await C.hashSecret('555555', 'pin');
  const k2 = { ...(await C.rewrapFromRecovery(keyRec, rr, code, '555555', C.recordId(newPin))), kid: 'k1' };
  const priv = await C.unwrapPrivateKey(k2, '555555');
  assert.deepEqual(await C.openWithAny(sealed, { k1: priv }), { tabs: { t: { url: 'https://x' } } });
  await assert.rejects(() => C.unwrapPrivateKey(k2, '482913'));
  await assert.rejects(() => C.rewrapFromRecovery({ ...keyRec, kid: 'other' }, rr, code, '1', 'x'), /older key/);
});
