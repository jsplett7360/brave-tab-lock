# Tab Lock — optional macOS installer

The installer is **optional**. Without it, Tab Lock works per Brave profile, each with
its own PIN, and it can be removed from inside Brave.

## What it changes

It builds one macOS **configuration profile** (`TabLock.mobileconfig`) with two parts:

1. **Brave policy** (`com.brave.Browser`). This force-installs Tab Lock from the Chrome
   Web Store, so it can't be removed or turned off from `brave://extensions` or the
   toolbar menu. With `--disable-tor` it also turns off Brave's private windows with Tor,
   which Tab Lock can't lock.
2. **Tab Lock's managed settings** (`com.brave.Browser.extensions.<extension ID>`). This
   is one **master PIN** for every Brave profile, stored as a salted PBKDF2-SHA-256 hash
   (600,000 iterations). The PIN itself is not in the file. Each profile asks for the
   master PIN once, then unlocks on its own. Changing the PIN inside Brave is disabled:
   "PIN is managed by your Mac — rerun the installer to change it."

Brave will show "Managed by your organization". That is expected.

## Why it needs the Chrome Web Store version

Chromium (and therefore Brave) only force-installs extensions from **outside** the Chrome
Web Store on Macs that are MDM-managed, MCX-domain-joined or enrolled in Chrome Enterprise
Core ([policy definition](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Extensions/ExtensionInstallForcelist.yaml)).
A personal Mac isn't, so the installer needs Tab Lock's **Web Store extension ID**, and
it can only be used once Tab Lock is published (an unlisted listing is enough).

## Use it

```sh
# 1. Dry run (default): writes installer/out/TabLock.mobileconfig and checks it. Installs nothing.
./installer/install.sh --extension-id <WEB-STORE-ID>

# 2. Install: same, then opens the file so macOS can install it.
./installer/install.sh --extension-id <WEB-STORE-ID> --install
```

Options: `--kind passphrase` (default) or `--kind pin`; `--disable-tor`;
`--channel beta|nightly` for those Brave builds.

After `--install`, open **System Settings → General → Device Management** (on older
macOS: **Privacy & Security → Profiles**), select **Tab Lock for Brave**, click
**Install**, and enter an administrator password. Then quit and reopen Brave.
`brave://policy` should list `ExtensionSettings`.

**Change the master PIN:** run the installer again and install the new profile. The new
profile replaces the old one because they share an identifier. Tabs that were locked
before the change need the **previous** PIN once. The lock page offers "Use previous PIN"
or "Discard saved tabs".

## Undo

```sh
./installer/uninstall.sh          # shows what it would do
./installer/uninstall.sh --run    # removes the profile (asks for an administrator password)
```

Or by hand: System Settings → General → Device Management → **Tab Lock for Brave** →
**Remove**. Restart Brave. Tab Lock then becomes a normal extension you can remove.

## Not yet verified

- Whether Brave applies the managed master-PIN settings from a **hand-installed** (non-MDM)
  profile. Chromium documents `.mobileconfig` delivery, but this was not tested on a real
  install, because that requires installing the profile on your Mac. Check
  `brave://policy` after installing; Tab Lock's options page shows "PIN is managed by
  your Mac" when it works.
- `profiles remove` behaviour on your macOS version (`uninstall.sh --run`). The
  System Settings route always works.

## Security notes

- The `.mobileconfig` file contains the salted hash. Anyone who reads it can try to guess
  a short PIN offline. Use a passphrase, and delete `installer/out/` after installing.
- The file is written with permissions `600` (readable only by you).
- macOS stores installed profiles in a system location readable by administrators.
