#!/bin/sh
# Tab Lock — macOS installer (configuration profile). See INSTALLER.md.
#
# Default is a DRY RUN: it only writes installer/out/TabLock.mobileconfig and checks it.
# With --install it also opens the file, and macOS asks you to approve it in
# System Settings (needs an administrator). Nothing is ever written under /Library by
# this script.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
OUT_DIR="$HERE/out"
OUT="$OUT_DIR/TabLock.mobileconfig"
MODE=dry-run
EXT_ID=""
KIND=passphrase
EXTRA=""

usage() {
  cat <<USAGE
Usage: $0 --extension-id <Web Store ID> [--kind passphrase|pin] [--disable-tor] [--channel stable|beta|nightly] [--install]

  --extension-id  Tab Lock's Chrome Web Store ID (32 letters a-p). Required.
  --kind          passphrase (default, much stronger) or pin (6+ digits)
  --disable-tor   also turn off Brave's private windows with Tor (Tab Lock can't lock those)
  --channel       which Brave build to configure (default: stable)
  --install       open the generated profile so macOS can install it (you approve it)
Without --install this is a dry run: it writes $OUT and validates it, nothing else.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --extension-id) EXT_ID="${2:-}"; shift 2 ;;
    --kind) KIND="${2:-}"; shift 2 ;;
    --disable-tor) EXTRA="$EXTRA --disable-tor"; shift ;;
    --channel) EXTRA="$EXTRA --channel ${2:-}"; shift 2 ;;
    --install) MODE=install; shift ;;
    --secret-stdin) EXTRA="$EXTRA --secret-stdin"; shift ;;  # tests only
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS." >&2; exit 2; }
[ -n "$EXT_ID" ] || { usage >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required (it ships with the Xcode command-line tools)." >&2; exit 2; }

mkdir -p "$OUT_DIR"
# shellcheck disable=SC2086
/usr/bin/env python3 -I "$HERE/make_profile.py" --extension-id "$EXT_ID" --kind "$KIND" --out "$OUT" $EXTRA >/dev/null
/usr/bin/plutil -lint "$OUT" >/dev/null

echo "Wrote $OUT"
echo "  - Force-installs Tab Lock ($EXT_ID) from the Chrome Web Store"
echo "  - Sets a master $KIND for every Brave profile (stored as a salted PBKDF2 hash, 600,000 iterations)"
case "$EXTRA" in *--disable-tor*) echo "  - Turns off private windows with Tor" ;; esac

if [ "$MODE" = install ]; then
  echo
  echo "Opening the profile. Then: System Settings → General → Device Management (or Privacy & Security → Profiles),"
  echo "select \"Tab Lock for Brave\", click Install, and enter an administrator password. Restart Brave afterwards."
  /usr/bin/open "$OUT"
else
  echo
  echo "Dry run only — nothing was installed. Rerun with --install to install it."
fi
