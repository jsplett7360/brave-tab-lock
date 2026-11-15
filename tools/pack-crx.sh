#!/bin/sh
# Tab Lock — pack the shipping files into a CRX signed with YOUR key, for Chrome Web
# Store "Verified CRX Uploads". See store/VERIFIED-UPLOADS.md.
#
#   ./tools/pack-crx.sh [--key <encrypted key>] [--browser <Brave/Chrome binary>] [--out-dir <dir>]
#
# - Ships exactly tools/package.sh's file list (manifest.json, managed_schema.json,
#   LICENSE, icons, src), unchanged. Refuses a manifest containing "key".
# - The key is decrypted (hidden passphrase prompt) only into a private temp folder
#   that is deleted when the script exits, also on errors or Ctrl-C.
# - Packs with the installed Brave (or Chrome/Chromium) using a throwaway profile, so a
#   running browser isn't touched.
# - Verifies the result (CRX3 header, exact file list, no "key", no .pem) and, if
#   tools/signing-public-key.pem exists, that the CRX was signed with that same key.
# - Writes tab-lock-<version>.crx to the repo root (gitignored).
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd -P)
KEY="$HOME/.config/tab-lock-signing/signing-key.pem"
BROWSER=""
OUT_DIR="$REPO"

while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="${2:?--key needs a file}"; shift 2 ;;
    --browser) BROWSER="${2:?--browser needs a path}"; shift 2 ;;
    --out-dir) OUT_DIR="${2:?--out-dir needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO"
if /usr/bin/python3 -I -c 'import json,sys; sys.exit(0 if "key" in json.load(open("manifest.json")) else 1)'; then
  echo "manifest.json contains \"key\" — remove it before packing." >&2
  exit 1
fi
[ -f "$KEY" ] || { echo "No signing key at $KEY (run tools/make-signing-key.sh, or pass --key)." >&2; exit 1; }

if [ -z "$BROWSER" ]; then
  for b in "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [ -x "$b" ] && { BROWSER="$b"; break; }
  done
fi
[ -n "$BROWSER" ] || { echo "No Brave/Chrome/Chromium found; pass --browser." >&2; exit 1; }

VER=$(/usr/bin/python3 -I -c 'import json;print(json.load(open("manifest.json"))["version"])')

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/tablock-pack.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

STAGE="$WORK/tab-lock"
mkdir "$STAGE"
cp -R manifest.json managed_schema.json LICENSE icons src "$STAGE/"
find "$STAGE" -name '.*' -exec rm -rf {} + 2>/dev/null || true

echo "Enter your signing-key passphrase (hidden):"
/usr/bin/openssl pkey -in "$KEY" -out "$WORK/key.pem"

if ! "$BROWSER" --user-data-dir="$WORK/profile" --no-first-run --no-default-browser-check \
     --pack-extension="$STAGE" --pack-extension-key="$WORK/key.pem" >"$WORK/pack.log" 2>&1 \
   || [ ! -f "$WORK/tab-lock.crx" ]; then
  echo "Packing failed. Browser output:" >&2
  grep -v -i crashpad "$WORK/pack.log" | tail -5 >&2 || true
  exit 1
fi

/usr/bin/openssl pkey -in "$WORK/key.pem" -pubout -outform DER -out "$WORK/pub.der"
EXPECT_PUB=""
[ -f "$REPO/tools/signing-public-key.pem" ] && EXPECT_PUB="$REPO/tools/signing-public-key.pem"

/usr/bin/python3 -I - "$WORK/tab-lock.crx" "$STAGE" "$WORK/pub.der" "$EXPECT_PUB" <<'PY'
import hashlib, io, json, os, struct, subprocess, sys, zipfile
crx, stage, pub_der, expect_pub = sys.argv[1:5]
d = open(crx, 'rb').read()
def fail(msg):
    print('CRX check failed: ' + msg, file=sys.stderr); sys.exit(1)
if d[:4] != b'Cr24': fail('missing Cr24 magic')
if struct.unpack('<I', d[4:8])[0] != 3: fail('not CRX version 3')
hl = struct.unpack('<I', d[8:12])[0]
z = zipfile.ZipFile(io.BytesIO(d[12 + hl:]))
names = sorted(n for n in z.namelist() if not n.endswith('/'))
want = sorted(os.path.relpath(os.path.join(r, f), stage) for r, _, fs in os.walk(stage) for f in fs)
if names != want: fail('file list differs from the staged files: %s' % sorted(set(names) ^ set(want)))
if any(n.lower().endswith('.pem') for n in names): fail('a .pem file is inside the package')
if 'key' in json.loads(z.read('manifest.json')): fail('packaged manifest contains "key"')
# declared CRX id = id of the signing key
hdr = d[12:12 + hl]
i = hdr.find(b'\x82\xf1\x04'); p = i + 3; n = s = 0
while True:
    x = hdr[p]; p += 1; n |= (x & 0x7f) << s; s += 7
    if x < 0x80: break
sd = hdr[p:p + n]
crx_id = ''.join(chr(97 + int(c, 16)) for c in sd[2:18].hex())
key_id = ''.join(chr(97 + int(c, 16)) for c in hashlib.sha256(open(pub_der, 'rb').read()).hexdigest()[:32])
if crx_id != key_id: fail('CRX id does not match the signing key')
if expect_pub:
    der = subprocess.run(['/usr/bin/openssl', 'pkey', '-pubin', '-in', expect_pub, '-outform', 'DER'], capture_output=True, check=True).stdout
    if der != open(pub_der, 'rb').read():
        fail('this key is NOT the one in tools/signing-public-key.pem (the key you opted in with) — wrong key file?')
print('Verified: CRX3, %d files (same as package.sh), no "key", no .pem, signed by key %s' % (len(names), key_id))
PY

mkdir -p "$OUT_DIR"
mv "$WORK/tab-lock.crx" "$OUT_DIR/tab-lock-$VER.crx"
echo "Wrote $OUT_DIR/tab-lock-$VER.crx"
