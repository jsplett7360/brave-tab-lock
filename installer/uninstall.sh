#!/bin/sh
# Tab Lock — remove the configuration profile written by install.sh. See INSTALLER.md.
# Default: prints what it would do. With --run it asks macOS to remove the profile
# (needs an administrator password).
set -eu
ID="org.tablock.brave-policy"
if [ "${1:-}" = "--run" ]; then
  /usr/bin/sudo /usr/bin/profiles remove -identifier "$ID"
  echo "Removed. Restart Brave; Tab Lock can then be removed from brave://extensions like any other extension."
else
  echo "Would run: sudo /usr/bin/profiles remove -identifier $ID"
  echo "Or remove it by hand: System Settings → General → Device Management (or Privacy & Security → Profiles)"
  echo "→ \"Tab Lock for Brave\" → Remove. Rerun with --run to do it from here."
fi
