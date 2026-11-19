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
- **0.1.1 was uploaded and rejected** (reported 2026-11-19, "Red Potassium", Content
  Policies / misleading functionality): "Restoring tabs from the vault" was "not working or
  not reproducible". The exact reviewer steps are unknown. A simple lock/unlock of 0.1.1 in
  a fresh Chrome restores tabs; the likeliest failing path was lock → restart → unlock
  (Chrome doesn't restore the previous session by default).
- 0.1.2 and 0.1.3 were never uploaded; **0.1.4 replaces them** (2026-11-19), and **0.1.5**
  (same description; locked windows no longer pop to the front) replaces 0.1.4 if it isn't
  uploaded yet. Every claim
  in the description below was re-run from the package in fresh Chrome 157 and Brave 1.100
  profiles (Item 9 record in Life/PROGRESS.md). **Verified CRX Uploads is on**, so upload
  `tab-lock-0.1.5.crx` from `./tools/pack-crx.sh`, not the zip, with the description below
  and `store/REVIEWER-TEST-INSTRUCTIONS.md` in the "Test instructions" field.

## Name
Tab Lock

## Short description (manifest "description", ≤132 characters)
Locks your browser behind a PIN and hides your open tabs. Everything stays on your device.

## Category / language
Category: Privacy & Security (pick the closest available in the dashboard). Language: English.

## Detailed description (0.1.4 and 0.1.5)

Tab Lock locks your browser behind a PIN or passphrase and hides your open tabs until you unlock it. It works in Chrome and other Chromium-based browsers.

Tab Lock is open source (MIT license) and works entirely on your device. It makes no network requests, has no accounts, and collects no data. The source code is available at github.com/jsplett7360/brave-tab-lock.

Features

- Locks automatically after a period of inactivity you choose (default 5 minutes), when your screen locks, and when the browser starts.
- Lock instantly with a keyboard shortcut (Control+Shift+L on Mac, Ctrl+Shift+L elsewhere) or the toolbar button.
- While locked, each open tab shows a lock screen instead of its page. Unlocking returns every tab to its page, so you stay signed in. If the browser did not reopen your tabs after a restart, unlocking reopens them in their windows, with pinned tabs and tab groups.
- Optional Lockdown mode closes and encrypts your tabs while locked, and reopens your windows, tabs, pinned tabs and tab groups when you unlock.
- Optional: lock only the sites you choose.
- Optional recovery code to reset a forgotten PIN, kept on your device.
- History, Settings, Passwords, Extensions and Downloads pages can require your PIN even while unlocked. Each can be turned on or off.
- After 5 wrong attempts you must wait before trying again, and the wait grows with more wrong attempts.
- Works in private windows if you allow it. Private-window tabs are kept in memory only and never written to disk. They are closed while locked and reopened in a private window when you unlock.

How your data is handled

Your PIN and recovery code are never stored. Tab Lock keeps only salted hashes of them and encrypts the addresses of your hidden tabs on your device using the browser's built-in Web Crypto API. The extension does not access the content of the websites you visit.

Permissions

- Storage: settings and the encrypted tab list, on your device.
- Tabs and tab groups: hide and restore your tabs, and detect protected pages.
- Idle and alarms: lock after inactivity.

Good to know

Tab Lock adds a layer of privacy when your computer is already unlocked. It does not replace your computer's lock screen or disk encryption. A passphrase is stronger than a short PIN. If a page reloads when you unlock, unsaved form input on it is lost. Full details are in the project's README.

## Resubmission note (if the dashboard or an appeal asks what changed)
0.1.1 was rejected because restoring tabs could not be reproduced. Since 0.1.4, locking
keeps tabs open behind a lock screen by default, and one correct PIN brings every tab
back, including after a browser restart that did not restore them; the close-and-reopen
behaviour is now the optional "Lockdown mode". Every feature in the description was
re-tested from the package in fresh Chrome and Brave profiles. Step-by-step test
instructions (about 2 minutes, PIN 123456) are in the "Test instructions" field.

## Single purpose (Privacy practices tab)
Lock the browser behind a PIN: hide the user's open tabs while locked and require the PIN
to reopen them or to open sensitive browser pages.

## Permission justifications (Privacy practices tab)
- storage: Saves the PIN verification record (salt + hash), the optional recovery-code
  record (salt + hash), settings, the wrong-attempt counter and the encrypted list of
  tabs, on the user's device only.
- tabs: Reads tab addresses and titles to encrypt and save them when locking, shows the
  lock screen in each tab and returns each tab to its page on unlock (or, in the optional
  Lockdown mode, closes and reopens them), and detects when a protected browser page
  (history, settings, passwords, extensions, downloads) is opened so it can ask for the
  PIN.
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
