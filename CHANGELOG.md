# Changelog

## 0.1.5 — 2026-11-19 (not yet uploaded; replaces 0.1.4)
- **Locked windows no longer pop to the front.** While locked, Tab Lock's 30-second safety
  check (and repeated idle or screen-lock events) focused the lock page's window, which
  un-minimized it and brought the browser to the front about every 30 seconds. It now never
  focuses, raises, un-minimizes or activates a window or tab on its own.
- Lockdown mode opens its lock window unfocused and at normal size when it locks by itself
  (inactivity, screen lock, browser not focused), behind whatever you're using. Locking by
  hand (toolbar, shortcut or lock page) still brings the lock window forward, because your
  windows have just closed.
- Security unchanged: locked tabs still show only the lock screen; the safety check still
  runs. No new permissions; no network code. Tests: 108 (6 new, recording every focus or
  activate call).

## 0.1.4 — 2026-11-19 (not yet uploaded; replaces 0.1.3)
After the 0.1.1 store rejection ("Restoring tabs from the vault" not reproducible), every
store claim was re-run from the package in fresh Chrome and Brave profiles.
- **One unlock brings everything back after a restart.** If the browser didn't restore
  the hidden tabs (Chrome's default for a new profile is "Open the New Tab page"), the
  same correct PIN now reopens them right away, in their own windows, pinned state and
  groups (name and color). Before, it took a second PIN entry and reopened them as loose
  tabs in one window. To do this, each hidden tab's window, position, pin and group are
  saved with it (encrypted, like its address). Records from 0.1.2/0.1.3 reopen as before,
  together in one window. "Reopen N tabs" / "Discard" remains only for tabs whose window
  couldn't be reopened.
- **Text fits the browser in use.** Setup, settings and lock pages no longer say "Brave",
  `brave://` or "your Mac … FileVault" in Chrome: they show `chrome://` or `brave://` as
  appropriate, "Allow in Incognito" or "Allow in Private", and Brave-only notes
  (Containers, Tor windows, the macOS installer) only in Brave.
- The word "vault" is gone from the lock page and the README ("saved tabs").
- No new permissions; no network code. Tests: 102.

## 0.1.3 — 2026-11-15 (not yet uploaded; replaces 0.1.2)
- **Safe updates while locked.** Hidden tabs are kept from being auto-discarded, so a
  Tab Lock page stays open and Brave holds updates back while anything is hidden. A
  waiting update is remembered (`runtime.onUpdateAvailable`) and installed right after
  unlock, only when nothing is hidden or saved. Installing it doesn't lock again.
- Tabs hidden by 0.1.2 get the same protection when 0.1.3 starts.
- Settings shows "A Tab Lock update is ready" while one is waiting.
- README: the Back-twice leak after removing Tab Lock while locked is documented.
- No new permissions; storage format unchanged.

## 0.1.2 — 2026-11-15 (not yet uploaded; replaces 0.1.1, which was never uploaded)
- **New default: hide tabs in place.** Locking no longer closes tabs: each tab shows the
  lock screen (`lock.html#<random token>`) and goes back to its page on unlock, in the
  same tab. Tabs keep their Brave Container, so you stay signed in (0.1.1 reopened them
  as new tabs outside their container, which signed you out). Pages that ask "Leave
  site?" are put to sleep first so they can be hidden.
- **Lockdown mode** (Settings → Advanced, off by default): the 0.1.1 close + encrypt +
  reopen behaviour, with warnings about Containers, sign-outs and lost input.
- **Lock only these sites** (default mode): e.g. `mail.proton.me`, `*.bank.com`.
- **Recovery code** (optional, offered at setup): 128 random bits; resets a forgotten
  PIN and still opens hidden/saved tabs; single use; off under a managed master PIN.
- Tabs that disappear while locked (closed, or not restored after a restart) are offered
  back after unlocking ("Reopen N tabs" / "Discard").
- Locking now ends every PIN grace (protected pages, settings).
- Migration: a browser locked by 0.1.0/0.1.1 unlocks as before (Lockdown), then uses the
  new default.
- No new permissions.

## 0.1.1 — 2026-11-15 (not yet uploaded)
- When the macOS installer's master PIN arrives in a profile that already had its own PIN,
  Tab Lock now shows a "!" badge and opens its setup page once, so you can enter the master
  PIN right away.
- Until you've done that, each lock also encrypts the saved tabs to a memory-only key, so
  unlocking with the master PIN reopens them (until Brave restarts; after a restart, the
  previous PIN still opens them).
- Saved-tab records now support more than one key (record version 2; version-1 records
  from 0.1.0 still open).

## 0.1.0 — 2026-11-15
- First version. Submitted to the Chrome Web Store and **rejected** ("Yellow Nickel");
  never published. Appeal filed with a new store description (no code change).
