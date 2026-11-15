# Tab Lock — optional macOS installer

The installer is **optional**. Without it, Tab Lock works per Brave profile, each with
its own PIN, and it can be removed from inside Brave.

## What it changes

It builds one macOS **configuration profile** (`TabLock.mobileconfig`) with two parts:

1. **Brave policy** (`com.brave.Browser`). This force-installs Tab Lock
   (`mpggjibcbgbnmomcdknljmffhneojlpn`) from the Chrome Web Store into **every** Brave
   profile. Force-installed extensions install "silently, without user interaction, and
   … users can't uninstall or turn off" them
   ([policy definition](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Extensions/ExtensionInstallForcelist.yaml)).
   With `--disable-tor` it also turns off Brave's private windows with Tor, which Tab
   Lock can't lock.
2. **Tab Lock's managed settings** (`com.brave.Browser.extensions.mpggjibcbgbnmomcdknljmffhneojlpn`).
   This is one **master PIN** for every Brave profile, stored as a salted PBKDF2-SHA-256
   hash (600,000 iterations). The PIN itself is not in the file. Changing the PIN inside
   Brave is disabled: "PIN is managed by your Mac — rerun the installer to change it."

Brave will show "Managed by your organization". That is expected.

## Why it needs the Chrome Web Store version

Chromium (and therefore Brave) only force-installs extensions from **outside** the Chrome
Web Store on Macs that are MDM-managed, MCX-domain-joined or enrolled in Chrome Enterprise
Core (same policy definition). A personal Mac isn't, so the installer always installs
the **store** copy. It gets whatever version the store currently serves.

**Unlisted listing:** whether force-install works while the listing is Unlisted is
**not verified yet**. The policy text only says "By default, the Chrome Web Store's
update URL is used". The live test (`LIVE-TEST.md`) settles it; this line will be updated
with the result.

## Before you install

- **Remove any "Load unpacked" copy** of Tab Lock from every profile
  (`brave://extensions` → Remove). Otherwise you'd have two Tab Locks.
- **Unlock Tab Lock in every profile**, so no tabs are waiting in a vault.
- Use a **passphrase** (the default). The profile file can be copied, and a short PIN
  can be guessed offline from it.

## Install

```sh
cd /path/to/brave-tab-lock

# 1. Dry run (default): writes installer/out/TabLock.mobileconfig and checks it. Installs nothing.
./installer/install.sh --extension-id mpggjibcbgbnmomcdknljmffhneojlpn

# 2. Install: same, then opens the file so macOS can install it.
./installer/install.sh --extension-id mpggjibcbgbnmomcdknljmffhneojlpn --install
```

The master passphrase/PIN is typed at a **hidden prompt** twice. It is never a
command-line argument, so it doesn't end up in your shell history or the process list.

Options: `--kind passphrase` (default) or `--kind pin` (6+ digits); `--disable-tor`;
`--channel beta|nightly` for those Brave builds.

After `--install`, open **System Settings → General → Device Management** (on older
macOS: **Privacy & Security → Profiles**), select **Tab Lock for Brave**, click
**Install**, and enter an administrator password. Then quit Brave completely (⌘Q) and
reopen it. `brave://policy` should list `ExtensionSettings`.

### What each profile does next (Tab Lock 0.1.1 and later)

- **A profile with no Tab Lock yet:** Brave installs it and the setup page asks for the
  master PIN once.
- **A profile that already had Tab Lock with its own PIN:** Tab Lock notices the master
  PIN, shows a red "!" on its toolbar button, and opens its setup page once. **Enter the
  master PIN there.** From then on that profile unlocks with the master PIN only.
- **If a profile locks before you've entered the master PIN there:** unlocking with the
  master PIN still reopens the tabs, as long as Brave hasn't restarted in between. After
  a restart, those tabs need the profile's **previous** PIN once ("Use previous PIN" on
  the lock page). They are never deleted automatically; "Discard saved tabs" is there if
  you no longer know the old PIN.

### Change the master PIN

Run the installer again and install the new profile. It replaces the old one because
they share an identifier. Tabs that were locked before the change need the **previous**
master PIN once: the lock page offers "Use previous PIN" or "Discard saved tabs".

## Undo

**Removing the profile also uninstalls Tab Lock from every profile and deletes its data**
(PIN, settings and any saved tabs). The policy says: "If a previously force-installed app
or extension is removed from this list, Google Chrome automatically uninstalls it."
So:

1. **Unlock Tab Lock in every profile first**, so no tabs are still saved in a vault.
2. Remove the profile:
   ```sh
   ./installer/uninstall.sh          # shows what it would do
   ./installer/uninstall.sh --run    # removes the profile (asks for an administrator password)
   ```
   Or by hand: System Settings → General → Device Management → **Tab Lock for Brave** →
   **Remove**.
3. Quit and reopen Brave. To keep using Tab Lock without the installer, reinstall it from
   the store link and set a PIN again.

## Not yet verified

All of these are covered by `LIVE-TEST.md`:

- Force-install while the listing is **Unlisted**.
- Brave applying the managed master PIN from a **hand-installed** (non-MDM) profile.
  Chromium documents `.mobileconfig` delivery; check `brave://policy`. Tab Lock's settings
  page says "PIN is managed by your Mac" when it works.
- How Brave behaves when the profile is removed (the policy text above says the extension
  is uninstalled).
- `profiles remove` behaviour on your macOS version (`uninstall.sh --run`). The System
  Settings route always works.

## Security notes

- The `.mobileconfig` file contains the salted hash. Anyone who reads it can try to guess
  a short PIN offline. Use a passphrase, and delete `installer/out/` after installing.
- The file is written with permissions `600` (readable only by you).
- macOS stores installed profiles in a system location readable by administrators.
