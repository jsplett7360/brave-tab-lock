# Keys in this folder

| File | What it is | Secret? |
| --- | --- | --- |
| `store-public-key.pem` | The Chrome Web Store **item's** public key (dashboard → Package → View public key). Google holds the private half. Used only by `dev-build.sh` so local builds get the store ID `mpggjibcbgbnmomcdknljmffhneojlpn`. | No |
| `signing-public-key.pem` | **Your** Verified-CRX-Uploads signing key's public half, created by `make-signing-key.sh`. This is what was pasted when opting in (2026-11-15; fingerprint `01ab79107c663da8`). | No |

The **private** signing key is never in this repository. It lives encrypted at
`~/.config/tab-lock-signing/signing-key.pem`, and `.gitignore` blocks every other `.pem`.
See `store/VERIFIED-UPLOADS.md`.

## Names and locations (never values)

| Name | Service | Purpose | Where it lives | Created | How to revoke / replace |
| --- | --- | --- | --- | --- | --- |
| Tab Lock Chrome Developer Master Passphrase (Proton Pass item) | Chrome Web Store — Verified CRX Uploads | Decrypts the private signing key; `tools/pack-crx.sh` asks for it | Proton Pass | 2026-11-15 | Can't be revoked on its own: make a new key with `tools/make-signing-key.sh` and ask Chrome Web Store support to replace the registered key (up to a week; see `store/VERIFIED-UPLOADS.md` step 6), then retire this item |
| Signing key `signing-key.pem` (fingerprint `01ab79107c663da8`) | Chrome Web Store — Verified CRX Uploads | Signs every upload since the 2026-11-15 opt-in | Encrypted at `~/.config/tab-lock-signing/signing-key.pem`; offline backup (user) | 2026-11-15 | Same as above (a key change goes through Chrome Web Store support) |
