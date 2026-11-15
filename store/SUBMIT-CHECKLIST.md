# Submit Tab Lock to the Chrome Web Store — steps you do yourself

Status (2026-11-15): steps 1–9 done. Tab Lock 0.1.0 was approved as **Unlisted**:
https://chromewebstore.google.com/detail/mpggjibcbgbnmomcdknljmffhneojlpn
(ID `mpggjibcbgbnmomcdknljmffhneojlpn`). Updates: `RELEASE.md`. Going public:
`store/GO-PUBLIC.md`.

1. ✅ Make the GitHub repo public: https://github.com/jsplett7360/brave-tab-lock
   (privacy policy: https://github.com/jsplett7360/brave-tab-lock/blob/main/PRIVACY.md).
2. ✅ **Developer account** (Chrome Web Store Developer Dashboard,
   https://chrome.google.com/webstore/devconsole). One-time registration fee; the
   account's email can't be changed later
   ([docs](https://developer.chrome.com/docs/webstore/register)).
3. ✅ **Package:** `./tools/package.sh` → `tab-lock-<version>.zip`.
4. ✅ **New item → upload the zip.**
5. ✅ **Extension ID:** `mpggjibcbgbnmomcdknljmffhneojlpn`. Public key saved in
   `tools/store-public-key.pem` (used by `tools/dev-build.sh`, never by the store zip).
6. ✅ **Store listing tab:** description from `store/listing.md`, `icons/icon128.png`,
   screenshots from `store/screenshots/`. ➕ Still to upload: the small promo tile
   `store/promo-small-440x280.png` (see `store/GO-PUBLIC.md`).
7. ✅ **Privacy practices tab** (all answers in `store/listing.md`).
8. ✅ **Distribution:** Unlisted, free.
9. ✅ **Submitted and approved.**
10. Next: the macOS installer live test (`installer/LIVE-TEST.md`), then
    `store/GO-PUBLIC.md`.
