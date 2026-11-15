#!/bin/sh
# Zip exactly the files the extension needs, unchanged, for the Chrome Web Store.
# (Tests, tools, installer and store assets are left out; nothing is transformed.)
set -eu
cd "$(dirname "$0")/.."
VER=$(/usr/bin/python3 -I -c 'import json;print(json.load(open("manifest.json"))["version"])')
OUT="tab-lock-$VER.zip"
rm -f "$OUT"
/usr/bin/zip -q -r -X "$OUT" manifest.json managed_schema.json LICENSE icons src -x '.*' -x '*/.DS_Store'
/usr/bin/unzip -l "$OUT"
echo "Wrote $OUT"
