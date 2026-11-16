# Tab Lock — Privacy Policy

_Last updated: 2026-11-15_

**Tab Lock collects no data.** It has no servers, no accounts, no analytics, no
telemetry and no crash reporting, and it makes no network requests of any kind. Its pages
enforce a Content-Security-Policy that blocks network access.

## What stays on your device

Everything Tab Lock stores is kept by your browser, inside your browser profile, on your
computer:

- A **check record for your PIN or passphrase**: a random salt and a PBKDF2-SHA-256 hash.
  Your PIN itself is never stored.
- An **encryption key pair**. Its private half is encrypted with a key derived from your
  PIN.
- If you create a **recovery code**: a check record for it (a random salt and a
  PBKDF2-SHA-256 hash) and a second encrypted copy of the private key, encrypted with a
  key derived from the code. The code itself is never stored.
- While the browser is locked, an **encrypted list of the tabs it hides** (addresses and
  titles; in Lockdown mode also pinned state and tab groups). It is deleted once the
  tabs are back. For private windows this list is kept in memory only and never written
  to disk.
- Your **settings**, the **lock state**, and a **count of wrong PIN attempts**.

If your Mac's administrator installed Tab Lock's macOS configuration profile, a check
record for the master PIN is also delivered to the browser through that profile.

## What is shared

Nothing. Tab Lock does not sell, transfer or disclose any data, and does not use any data
for advertising, creditworthiness or any purpose other than locking your browser.

## What the browser itself keeps

While a tab is hidden it stays open, so the browser's own records of it (its Back
history, session files and History) are unchanged. Tab Lock cannot read or erase those.

## Removing your data

Remove the extension (or remove the browser profile). This deletes everything Tab Lock
stored. Removing it while it is locked also closes the tabs it is hiding. If the macOS profile was installed, remove it in System Settings first.

## Contact

Open an issue at https://github.com/jsplett7360/brave-tab-lock/issues.
