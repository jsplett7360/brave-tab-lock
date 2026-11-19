# Test instructions (paste into the dashboard's "Test instructions" field)

No account or login is needed. Everything runs on the device; takes about 2 minutes.

1. Install Tab Lock. A "Set up Tab Lock" tab opens.
2. Under "Type", choose "PIN (at least 6 digits)" (the default, passphrase, needs 8+ characters). Enter 123456 twice and click Save.
3. Recovery code step: click Skip, then "Skip anyway".
4. Open three websites in new tabs (e.g. example.com, wikipedia.org, developer.chrome.com). Optionally pin one tab and put two in a tab group.
5. Click the Tab Lock toolbar button (or press Ctrl+Shift+L; Control+Shift+L on Mac). Every tab now shows "Browser locked".
6. In any of those tabs, type 123456 and click Unlock. Every tab returns to its page, in place, with pins and groups unchanged.
7. Restart: lock again, quit the browser, start it. Tabs show "Browser locked" (if the browser does not restore tabs, one lock page appears). Enter 123456: all tabs come back in their windows, pinned tabs and groups included.
8. Lockdown mode: right-click the toolbar icon → Options, enter 123456, open "Advanced", tick "Lockdown mode". Lock: tabs close and one lock page stays. Unlock with 123456: windows, tabs, pinned tabs and groups reopen.
9. Protected pages: open chrome://history (or Settings, Extensions, Downloads, Passwords). A PIN prompt appears; 123456 opens the page.
10. Wrong PIN: 5 wrong PINs on the lock screen start a 30-second wait; a 6th wrong PIN makes it 60 seconds.

Note: settings (Options) ask for the PIN; the inactivity lock defaults to 5 minutes and can be set to 1 minute there.
