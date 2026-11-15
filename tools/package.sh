#!/bin/sh
# Zip exactly the files the extension needs, unchanged, for the Chrome Web Store.
# (Tests, tools, installer and store assets are left out; nothing is transformed.)
# Refuses to build if manifest.json contains "key": the store assigns the ID itself, and
# developer reports say a first upload with "key" is rejected. Use tools/dev-build.sh for
# a local copy that keeps the store ID.
set -eu
cd "$(dirname "$0")/.."
has_key() { /usr/bin/python3 -I -c 'import json,sys; sys.exit(0 if "key" in json.load(sys.stdin) else 1)'; }
if has_key < manifest.json; then
  echo "manifest.json contains \"key\" — remove it before packaging (see RELEASE.md)." >&2
  exit 1
fi
VER=$(/usr/bin/python3 -I -c 'import json;print(json.load(open("manifest.json"))["version"])')
OUT="tab-lock-$VER.zip"
rm -f "$OUT"
/usr/bin/zip -q -r -X "$OUT" manifest.json managed_schema.json LICENSE icons src -x '.*' -x '*/.DS_Store'
if /usr/bin/unzip -p "$OUT" manifest.json | has_key; then
  rm -f "$OUT"; echo "Packaged manifest contains \"key\" — refusing." >&2; exit 1
fi
/usr/bin/unzip -l "$OUT"
echo "Wrote $OUT (no \"key\" in its manifest — checked)"
