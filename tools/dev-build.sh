#!/bin/sh
# Make dev-build/ (gitignored): a copy of the extension whose manifest has the Chrome Web
# Store public key as "key", so "Load unpacked" gets the store's ID
# (mpggjibcbgbnmomcdknljmffhneojlpn) — handy for testing the macOS installer's
# managed settings with a local build.
#
# NEVER load this in a Brave profile that already has Tab Lock from the store or the
# installer: two copies with the same ID conflict. The repo's manifest.json never gets
# the key; tools/package.sh refuses to package one that has it.
set -eu
cd "$(dirname "$0")/.."
rm -rf dev-build && mkdir dev-build
cp -R manifest.json managed_schema.json LICENSE icons src dev-build/
/usr/bin/python3 -I - <<'PY'
import json
key = "".join(l.strip() for l in open("tools/store-public-key.pem") if "-----" not in l)
m = json.load(open("dev-build/manifest.json"))
m["key"] = key
json.dump(m, open("dev-build/manifest.json", "w"), indent=2)
PY
echo "Wrote dev-build/ — load it unpacked from brave://extensions (Developer mode)."
