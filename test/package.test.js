import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const STORE_ID = 'mpggjibcbgbnmomcdknljmffhneojlpn';
const darwin = { skip: process.platform !== 'darwin' };

function copyRepo() {
  const d = mkdtempSync(join(tmpdir(), 'tablock-pkg-'));
  for (const p of ['manifest.json', 'managed_schema.json', 'LICENSE', 'icons', 'src', 'tools']) cpSync(join(root, p), join(d, p), { recursive: true });
  return d;
}

test('repo manifest.json has no "key"', () => {
  assert.equal('key' in JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')), false);
});

test('store public key derives to the store extension ID', () => {
  const pem = readFileSync(join(root, 'tools/store-public-key.pem'), 'utf8');
  const der = Buffer.from(pem.split('\n').filter((l) => l && !l.includes('-----')).join(''), 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  assert.equal([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''), STORE_ID);
});

test('package.sh builds a key-free zip, and refuses a manifest with "key"', darwin, () => {
  const d = copyRepo();
  try {
    execFileSync('sh', [join(d, 'tools/package.sh')], { stdio: 'pipe' });
    const ver = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')).version;
    const zipped = JSON.parse(execFileSync('/usr/bin/unzip', ['-p', join(d, `tab-lock-${ver}.zip`), 'manifest.json']).toString());
    assert.equal('key' in zipped, false);
    const m = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ ...m, key: 'abc' }));
    rmSync(join(d, `tab-lock-${ver}.zip`));
    const r = spawnSync('sh', [join(d, 'tools/package.sh')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /contains "key"/);
    assert.equal(existsSync(join(d, `tab-lock-${ver}.zip`)), false, 'no zip produced');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('dev-build.sh adds the store key to a copy only', darwin, () => {
  const d = copyRepo();
  try {
    execFileSync('sh', [join(d, 'tools/dev-build.sh')], { stdio: 'pipe' });
    const dev = JSON.parse(readFileSync(join(d, 'dev-build/manifest.json'), 'utf8'));
    assert.ok(dev.key && dev.key.startsWith('MIIBIjAN'));
    assert.equal('key' in JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')), false, 'source manifest untouched');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
