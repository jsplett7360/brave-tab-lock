# Releasing a new Tab Lock version

Store item ID `mpggjibcbgbnmomcdknljmffhneojlpn` (not yet published; see `store/listing.md`).

1. **Only if shipped files changed** (`manifest.json`, `managed_schema.json`, `src/`,
   `icons/`, `LICENSE`): bump `"version"` in `manifest.json` (e.g. 0.1.1 → 0.1.2), and add
   a line to `CHANGELOG.md`.
2. **Unit tests:** `node --test test/`. All must pass.
3. **Quick manual check:** load unpacked in a spare profile (or `./tools/dev-build.sh`
   and load `dev-build/`); set a PIN, lock, unlock, open `brave://settings`.
4. **Package:**
   - After opting in to Verified CRX Uploads (`store/VERIFIED-UPLOADS.md`):
     `./tools/pack-crx.sh` → `tab-lock-<version>.crx`, signed with your key (passphrase
     prompt). It checks the CRX and refuses a key other than the one in
     `tools/signing-public-key.pem`.
   - Before opting in: `./tools/package.sh` → `tab-lock-<version>.zip`.
   - Both refuse a `manifest.json` that contains `"key"`.
5. **Upload (you):** Developer Dashboard → Tab Lock → **Package** → *Upload new package*
   → the `.crx` (or `.zip` before opt-in). Update the listing text/images if needed.
   **Submit for review.**
6. **After approval:** existing installs update automatically. Then tag the commit the
   package was built from:
   ```sh
   git tag -a v<version> -m "Tab Lock <version>" && git push origin v<version>
   ```
7. **Coordination files** (in `Life/`, outside this repo): append to `PROGRESS.md`, and
   update `STATE.md`.
