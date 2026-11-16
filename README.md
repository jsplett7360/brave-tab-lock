# Tab Lock

**Chrome Web Store:** submitted, **not yet published** (the first review was rejected and
is under appeal). Store item ID `mpggjibcbgbnmomcdknljmffhneojlpn`; the listing will be at
https://chromewebstore.google.com/detail/mpggjibcbgbnmomcdknljmffhneojlpn once published.
Until then, install it from source (below).

A small, free, open-source (MIT) browser extension for **Brave** (and other Chromium
browsers) that locks the browser behind a PIN or passphrase:

- **Locks automatically** after N minutes of inactivity (default 5), every time the
  browser starts, or when you press **Control+Shift+L** (Mac) / Ctrl+Shift+L, or click
  the toolbar button.
- **Hides your tabs in place while locked** (default). Each tab shows the lock screen
  instead of its page; unlocking puts every tab back on its page, in the same tab. Tabs
  keep their **Brave Container**, so you **stay signed in**, and keep their group, pin
  and position. Tab Lock keeps an encrypted copy of each hidden tab's address.
- **Optional: lock only the sites you choose** (e.g. `mail.proton.me`, `*.bank.com`).
  Other tabs keep working while locked.
- **Optional Lockdown mode** (Settings → Advanced): the 0.1.x behaviour. Tabs are
  encrypted, closed and reopened on unlock. It does not keep Brave Containers.
- **Optional recovery code** to reset a forgotten PIN; it also opens your hidden tabs.
  Made on this device, never stored.
- **Blocks everything else while locked.** New tabs, new windows, "reopen closed tab",
  and brave:// pages are closed the moment they appear (in sites mode: only listed
  sites are hidden, and brave:// pages still ask for the PIN).
- **Gates sensitive pages even while unlocked:** History, Settings (all settings
  pages), Passwords, Extensions and Downloads ask for the PIN first (each one can be
  switched off). A correct PIN unlocks that kind of page for 2 minutes.
- **Stores nothing off your device.** No network requests of any kind, no analytics,
  no accounts.
- Optional **macOS installer** that force-installs Tab Lock through Brave policy (so it
  can't be removed from inside Brave) and sets one master PIN for every Brave profile.
  See [installer/INSTALLER.md](installer/INSTALLER.md).

## Read this first: what Tab Lock is and isn't

Tab Lock is a **convenience layer**. It stops someone who picks up your already-unlocked
Mac from casually looking through your open tabs, history, saved passwords and settings,
or removing the extension. **Your Mac's lock screen and FileVault are the real
protection.** Use a strong Mac login password, a short auto-lock time, and FileVault.

Known limits. These are real, not just legal boilerplate:

1. **A 6-digit PIN can be guessed offline.** Anyone who can read your Brave profile's
   files (or the macOS policy file, if you use the installer) can try every 6-digit PIN
   on their own computer. There are only one million of them, few enough to try them all
   with ordinary hardware, even at 600,000 PBKDF2 iterations each. A **passphrase** is
   far stronger and is the default. The recovery code is 128 random bits, so it can't
   be guessed this way.
2. **Brave keeps its own records, and hidden tabs keep their history.** In the default
   mode a hidden tab stays open, so its Back history still holds the page, and Brave's
   session files on disk keep the hidden pages' addresses **and titles** (checked: both
   were in the `Sessions` files while locked). Tab Lock encrypts *its* copy only. Brave's
   `History` has them too, in every mode. Lockdown mode closes the tabs instead, so
   they're not in the tab strip or its Back history.
3. **Pressing Back on a locked tab shows the page for a split second.** Tab Lock sends
   the tab back to the lock screen (measured: about 0.1 s in Brave 1.99), but the page
   is visible meanwhile, and Brave's Back-button menu may list page titles. Use Lockdown
   mode if that matters.
4. **Someone who restarts Brave with extensions turned off** (e.g. launching it from
   Terminal with `--disable-extensions`) **sees the hidden tabs' history**: pressing
   Back in a hidden tab shows the page, still signed in. In Lockdown mode the tabs are
   gone, but the logins are still in Brave either way, so that person could also just
   type the address. Tab Lock does not sign you out of anything.
5. **The address bar can still suggest history.** To turn that off, open
   `brave://settings/appearance` and turn off "Show autocomplete suggestions in address
   bar".
6. **Other profiles and other browsers are not covered.** Someone can switch to another
   Brave profile, create a new one, or open a different browser.
7. **Unsaved input can be lost.** Unlocking goes Back in each tab, which keeps the page
   as it was (scroll, typed text) when Brave kept it in its back/forward cache; otherwise
   the page reloads and unsaved input is lost. Pages that ask "Leave site?" are put to
   sleep before they're hidden, so they always reload. Lockdown mode closes every tab.
   Locking closes private windows in every mode (Tab Lock's lock screen can't open in
   them), which ends that private session (its logins and cookies are gone).
8. **Removing or reloading Tab Lock closes the tabs it is hiding.** Brave closes every
   tab that shows an extension's page when the extension is removed or reloaded
   (checked: removing it while locked closed 9 of 10 hidden tabs; the window's last tab
   became a New Tab page whose Back button still led to a hidden page). If tabs went
   missing while locked, unlocking offers to reopen them as new tabs, which means
   outside their container. An automatic update that installs while locked would
   probably do the same (not checked: an update can't be triggered on purpose).
9. **Without the installer, Tab Lock can be removed** from Brave's toolbar menu (right-
   click → Remove), and Brave's own "Allow in Private" switch is outside its control.
   No extension can require a PIN to uninstall itself.
10. **The protected page may flash.** Brave can show a protected page for a split second
    before Tab Lock redirects it to the PIN prompt.
11. **Brave's private windows with Tor don't run extensions**, so Tab Lock can't hide or
    block them. The installer can switch Tor windows off.
12. **Brave Containers:** the default mode keeps every tab in its container (checked with
    a signed-in test site). Lockdown mode reopens tabs outside their container, which
    signs you out of the sites in them (checked).
13. After a browser start, tabs Brave restores can be visible for about 1–2 seconds
    before Tab Lock hides them.

## Modes

| | Default: hide in place | Lockdown mode (Settings → Advanced) |
| --- | --- | --- |
| On lock | each tab is navigated to `lock.html#<random token>` in the same tab | tabs are encrypted, saved and closed; one lock page stays |
| On unlock | each tab goes Back to its page (or, if Back isn't possible, opens the saved address) | windows, tabs, pins and groups are recreated |
| Brave Containers, logins | kept | lost (new tabs are outside the container) |
| Page addresses in the tab's Back history / Brave's session files | yes | no |
| "Only these sites" | available | always all tabs |

The lock page's address contains only a random 128-bit token; the address and title of
the page it replaced are kept encrypted by Tab Lock (same envelope encryption as the
Vault, below).

## Recovery code

Offered when you set up Tab Lock (you can skip it) and in Settings, where making a new one
invalidates the old one. It's 26 characters (128 random bits, letters and digits without
I, L, O, U). Tab Lock keeps a PBKDF2 hash of it and a second encrypted copy of your
private key, encrypted under a key derived from the code. So **"Forgot your PIN?"** on the
lock page can set a new PIN **and** still open your hidden or saved tabs. A code works
once; afterwards Tab Lock offers a new one. Wrong codes count as wrong PIN attempts (same
waiting times). With a master PIN from the macOS installer, recovery codes are off: run
the installer again instead.

**Anyone with the code can reset your PIN.** Store it somewhere safe, like a password
manager.

## If you lose both your PIN and your recovery code

Tab Lock can't be unlocked. To use that browser profile again you have to:

- **remove Tab Lock**: right-click its toolbar button → Remove from Brave. That menu is
  Brave's, so Tab Lock can't block it while locked. (Removal while locked was tested by
  removing Tab Lock programmatically; the menu click itself wasn't automated.)
  `brave://extensions` is not a way in while locked: Tab Lock closes it;
- or, if the macOS installer added it, **remove its configuration profile** (System
  Settings → General → Device Management; needs an administrator), which makes Brave
  uninstall Tab Lock;
- or **delete that browser profile**.

**You lose the tabs Tab Lock is hiding.** Removing Tab Lock closes them, and its
encrypted copy of their addresses is deleted with it (Chrome's docs: `storage.local` is
"cleared when the extension is removed"). Brave's own History, and possibly its "recently
closed" list, may still have them. Uninstalling the Brave app is not enough: on macOS
that doesn't delete your profile data.

## Install from source (developers)

Once Tab Lock is published, prefer the Chrome Web Store. To run the code from this repository:

1. Download or clone this repository (`git clone https://github.com/jsplett7360/brave-tab-lock`).
2. Open `brave://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. The setup page opens. Choose a passphrase (recommended) or a 6+ digit PIN.
5. Recommended: in `brave://extensions` → Tab Lock → **Details**, turn on
   **Allow in Private** so private windows are covered too.

Change the shortcut at `brave://extensions/shortcuts`.

## How it works

| Piece | File |
| --- | --- |
| Service worker (events → controller) | `src/sw.js` |
| Lock/unlock state machine, triggers, protected pages | `src/controller.js` |
| Hide in place: tokens, lock URLs | `src/hide.js` |
| Lockdown mode: save/restore windows, tabs, pinned state, tab groups | `src/vault.js` |
| PBKDF2, AES-GCM, RSA-OAEP envelope, recovery code (WebCrypto only) | `src/crypto.js` |
| Settings, "only these sites" patterns | `src/settings.js` |
| Wrong-PIN backoff | `src/backoff.js` |
| Which pages are protected | `src/guard.js` |
| Master PIN from macOS policy | `src/policy.js`, `managed_schema.json` |
| Lock / PIN prompt, settings, setup pages | `src/pages/` |

**States:** unlocked → locking → locked → unlocking → unlocked. The state lives in
`chrome.storage`, never in memory, because Manifest V3 service workers are stopped after
about 30 seconds of inactivity. If the worker dies mid-lock or mid-unlock, the next wake-up
locks again. Saving is append-only, so nothing saved is lost; at worst a tab is saved
twice.

**Crypto.**
- **PIN check:** PBKDF2-SHA-256, a random 16-byte salt, 600,000 iterations (the OWASP
  recommendation), and a constant-time compare.
- **Vault:** each profile has an RSA-OAEP-3072 key pair. The private key is encrypted
  with AES-GCM-256 under a second PBKDF2 key (separate salt) derived from your PIN.
  Locking happens while you're away, so Tab Lock doesn't know the PIN then. Each lock
  instead encrypts the tab list with a fresh AES-GCM-256 key and a fresh 12-byte IV,
  and seals that key with the public key. Only your PIN can open it again.
- Neither the PIN nor any derived key is ever stored.

**What is stored where**

| Where | What | Encrypted? |
| --- | --- | --- |
| `chrome.storage.local` (disk) | PIN check record (salt + PBKDF2 hash), key pair (private half encrypted), recovery-code record (salt + hash + private key encrypted under the code), settings, wrong-attempt counter, lock state, **hidden tabs' addresses and titles** (default mode), **vault for normal windows** (Lockdown mode) | Hidden-tab list, vault and private key: yes. Others are not secret (the hidden-tab tokens are random). |
| `chrome.storage.session` (memory only, cleared when Brave quits) | **Vault for private windows**, tab ↔ token map, short-lived grants for protected pages and settings | Vault: yes |
| `chrome.storage.managed` (read-only, from macOS policy) | Master PIN check record | n/a (salted hash) |

Private-window tabs are **never written to disk**. This was checked in Brave by searching
the whole profile folder for a private tab's address after locking: no matches.

**Wrong PIN:** the first 5 wrong attempts are free. After that, each attempt waits
longer: 30 s, 1 min, 2 min … up to 1 hour. The counter is stored on disk, so restarting
Brave doesn't reset it. Optionally (off by default), the saved tabs can be erased after N
wrong attempts in a row.

**Inactivity** means either the Mac being idle (`chrome.idle`, which counts keyboard/mouse
input on the whole system and fires immediately when the screen locks) or Brave not
being the focused app (`chrome.windows.onFocusChanged`, checked by a 30-second alarm),
whichever comes first. The shortest timeout is 1 minute.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Keep the PIN check record, settings and the encrypted vault on this device. |
| `tabs` | Read tab addresses/titles to save them on lock; show the lock screen in each tab and send it Back to its page on unlock (Lockdown mode: close and reopen them); see when a protected page (e.g. `brave://settings`) is opened so it can be redirected to the PIN prompt. |
| `tabGroups` | Save and restore tab group names, colours and collapsed state. |
| `idle` | Lock after the computer has been idle for your chosen time, or immediately when the screen locks. |
| `alarms` | A 30-second check for "Brave not focused for N minutes" and a safety net that re-closes anything opened while locked. |
| `commands` (manifest key) | The keyboard shortcut. |

No host permissions, no content scripts, no remote code. The extension pages ship a strict
Content-Security-Policy (`default-src 'none'; script-src 'self'; …`), so they cannot load
anything from the network even by mistake.

## Development

There is no build step: what's in this repository is exactly what ships. Zero runtime
dependencies.

```sh
node --test test/          # unit tests (Node 20+; uses only node:test)
./tools/package.sh         # zip the extension files for the Chrome Web Store (refuses a manifest with "key")
./tools/dev-build.sh       # dev-build/: a copy with the store's ID, for testing the installer locally
./tools/pack-crx.sh        # signed .crx for Verified CRX Uploads (see store/VERIFIED-UPLOADS.md)
python3 tools/make_icons.py  # regenerate icons/ (stdlib only)
python3 tools/make_promo.py  # regenerate the store's 440×280 promo tile (stdlib only)
```

Releasing a new version: follow [RELEASE.md](RELEASE.md).

### Keeping the extension ID stable

The installer's policy needs the extension's ID. Unpacked builds get an ID derived from
their folder path; the store's ID is `mpggjibcbgbnmomcdknljmffhneojlpn`. The store's
public key (not a secret: it ships inside every installed copy) is in
`tools/store-public-key.pem`, copied from the dashboard's **Package → View public key**.
`./tools/dev-build.sh` writes `dev-build/`, a copy whose manifest has that key as
`"key"`, so **Load unpacked** on `dev-build/` gets the store ID
([Chrome docs: manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)).

- The repository's own `manifest.json` never contains `"key"`, and `tools/package.sh`
  refuses to package one that does. Chrome's docs don't say how the store treats an
  upload with `"key"`; developers report that a first upload with it is rejected.
- Don't load `dev-build/` in a profile that already has Tab Lock from the store or the
  installer: two copies with the same ID conflict.

## Platform facts this relies on (checked 2026-11-15, Brave 1.99.57 on macOS)

- Brave reports `brave://` pages to extensions as `chrome://` URLs, and an extension with
  the `tabs` permission can redirect or close them (History, Settings and subpages,
  Password Manager, Extensions, Downloads were all tested).
- `chrome.idle.setDetectionInterval` rejects values under 15 seconds.
- Brave asks for confirmation before closing a window with several tabs
  (`brave.enable_window_closing_confirm`), and `chrome.windows.remove` then leaves the
  window open. Tab Lock closes tabs instead of windows for this reason.
- MV3 service workers stop "after 30 seconds of inactivity" and "global variables … will
  be lost" ([lifecycle docs](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- Chromium force-installs extensions from outside the Chrome Web Store on macOS only "if
  the instance is managed via MDM, joined to a domain via MCX or enrolled in Chrome
  Enterprise Core" ([policy definition](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Extensions/ExtensionInstallForcelist.yaml)).
- Brave Containers are per-tab storage partitions (domain `containers`, name = container
  id; [brave-core source](https://github.com/brave/brave-core/tree/master/components/containers)).
  A container tab that navigates to Tab Lock's page and back stays in its container and
  signed in (checked with a test site, including across a browser restart).
- `tabs.goBack` fails ("Cannot find a next page in history") when the page before was
  never interacted with; Tab Lock then opens the saved address in the same tab.
- A page with a "Leave site?" (`beforeunload`) handler holds `tabs.update` (the tab shows
  the page, its `pendingUrl` is the lock page). `tabs.discard` unloads it without the
  prompt and gives the tab a new id.
- Removing or reloading an extension closes the tabs showing its pages.
- PBKDF2-HMAC-SHA256: "600,000 iterations" ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)).

## License

MIT. See [LICENSE](LICENSE). Security reports: see [SECURITY.md](SECURITY.md). Privacy:
see [PRIVACY.md](PRIVACY.md).
