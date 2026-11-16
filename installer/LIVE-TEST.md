# Installer live test (you run it; the builder records your results)

**Blocked until a Tab Lock version is approved on the store** (0.1.0 was rejected and is
under appeal; 0.1.2 isn't uploaded yet). Do this **after 0.1.2 is approved**. The installer always installs
the store's current version; 0.1.1 and later have the master-PIN setup prompt. Report each
result in your own words; nothing here asks for your PIN.

## Setup
1. In every Brave profile that has Tab Lock: **unlock** it. Remove any "Load unpacked"
   copy (`brave://extensions` → Remove). You may keep the store copy installed.
2. Have (or create) **two Brave profiles**, A and B, for the check below.
3. In Terminal:
   ```sh
   cd /Users/joshsplett/Desktop/Joshua/Project/Life/brave-tab-lock
   ./installer/install.sh --extension-id mpggjibcbgbnmomcdknljmffhneojlpn --install
   ```
   Type your master **passphrase** at the hidden prompt, twice.
4. System Settings → General → Device Management → **Tab Lock for Brave** → Install →
   administrator password.
5. Quit Brave completely (⌘Q) and reopen it.

## Checks (report each one)
| # | Check | What to look for | Result |
| --- | --- | --- | --- |
| 1 | `brave://policy` | `ExtensionSettings` listed with status OK; Tab Lock's policies (`masterPin`) listed under its extension ID | untested |
| 2 | Tab Lock installed in profile A and B | Present in `brave://extensions` in both (store ID `mpggjibcbgbnmomcdknljmffhneojlpn`) — this also answers "does Unlisted force-install work" | untested |
| 3 | Can't remove or disable | In `brave://extensions` there's no Remove button and the toggle is greyed out; right-clicking the toolbar button has no "Remove from Brave" | untested |
| 4 | "Managed by your organization" | Shown in Brave's menu or settings | untested |
| 5 | Setup prompt | A profile that had its own PIN shows the "!" badge + the setup page; entering the master PIN there works | untested |
| 6 | Master PIN in A and B | Lock each (Control+Shift+L); the master passphrase unlocks both, and the old per-profile PIN does not | untested |
| 7 | PIN change disabled | Tab Lock settings → "The PIN is managed by your Mac — rerun the installer to change it." | untested |
| 8 | Protected pages | `brave://settings` still asks for the PIN | untested |
| 9 | Keyboard shortcut + toolbar button lock | (not testable by the builder's automation) | untested |

## Uninstall path
10. Unlock every profile. Then: `./installer/uninstall.sh --run` (or System Settings →
    Device Management → Remove). Quit and reopen Brave.
| # | Check | What to look for | Result |
| --- | --- | --- | --- |
| 10 | Policies gone | `brave://policy` no longer lists Tab Lock's or the ExtensionSettings policy; no "Managed by your organization" | untested |
| 11 | Tab Lock after removal | Expected per Chromium's policy text: Brave uninstalls it automatically in every profile | untested |

Afterwards you can reinstall from the store (per-profile PIN) or rerun the installer.
