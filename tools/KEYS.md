# Keys in this folder

| File | What it is | Secret? |
| --- | --- | --- |
| `store-public-key.pem` | The Chrome Web Store **item's** public key (dashboard → Package → View public key). Google holds the private half. Used only by `dev-build.sh` so local builds get the store ID `mpggjibcbgbnmomcdknljmffhneojlpn`. | No |
| `signing-public-key.pem` | **Your** Verified-CRX-Uploads signing key's public half, created by `make-signing-key.sh`. This is what was pasted when opting in (2026-11-15; fingerprint `01ab79107c663da8`). | No |

The **private** signing key is never in this repository. It lives encrypted at
`~/.config/tab-lock-signing/signing-key.pem`, and `.gitignore` blocks every other `.pem`.
See `store/VERIFIED-UPLOADS.md`.
