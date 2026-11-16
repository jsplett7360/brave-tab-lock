# Changelog

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
