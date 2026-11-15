# Getting Tab Lock published (you do this in the Developer Dashboard)

Nothing is published yet: 0.1.0 was rejected and is under appeal (see `store/listing.md`).

1. **Wait for the appeal outcome.** If it's rejected again, tell the builder before
   changing anything else (the next suspect is the repository name in the description).
2. ✅ Signed uploads are set up (opted in 2026-11-15, `store/VERIFIED-UPLOADS.md`).
3. **Upload 0.1.1:** Package → *Upload new package* → `tab-lock-0.1.1.crx` from
   `./tools/pack-crx.sh` (after opt-in, updates must be signed CRX files). Without
   opt-in, the `.zip` from `./tools/package.sh`. On the **Store listing** tab, upload the
   small promo tile `store/promo-small-440x280.png`. **Save draft → Submit for review.**
   Keep it **Unlisted** if you want to run the installer live test
   (`installer/LIVE-TEST.md`) before going public.
4. **Go public:** **Distribution** tab → **Visibility: Public** → **Save draft** →
   **Submit for review**. Leave everything else as is (free, all regions).

**Does switching visibility trigger a review?** Chrome's docs don't say. They say "All
visibility settings have the same policy requirements and will go through the same
review process"
([distribution docs](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)).
The only change they explicitly say does *not* trigger review is a rollout-percentage
change ([update docs](https://developer.chrome.com/docs/webstore/update)). Expect it may
go through review; the dashboard shows the status.

After it's published: update the README's store line and `STATE.md`.
