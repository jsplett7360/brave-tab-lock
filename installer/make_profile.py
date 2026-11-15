#!/usr/bin/env python3
"""Tab Lock — build the macOS configuration profile (.mobileconfig).

Python standard library only. Run it through install.sh. It never installs anything
itself: it only writes a file into installer/out/.

The profile contains:
  1. Brave policy (domain com.brave.Browser): ExtensionSettings → force-install Tab Lock
     from the Chrome Web Store, so it can't be removed or turned off inside Brave.
     Optional: TorDisabled (turns off Brave's private windows with Tor).
  2. Tab Lock managed storage (domain com.brave.Browser.extensions.<id>): a salted
     PBKDF2-SHA256 record of the master PIN. The PIN itself is never written.

Limitation: Chromium only force-installs extensions hosted OUTSIDE the Chrome Web Store
on MDM-managed Macs. That's why the Web Store extension ID is required.
"""

import argparse
import base64
import getpass
import hashlib
import os
import plistlib
import re
import secrets
import sys
import uuid

ITERATIONS = 600_000            # must match src/crypto.js PBKDF2_ITERATIONS
SALT_BYTES = 16
MIN_PIN_DIGITS = 6
MIN_PASSPHRASE_CHARS = 8
WEB_STORE_UPDATE_URL = "https://clients2.google.com/service/update2/crx"
PROFILE_ID = "org.tablock.brave-policy"
BRAVE_DOMAINS = {"stable": "com.brave.Browser", "beta": "com.brave.Browser.beta", "nightly": "com.brave.Browser.nightly"}


def validate_secret(secret, kind):
    if kind == "pin":
        if not re.fullmatch(r"[0-9]+", secret):
            return "A PIN may contain digits only."
        if len(secret) < MIN_PIN_DIGITS:
            return f"A PIN needs at least {MIN_PIN_DIGITS} digits."
    elif len(secret) < MIN_PASSPHRASE_CHARS:
        return f"A passphrase needs at least {MIN_PASSPHRASE_CHARS} characters."
    return None


def pin_record(secret, kind):
    """Same parameters as the extension (src/crypto.js hashSecret)."""
    import unicodedata
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", secret).encode("utf-8"), salt, ITERATIONS)
    return {
        "kind": kind,
        "iterations": ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(digest).decode("ascii"),
    }


def forced(settings):
    return {"Forced": [{"mcx_preference_settings": settings}]}


def build_profile(ext_id, record, domain, disable_tor):
    brave_settings = {
        "ExtensionSettings": {
            ext_id: {"installation_mode": "force_installed", "update_url": WEB_STORE_UPDATE_URL},
        },
    }
    if disable_tor:
        brave_settings["TorDisabled"] = True
    payload = {
        "PayloadType": "com.apple.ManagedClient.preferences",
        "PayloadVersion": 1,
        "PayloadIdentifier": f"{PROFILE_ID}.prefs",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": "Tab Lock for Brave",
        "PayloadEnabled": True,
        "PayloadContent": {
            domain: forced(brave_settings),
            f"{domain}.extensions.{ext_id}": forced({"masterPin": record}),
        },
    }
    return {
        "PayloadType": "Configuration",
        "PayloadVersion": 1,
        "PayloadIdentifier": PROFILE_ID,
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": "Tab Lock for Brave",
        "PayloadDescription": (
            "Force-installs the Tab Lock extension in Brave (it can't be removed from inside Brave) "
            "and sets one master PIN for every Brave profile. Contains a salted hash of the PIN, not the PIN. "
            "Remove this profile in System Settings to undo."
        ),
        "PayloadOrganization": "Tab Lock (local)",
        "PayloadScope": "System",
        "PayloadRemovalDisallowed": False,
        "PayloadContent": [payload],
    }


def read_secret(kind, from_stdin):
    word = "PIN" if kind == "pin" else "passphrase"
    if from_stdin:
        line = sys.stdin.readline().rstrip("\n")
        return line, line
    a = getpass.getpass(f"Master {word}: ")
    b = getpass.getpass(f"Type the {word} again: ")
    return a, b


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--extension-id", required=True, help="Tab Lock's Chrome Web Store ID (32 letters a-p)")
    p.add_argument("--kind", choices=["passphrase", "pin"], default="passphrase")
    p.add_argument("--channel", choices=sorted(BRAVE_DOMAINS), default="stable")
    p.add_argument("--disable-tor", action="store_true", help="also turn off Brave's private windows with Tor")
    p.add_argument("--out", required=True, help="output .mobileconfig path")
    p.add_argument("--secret-stdin", action="store_true", help=argparse.SUPPRESS)  # tests only
    a = p.parse_args(argv)

    if not re.fullmatch(r"[a-p]{32}", a.extension_id):
        p.error("--extension-id must be 32 letters a-p (copy it from the Chrome Web Store dashboard)")
    s1, s2 = read_secret(a.kind, a.secret_stdin)
    if s1 != s2:
        print("The two entries don't match.", file=sys.stderr)
        return 2
    problem = validate_secret(s1, a.kind)
    if problem:
        print(problem, file=sys.stderr)
        return 2

    record = pin_record(s1, a.kind)
    profile = build_profile(a.extension_id, record, BRAVE_DOMAINS[a.channel], a.disable_tor)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f:
        plistlib.dump(profile, f, fmt=plistlib.FMT_XML)
    os.chmod(a.out, 0o600)
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
