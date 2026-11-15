# Changelog

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
