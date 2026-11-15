# Chrome Web Store listing — Tab Lock

Store item: https://chromewebstore.google.com/detail/mpggjibcbgbnmomcdknljmffhneojlpn
(ID `mpggjibcbgbnmomcdknljmffhneojlpn`). 0.1.0 approved as **Unlisted**; switching to
Public: see `store/GO-PUBLIC.md`.

## Name
Tab Lock

## Short description (manifest "description", ≤132 characters)
Locks your browser behind a PIN and hides your open tabs. Everything stays on your device.

## Category / language
Category: Privacy & Security (pick the closest available in the dashboard). Language: English.

## Detailed description

Tab Lock locks your browser behind a PIN or passphrase and hides your open tabs until you
unlock it. It is free, open source (MIT), and stores nothing off your device.

WHAT IT DOES
• Locks after a chosen number of minutes of inactivity (default 5), whenever the browser
  starts, or when you press Control+Shift+L (Mac) / Ctrl+Shift+L or click its button.
• While locked, your open tabs are encrypted, closed and replaced by a lock page. A
  correct PIN reopens them, with pinned tabs and tab groups.
• While locked, new tabs and windows are closed as soon as they open.
• History, Settings, Passwords, Extensions and Downloads ask for your PIN even while
  unlocked (each can be switched off).
• Wrong PINs: after 5 attempts, each new try has to wait longer. Optionally, saved tabs
  can be erased after many wrong attempts.
• Works in private windows if you allow it ("Allow in Private"). Private tabs are only
  ever kept in memory.

PRIVACY
Tab Lock makes no network requests at all: no analytics, no accounts, no servers. Your
PIN is never stored. Only a salted PBKDF2 hash is kept, and your tabs are encrypted with
AES-GCM on your device. The full source code is public.

PLEASE READ — WHAT IT CAN'T DO
Tab Lock is a convenience layer. Your computer's lock screen and disk encryption
(FileVault on Mac) are the real protection.
• A 6-digit PIN can be guessed offline by someone who can copy your browser profile's
  files. Use a passphrase.
• The browser itself may already keep tab titles and addresses in its history and session
  files.
• The address bar may still suggest history (turn off "Show autocomplete suggestions in
  address bar" in Brave's Appearance settings).
• Someone can use another browser profile or another browser.
• Locking closes your tabs, so text typed into forms but not submitted is lost.
• Without the optional macOS installer, the extension can be removed from the browser's
  menu.

Optional for Mac: an installer in the source repository can force-install Tab Lock via
browser policy and set one master PIN for every Brave profile.

## Single purpose (Privacy practices tab)
Lock the browser behind a PIN: hide the user's open tabs while locked and require the PIN
to reopen them or to open sensitive browser pages.

## Permission justifications (Privacy practices tab)
- storage: Saves the PIN verification record (salt + hash), settings, the wrong-attempt
  counter and the encrypted list of tabs, on the user's device only.
- tabs: Reads tab addresses and titles to encrypt and save them when locking, closes and
  reopens them, and detects when a protected browser page (history, settings, passwords,
  extensions, downloads) is opened so it can ask for the PIN.
- tabGroups: Saves and restores tab group names, colors and collapsed state across a lock.
- idle: Locks after the user's chosen period of inactivity, and immediately when the
  computer's screen locks.
- alarms: Runs a 30-second check for "browser not focused for N minutes" and re-closes
  anything opened while locked.
- (commands manifest key — no permission prompt): the "Lock now" keyboard shortcut.
- Host permissions: none.

## Remote code
"No, I am not using remote code." All code is in the package; extension pages use the
CSP `default-src 'none'; script-src 'self'`.

## Data usage (Privacy practices tab)
Collected data types: **none** (leave every box unchecked: personally identifiable info,
health, financial, authentication, personal communications, location, web history, user
activity, website content).
Note for the reviewer: tab addresses/titles are read only to encrypt them locally while
locked; they never leave the device, so they're not "collected".
Certifications: tick all three (no selling/transfer outside approved use cases, no use
unrelated to the single purpose, no creditworthiness/lending use).

## Privacy policy URL
https://github.com/jsplett7360/brave-tab-lock/blob/main/PRIVACY.md

## Assets
- Icon: `icons/icon128.png` (96 px artwork + transparent padding, as the image
  guidelines ask).
- Screenshots (1280×800): `store/screenshots/1-locked.png`, `2-protected-page.png`,
  `3-settings.png`, `4-onboarding.png`, `5-locked-dark.png`. These are real captures
  from Brave 1.99.57.
- Small promo tile 440×280: `store/promo-small-440x280.png`. It's an opaque 24-bit PNG
  (no alpha) showing the lock and the name only, following the guideline "Avoid text".
  Regenerate with `python3 tools/make_promo.py`. Listings without a small tile "will be
  shown after" those that have one.
- Marquee 1400×560: optional, not made (only needed to be featured).
