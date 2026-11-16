# Submit Tab Lock to the Chrome Web Store — steps you do yourself

Status (2026-11-15): **0.1.0 was rejected** ("Yellow Nickel", Spam and Placement in the
Store) and has **never been published**. The user submitted a plain description and
appealed; the outcome is pending. See `store/listing.md` → Status. Store item ID:
`mpggjibcbgbnmomcdknljmffhneojlpn`.

1. ✅ Make the GitHub repo public: https://github.com/jsplett7360/brave-tab-lock
   (privacy policy: https://github.com/jsplett7360/brave-tab-lock/blob/main/PRIVACY.md).
2. ✅ **Developer account** (Chrome Web Store Developer Dashboard,
   https://chrome.google.com/webstore/devconsole). One-time registration fee; the
   account's email can't be changed later
   ([docs](https://developer.chrome.com/docs/webstore/register)).
3. ✅ **Package:** `./tools/package.sh` → `tab-lock-<version>.zip`.
4. ✅ **New item → upload the zip** (0.1.0).
5. ✅ **Extension ID:** `mpggjibcbgbnmomcdknljmffhneojlpn`. The store item's public key is
   in `tools/store-public-key.pem` (dev builds only; see `tools/KEYS.md`).
6. ✅ **Store listing tab:** description (replaced 2026-11-15 with the plain text in
   `store/listing.md`), `icons/icon128.png`, screenshots. ➕ Still to upload: the small
   promo tile `store/promo-small-440x280.png`.
7. ✅ **Privacy practices tab** (all answers in `store/listing.md`).
8. ✅ **Distribution:** Unlisted, free (chosen; nothing is published yet).
9. ❌ **Review: 0.1.0 rejected** → ✅ new description submitted + appeal filed → ⏳ waiting.
10. ✅ **Verified CRX Uploads: opted in (2026-11-15).** Signing key fingerprint
    `01ab79107c663da8` (public half: `tools/signing-public-key.pem`). From now on, upload
    only `.crx` files from `./tools/pack-crx.sh`.
11. Next: after the appeal, upload `tab-lock-0.1.3.crx` + the updated description (see
    `store/GO-PUBLIC.md`). 0.1.1 and 0.1.2 were never uploaded; 0.1.3 replaces them.
