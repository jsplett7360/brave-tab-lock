import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifySecret } from '../src/crypto.js';
import { managedPinRecord } from '../src/policy.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}installer/out/test-${process.pid}.mobileconfig`;
const ID = 'abcdefghijklmnopabcdefghijklmnop';

test('installer profile: extension accepts its master-PIN record; force-install policy shape', { skip: process.platform !== 'darwin' }, async () => {
  try {
    execFileSync('python3', ['-I', `${root}installer/make_profile.py`, '--extension-id', ID, '--kind', 'passphrase', '--out', out, '--secret-stdin', '--disable-tor'],
      { input: 'correct horse battery staple\n' });
    assert.equal(statSync(out).mode & 0o777, 0o600, 'profile file is private to the user');
    execFileSync('/usr/bin/plutil', ['-lint', out]);
    const raw = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', out]).toString();
    assert.ok(!raw.includes('correct horse'), 'secret not in profile');
    const prof = JSON.parse(raw);
    assert.equal(prof.PayloadType, 'Configuration');
    const content = prof.PayloadContent[0].PayloadContent;
    const brave = content['com.brave.Browser'].Forced[0].mcx_preference_settings;
    assert.deepEqual(brave.ExtensionSettings[ID], { installation_mode: 'force_installed', update_url: 'https://clients2.google.com/service/update2/crx' });
    assert.equal(brave.TorDisabled, true);
    const managed = content[`com.brave.Browser.extensions.${ID}`].Forced[0].mcx_preference_settings;
    const rec = managedPinRecord(managed);
    assert.ok(rec, 'managed record passes the extension policy check');
    assert.equal(rec.iterations, 600_000);
    assert.equal(await verifySecret('correct horse battery staple', rec), true);
    assert.equal(await verifySecret('correct horse battery stapler', rec), false);
  } finally {
    rmSync(out, { force: true });
  }
});

test('installer rejects a weak PIN and a malformed extension ID', { skip: process.platform !== 'darwin' }, () => {
  assert.throws(() => execFileSync('python3', ['-I', `${root}installer/make_profile.py`, '--extension-id', ID, '--kind', 'pin', '--out', out, '--secret-stdin'], { input: '12345\n', stdio: 'pipe' }));
  assert.throws(() => execFileSync('python3', ['-I', `${root}installer/make_profile.py`, '--extension-id', 'xyz', '--out', out, '--secret-stdin'], { input: '123456\n', stdio: 'pipe' }));
});

test('managed policy with weak iterations is ignored', () => {
  assert.equal(managedPinRecord({ masterPin: { kind: 'pin', iterations: 1000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: 'A'.repeat(43) + '=' } }), null);
  assert.equal(managedPinRecord({}), null);
});
