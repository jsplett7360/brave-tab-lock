#!/bin/sh
# Tab Lock — remove the configuration profile written by install.sh. See INSTALLER.md.
# Default: prints what it would do. With --run it asks macOS to remove the profile
# (needs an administrator password).
set -eu
ID="org.tablock.brave-policy"
echo "WARNING: removing this profile makes Brave uninstall Tab Lock from every profile and delete its data."
echo "Unlock Tab Lock in every profile first so no tabs are left in a vault."
echo
if [ "${1:-}" = "--run" ]; then
  /usr/bin/sudo /usr/bin/profiles remove -identifier "$ID"
  echo "Removed. Quit and reopen Brave: Brave then uninstalls the force-installed Tab Lock in every profile"
  echo "(its PIN, settings and any saved tabs are deleted). Reinstall it from the Chrome Web Store if you want it."
else
  echo "Would run: sudo /usr/bin/profiles remove -identifier $ID"
  echo "Or remove it by hand: System Settings → General → Device Management (or Privacy & Security → Profiles)"
  echo "→ \"Tab Lock for Brave\" → Remove. Rerun with --run to do it from here."
fi
