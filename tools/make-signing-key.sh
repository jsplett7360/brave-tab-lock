#!/bin/sh
# Tab Lock — create YOUR private signing key for Chrome Web Store "Verified CRX Uploads".
# Run it yourself, in your own terminal. See store/VERIFIED-UPLOADS.md.
#
#   ./tools/make-signing-key.sh                 # key in ~/.config/tab-lock-signing/
#   ./tools/make-signing-key.sh --dir <folder>  # another folder (not synced, not in the repo)
#
# - RSA 2048 (the size Chrome's docs give), encrypted with AES-256. The passphrase is
#   typed only at openssl's own hidden prompt (never an argument or environment variable).
# - Refuses folders inside this repo, Desktop, Documents, iCloud Drive
#   (~/Library/Mobile Documents) or other cloud-synced storage (~/Library/CloudStorage).
# - Never overwrites an existing key.
# - Writes the PUBLIC key to tools/signing-public-key.pem (or --pub-out); that's the text
#   you paste into the dashboard when opting in. It is NOT tools/store-public-key.pem.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd -P)
DIR="$HOME/.config/tab-lock-signing"
PUB_OUT="$REPO/tools/signing-public-key.pem"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a folder}"; shift 2 ;;
    --pub-out) PUB_OUT="${2:?--pub-out needs a file}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

realpath_() { /usr/bin/python3 -I -c 'import os,sys; print(os.path.realpath(os.path.expanduser(sys.argv[1])))' "$1"; }
ABS=$(realpath_ "$DIR")

under() { # under <path> <root>: true if path == root or is inside it
  r=$(realpath_ "$2")
  case "$1/" in "$r"/*) return 0 ;; esac
  return 1
}
for bad in "$REPO" "$HOME/Desktop" "$HOME/Documents" "$HOME/Library/Mobile Documents" "$HOME/Library/CloudStorage"; do
  if under "$ABS" "$bad"; then
    echo "Refusing: $ABS is inside $bad." >&2
    echo "The private key must not live in the repo or in a synced folder (Desktop/Documents may sync to iCloud)." >&2
    exit 1
  fi
done

KEY="$ABS/signing-key.pem"
if [ -e "$KEY" ]; then
  echo "A key already exists at $KEY — not overwriting it. If you have opted in, losing it means a week-long support request." >&2
  exit 1
fi

umask 077
mkdir -p "$ABS"
chmod 700 "$ABS"

cat <<MSG
Creating an RSA-2048 signing key at:
  $KEY
openssl will ask for a passphrase twice (typing is hidden). Use a long, unique passphrase
and save it in Proton Pass right away. Without BOTH the key file and the passphrase you
can't publish updates.

MSG
/usr/bin/openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -aes-256-cbc -out "$KEY"
chmod 600 "$KEY"

echo
echo "Now type the passphrase once more to export the public key (this also checks it):"
/usr/bin/openssl pkey -in "$KEY" -pubout -out "$PUB_OUT"
chmod 644 "$PUB_OUT"

FP=$(/usr/bin/openssl pkey -pubin -in "$PUB_OUT" -outform DER | /usr/bin/shasum -a 256 | cut -c1-16)
cat <<MSG

Done.
  Private key (encrypted): $KEY   (folder 700, file 600)
  Public key:              $PUB_OUT
  Public key fingerprint:  $FP

Next (store/VERIFIED-UPLOADS.md):
  1. Back up the ENCRYPTED key file offline (Proton Pass file attachment or a USB drive).
  2. Run ./tools/pack-crx.sh once to prove the key and passphrase work.
  3. Only then opt in on the dashboard and paste the contents of $PUB_OUT.
Never share the private key or the passphrase, and never paste them into a chat.
MSG
