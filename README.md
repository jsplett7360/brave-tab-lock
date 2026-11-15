# Tab Lock

A small, free, open-source (MIT) browser extension for **Brave** (and other Chromium
browsers) that locks the browser behind a PIN or passphrase:

- **Locks automatically** after N minutes of inactivity (default 5), every time the
  browser starts, or when you press **Control+Shift+L** (Mac) / Ctrl+Shift+L, or click
  the toolbar button.
- **Hides your tabs while locked ("Vault").** On lock, every open window's tabs (address,
  title, pinned state, tab groups with their names and colours) are encrypted and saved,
  the tabs are closed, and only the lock page stays. Unlocking reopens them.
- **Blocks everything else while locked.** New tabs, new windows, "reopen closed tab",
  and brave:// pages are closed the moment they appear.
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
   far stronger and is the default.
2. **Brave keeps its own records.** Tab titles and addresses may already be stored in
   Brave's history, session and cache files on disk. Tab Lock encrypts *its* copy only.
   (Verified: after locking, the tab addresses were absent from Tab Lock's storage but
   present in Brave's own `History` and `Sessions` files.)
3. **The address bar can still suggest history.** To turn that off, open
   `brave://settings/appearance` and turn off "Show autocomplete suggestions in address
   bar".
4. **Other profiles and other browsers are not covered.** Someone can switch to another
   Brave profile, create a new one, or open a different browser.
5. **Locking closes tabs**, so anything typed into a form but not submitted is lost.
   Locking also closes private windows, which ends that private session (its logins and
   cookies are gone).
6. **Without the installer, Tab Lock can be removed** from Brave's toolbar menu (right-
   click → Remove), and Brave's own "Allow in Private" switch is outside its control.
   No extension can require a PIN to uninstall itself.
7. **The protected page may flash.** Brave can show a protected page for a split second
   before Tab Lock redirects it to the PIN prompt.
8. **Brave's private windows with Tor don't run extensions**, so Tab Lock can't hide or
   block them. The installer can switch Tor windows off.
9. **Brave Containers:** no extensions API exposes a tab's container, so Tab Lock treats
   all containers the same.
10. After a browser start, tabs Brave restores can be visible for about 1–2 seconds
    before Tab Lock saves and closes them.

## Install (developer / before the store listing)

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
| Save/restore windows, tabs, pinned state, tab groups | `src/vault.js` |
| PBKDF2, AES-GCM, RSA-OAEP envelope (WebCrypto only) | `src/crypto.js` |
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
| `chrome.storage.local` (disk) | PIN check record (salt + PBKDF2 hash), key pair (private half encrypted), settings, wrong-attempt counter, lock state, **vault for normal windows** | Vault and private key: yes. Others are not secret. |
| `chrome.storage.session` (memory only, cleared when Brave quits) | **Vault for private windows**, short-lived grants for protected pages and settings | Vault: yes |
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
| `tabs` | Read tab addresses/titles to save them on lock, close and reopen them, and see when a protected page (e.g. `brave://settings`) is opened so it can be redirected to the PIN prompt. |
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
./tools/package.sh         # zip the extension files for the Chrome Web Store
python3 tools/make_icons.py  # regenerate icons/ (stdlib only)
```

### Keeping the extension ID stable

The installer's policy needs the extension's ID. Unpacked builds get an ID derived from
their folder path. The Web Store assigns its own. To make a local build use the store's
ID: upload a draft to the Developer Dashboard (no need to publish), open the
**Package** tab, click **View public key**, copy the key on one line, and add it as
`"key"` in `manifest.json` for local testing only. The store copy doesn't need it.
([Chrome docs: manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key))

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
- PBKDF2-HMAC-SHA256: "600,000 iterations" ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)).

## License

MIT. See [LICENSE](LICENSE). Security reports: see [SECURITY.md](SECURITY.md). Privacy:
see [PRIVACY.md](PRIVACY.md).
