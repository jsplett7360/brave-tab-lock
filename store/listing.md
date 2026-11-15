# Chrome Web Store listing — Tab Lock

Store item ID `mpggjibcbgbnmomcdknljmffhneojlpn` (listing URL, once published:
https://chromewebstore.google.com/detail/mpggjibcbgbnmomcdknljmffhneojlpn).

## Status (2026-11-15)
- **0.1.0 was rejected and has never been published** (not even Unlisted). Notification
  "Yellow Nickel" (Spam and Placement in the Store); the policy references listed were
  the Developer Terms, Program Policies and Branding Guidelines.
- Cause: the user's assessment is that the 0.1.0 detailed description triggered it
  (decorative dividers, ALL-CAPS headings, repetitive "no X, no Y" lists, "Built for
  Brave" on the Chrome store). Google hasn't confirmed this. For reference, Google's
  Yellow Nickel entry lists other triggers first: "You or your affiliates are submitting
  multiple extensions that provide duplicate experiences or functionality", review
  manipulation, disruptive notifications, and messages sent without consent
  ([troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting/)).
- The user submitted the plain description below and **appealed**. The outcome is pending.
- 0.1.1 has **not** been uploaded. **Verified CRX Uploads is on** (opted in 2026-11-15),
  so it must be uploaded as `tab-lock-0.1.1.crx` from `./tools/pack-crx.sh`, not the zip.

## Name
Tab Lock

## Short description (manifest "description", ≤132 characters)
Locks your browser behind a PIN and hides your open tabs. Everything stays on your device.

## Category / language
Category: Privacy & Security (pick the closest available in the dashboard). Language: English.

## Detailed description (submitted 2026-11-15, replaces the rejected 0.1.0 text)

Tab Lock locks your browser behind a PIN or passphrase and hides your open tabs until you unlock it. It works in Chrome and other Chromium-based browsers.

Tab Lock is open source (MIT license) and works entirely on your device. It makes no network requests, has no accounts, and collects no data. The source code is available at github.com/jsplett7360/brave-tab-lock.

Features

- Locks automatically after a period of inactivity you choose (default 5 minutes), when your screen locks, and when the browser starts.
- Lock instantly with a keyboard shortcut (Control+Shift+L on Mac, Ctrl+Shift+L elsewhere) or the toolbar button.
- While locked, your open tabs are encrypted, closed and replaced by a lock screen. Unlocking restores your windows, tabs, pinned tabs and tab groups.
- History, Settings, Passwords, Extensions and Downloads pages can require your PIN even while unlocked. Each can be turned on or off.
- After several wrong attempts, each new attempt must wait longer.
- Works in private windows if you allow it. Private-window tabs are kept in memory only and never written to disk.

How your data is handled

Your PIN is never stored. Tab Lock keeps only a salted hash of it and encrypts your saved tabs on your device using the browser's built-in Web Crypto API. The extension does not access the content of the websites you visit.

Permissions

- Storage: settings and the encrypted tab list, on your device.
- Tabs and tab groups: save, close and restore your tabs, and detect protected pages.
- Idle and alarms: lock after inactivity.

Good to know

Tab Lock adds a layer of privacy when your computer is already unlocked. It does not replace your computer's lock screen or disk encryption. A passphrase is stronger than a short PIN. Locking closes tabs, so unsaved form input is lost. Full details are in the project's README.

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
