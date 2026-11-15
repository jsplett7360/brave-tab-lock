import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as C from '../src/crypto.js';

const hex = (u8) => Buffer.from(u8).toString('hex');
const bytes = (s) => new TextEncoder().encode(s);

test('PBKDF2-SHA256 known-answer vectors (RFC 7914 §11)', async () => {
  assert.equal(hex(await C.pbkdf2Sha256('passwd', bytes('salt'), 1, 512)),
    '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783');
  assert.equal(hex(await C.pbkdf2Sha256('Password', bytes('NaCl'), 80000, 512)),
    '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d');
});

test('hashSecret matches an independent implementation (Python hashlib, as used by the installer)', async () => {
  const rec = await C.hashSecret('correct horse battery', 'passphrase');
  const py = execFileSync('python3', ['-I', '-c',
    'import hashlib,base64,sys;s=base64.b64decode(sys.argv[2]);print(base64.b64encode(hashlib.pbkdf2_hmac("sha256",sys.argv[1].encode(),s,int(sys.argv[3]))).decode())',
    'correct horse battery', rec.salt, String(rec.iterations)]).toString().trim();
  assert.equal(rec.hash, py);
});

test('hashSecret record: >= 600k iterations, 16-byte salt, no secret inside', async () => {
  const rec = await C.hashSecret('123456', 'pin');
  assert.ok(rec.iterations >= 600_000);
  assert.equal(C.fromB64(rec.salt).length, 16);
  assert.equal(C.fromB64(rec.hash).length, 32);
  assert.ok(!JSON.stringify(rec).includes('123456'));
  const rec2 = await C.hashSecret('123456', 'pin');
  assert.notEqual(rec.salt, rec2.salt, 'salt must be random');
});

test('verifySecret: right / wrong / empty', async () => {
  const rec = await C.hashSecret('482913', 'pin');
  assert.equal(await C.verifySecret('482913', rec), true);
  assert.equal(await C.verifySecret('482914', rec), false);
  assert.equal(await C.verifySecret('', rec), false);
});

test('weak or malformed records are rejected', async () => {
  const rec = await C.hashSecret('482913', 'pin');
  await assert.rejects(C.verifySecret('482913', { ...rec, iterations: 1000 }), RangeError);
  await assert.rejects(C.verifySecret('482913', { ...rec, alg: 'MD5' }), TypeError);
  await assert.rejects(C.hashSecret('x', 'pin', { iterations: 10 }), RangeError);
});

test('constantTimeEqual', () => {
  assert.equal(C.constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(C.constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(C.constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])), false);
  assert.equal(C.constantTimeEqual(new Uint8Array(0), new Uint8Array(0)), true);
  assert.equal(C.constantTimeEqual('ab', 'ab'), false);
});

test('validateSecret', () => {
  assert.equal(C.validateSecret('123456', 'pin'), null);
  assert.match(C.validateSecret('12345', 'pin'), /6 digits/);
  assert.match(C.validateSecret('12345a', 'pin'), /digits only/);
  assert.equal(C.validateSecret('abcdefgh', 'passphrase'), null);
  assert.match(C.validateSecret('abc', 'passphrase'), /8 characters/);
  assert.ok(C.validateSecret('123456', 'other'));
});

test('key record: PIN opens private key, wrong PIN does not, no secrets stored', async () => {
  const kr = await C.createKeyRecord('246810', 'bound');
  assert.equal(kr.boundTo, 'bound');
  assert.ok(kr.kekIterations >= 600_000);
  const json = JSON.stringify(kr);
  assert.ok(!json.includes('246810'));
  const priv = await C.unwrapPrivateKey(kr, '246810');
  assert.equal(priv.extractable, false);
  await assert.rejects(C.unwrapPrivateKey(kr, '246811'));
  const sealed = await C.seal({ hello: 'world' }, kr.pub);
  assert.deepEqual(await C.open(sealed, priv), { hello: 'world' });
});

test('rewrapKeyRecord: new PIN opens the same key; old PIN no longer does', async () => {
  const kr = await C.createKeyRecord('111111', 'a');
  const sealed = await C.seal([1, 2, 3], kr.pub);
  const kr2 = await C.rewrapKeyRecord(kr, '111111', 'new passphrase', 'b');
  assert.equal(kr2.pub, kr.pub);
  assert.notEqual(kr2.kekSalt, kr.kekSalt);
  assert.deepEqual(await C.open(sealed, await C.unwrapPrivateKey(kr2, 'new passphrase')), [1, 2, 3]);
  await assert.rejects(C.unwrapPrivateKey(kr2, '111111'));
  await assert.rejects(C.rewrapKeyRecord(kr, 'wrong1', 'x', 'c'));
});

test('seal: fresh IV and data key every time; tamper and wrong key fail', async () => {
  const kr = await C.createKeyRecord('135790', 'x');
  const priv = await C.unwrapPrivateKey(kr, '135790');
  const a = await C.seal({ v: 1 }, kr.pub);
  const b = await C.seal({ v: 1 }, kr.pub);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.wk, b.wk);
  assert.notEqual(a.ct, b.ct);
  assert.equal(C.fromB64(a.iv).length, 12);
  const ct = C.fromB64(a.ct); ct[0] ^= 1;
  await assert.rejects(C.open({ ...a, ct: C.toB64(ct) }, priv));
  const other = await C.unwrapPrivateKey(await C.createKeyRecord('135790', 'y'), '135790');
  await assert.rejects(C.open(a, other));
});

test('ephemeral key pair round-trip', async () => {
  const e = await C.createEphemeralKeyPair();
  const sealed = await C.seal('x', e.pub);
  assert.equal(await C.open(sealed, await C.importEphemeralPrivate(e.priv)), 'x');
});

test('base64 helpers round-trip large buffers', () => {
  const u = new Uint8Array(200_000).map((_, i) => (i * 7919) & 255);
  assert.deepEqual(C.fromB64(C.toB64(u)), u);
});
