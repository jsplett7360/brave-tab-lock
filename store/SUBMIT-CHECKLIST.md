# Submit Tab Lock to the Chrome Web Store — steps you do yourself

The builder prepared everything below but did not submit, upload or pay anything.

1. **Make the GitHub repo public first** (the privacy policy URL points into it).
2. **Developer account.** Go to the Chrome Web Store Developer Dashboard
   (https://chrome.google.com/webstore/devconsole), sign in with the Google account
   you want to publish under, and accept the developer agreement. Pay the **one-time
   registration fee** (the amount is shown on that screen). Note: the account's email
   can't be changed later
   ([docs](https://developer.chrome.com/docs/webstore/register)).
3. **Package:** in the repo, run `./tools/package.sh` → `tab-lock-0.1.0.zip`.
4. **New item → upload the zip.** Don't publish yet.
5. **Copy the extension ID** (dashboard item ID). That's the ID the macOS installer
   needs. Optional: Package tab → "View public key" → put it on one line as `"key"` in
   your local `manifest.json`, so a load-unpacked build has the same ID (don't commit it
   unless you want to).
6. **Store listing tab:** paste the description from `store/listing.md`. Upload
   `icons/icon128.png` and the screenshots from `store/screenshots/`. Category and
   language.
7. **Privacy practices tab:** single purpose, permission justifications, "no remote
   code", data usage = none + the three certifications, privacy policy URL (all in
   `store/listing.md`).
8. **Distribution:** Public (or **Unlisted** if you only want the ID for the installer
   first). Free.
9. **Submit for review.** Review time varies.
10. After it's live: `./installer/install.sh --extension-id <ID>` (dry run), then
    `--install` when ready. See `installer/INSTALLER.md`.
