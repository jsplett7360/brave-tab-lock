# Releasing a new Tab Lock version

Store item: https://chromewebstore.google.com/detail/mpggjibcbgbnmomcdknljmffhneojlpn

1. **Only if shipped files changed** (`manifest.json`, `managed_schema.json`, `src/`,
   `icons/`, `LICENSE`): bump `"version"` in `manifest.json` (e.g. 0.1.1 → 0.1.2), and add
   a line to `CHANGELOG.md`.
2. **Unit tests:** `node --test test/`. All must pass.
3. **Quick manual check:** load unpacked in a spare profile (or `./tools/dev-build.sh`
   and load `dev-build/`); set a PIN, lock, unlock, open `brave://settings`.
4. **Package:** `./tools/package.sh` → `tab-lock-<version>.zip`. It refuses if
   `manifest.json` contains `"key"`, and checks the zip too.
5. **Upload (you):** Developer Dashboard → Tab Lock → **Package** → *Upload new package*
   → the zip. Update the listing text/images if needed. **Submit for review.**
6. **After approval:** existing installs update automatically. Then tag the commit the zip
   was built from:
   ```sh
   git tag -a v<version> -m "Tab Lock <version>" && git push origin v<version>
   ```
7. **Coordination files** (in `Life/`, outside this repo): append to `PROGRESS.md`, and
   update `STATE.md`.
