# Security

## Reporting a problem

Please report security issues privately using GitHub's **"Report a vulnerability"**
(Security → Advisories) on this repository rather than in a public issue. Include the
browser and version, what you did, and what you expected. There is no bug bounty.

## Threat model

**Protects against:** a person who gets physical access to your **already-unlocked**
computer and opens the browser. They should not be able to:
- see the tabs you had open,
- open History, Settings, Passwords, Extensions or Downloads,
- turn Tab Lock off. Fully preventing removal needs the macOS installer (Brave policy).

**Does not protect against** (see the README's "Known limits"):
- Someone who can read your profile's files (e.g. your Mac is unlocked long enough to
  copy them, or FileVault is off). They can brute-force a short PIN offline; use a
  passphrase.
- Data Brave itself keeps on disk (history, session files, cache).
- Another browser profile, a new profile, or another browser.
- Malware, or anyone with your Mac's administrator password (they can remove the policy).
- Coercion. Anyone who can make you unlock your Mac can make you enter the PIN.

**Design choices that follow from this:**
- No network code at all, so there is nothing to leak to.
- WebCrypto only: PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt,
  constant-time compare), AES-GCM-256 with a fresh 12-byte IV per write, RSA-OAEP-3072
  to seal the per-lock key. The PIN and derived keys are never stored.
- Lock state lives in storage, so a restarted service worker or browser stays locked.
- The saved tabs are deleted only after a successful restore.
- Wrong-PIN backoff is stored on disk and survives restarts.
