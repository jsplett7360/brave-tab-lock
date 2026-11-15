# Verified CRX Uploads — signing Tab Lock's updates with your own key

> **Two different public keys. Don't mix them up.**
>
> | File | Whose key | Used for |
> | --- | --- | --- |
> | `tools/store-public-key.pem` | **The store item's.** Google holds the private half. It's what the dashboard shows under **Package → View public key**. | Only to give local dev builds the store ID (`tools/dev-build.sh`). **Never** paste it into Verified CRX Uploads. |
> | `tools/signing-public-key.pem` | **Yours.** It's created by `tools/make-signing-key.sh`, and only you hold the private half (`~/.config/tab-lock-signing/signing-key.pem`). | The **only** key you paste when opting in to Verified CRX Uploads. |

## Why

Once you opt in, the Chrome Web Store only accepts Tab Lock updates signed with **your**
private key. Someone who steals your Google account or a dashboard session can't push a
malicious update to Tab Lock's users without also having your key file and its
passphrase. Chrome's docs describe it as "an additional layer of security to updates"
([update docs](https://developer.chrome.com/docs/webstore/update)).

**Read before opting in:**
- **It may be permanent.** Chrome's docs don't say whether opt-in can be undone.
- **Don't lose the key.** "Don't lose your private key; otherwise, you must reach out to
  CWS support, and replacement can take up to one week." During that week you can't ship
  updates, including security fixes.
- Don't put the private key in a public repository or in your Google account (the docs
  say so too). Desktop and Documents may sync to iCloud, so the key lives in
  `~/.config/tab-lock-signing/`.
- After opt-in, upload **`.crx` files only** (from `tools/pack-crx.sh`), not the `.zip`.

## Steps (opt in only after steps 1–3 succeed)

1. **Make the key** in your own Terminal:
   ```sh
   cd /Users/joshsplett/Desktop/Joshua/Project/Life/brave-tab-lock
   ./tools/make-signing-key.sh
   ```
   Choose a long, unique passphrase at the hidden prompt and **save it in Proton Pass
   immediately** (a new login/note item, e.g. "Tab Lock signing key passphrase").
2. **Back up the encrypted key file offline.** It's
   `~/.config/tab-lock-signing/signing-key.pem`. Attach it to that Proton Pass item, and/or
   copy it to a USB drive kept somewhere safe. It's useless without the passphrase, but
   keep it private anyway. (`~/.config` is hidden in Finder: press ⌘⇧. to show it, or
   copy it in Terminal with `cp ~/.config/tab-lock-signing/signing-key.pem /Volumes/<USB>/`.)
3. **Prove it works:**
   ```sh
   ./tools/pack-crx.sh
   ```
   Enter the passphrase. It should end with `Verified: CRX3, 23 files …` and
   `Wrote …/tab-lock-0.1.1.crx`.
4. **Opt in.** Dashboard → Tab Lock → **Package** → **Verified CRX Uploads** → **Opt In**.
   When asked for your public key, paste the **entire** contents of
   `tools/signing-public-key.pem` (including the `-----BEGIN PUBLIC KEY-----` and
   `-----END PUBLIC KEY-----` lines). Show it with:
   ```sh
   cat tools/signing-public-key.pem
   ```
   Then tell the builder, so it can commit that public key to the repo.
5. **From now on**, release with `./tools/pack-crx.sh` and upload
   `tab-lock-<version>.crx` (Package → *Upload new package*). Never upload the `.zip`.
   `pack-crx.sh` refuses to sign with a key that doesn't match
   `tools/signing-public-key.pem`.
6. **If you lose the key or forget the passphrase:** contact Chrome Web Store support
   (replacement can take up to a week), make a new key with `make-signing-key.sh` (move
   the old files aside first), and give support the new public key.

Never paste the private key or the passphrase into a chat, email or ticket. If that ever
happens, treat the key as compromised: make a new one and contact support to replace it.

## Not verified yet

The CRX that `pack-crx.sh` makes declares **your key's** extension ID, not the store's
`mpggjibcbgbnmomcdknljmffhneojlpn` (seen in a dry run with a throwaway key). That's
what Chrome's documented flow produces (you're told to generate a brand-new key and pack
with it), so the store presumably keeps the item's ID. The docs don't say it explicitly,
though. The first signed upload will confirm it.
