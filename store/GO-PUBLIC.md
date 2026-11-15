# Switch Tab Lock from Unlisted to Public (you do this in the Developer Dashboard)

Recommended order:

1. **Upload 0.1.1 first** (Package → *Upload new package* → `tab-lock-0.1.1.zip`). In
   the same draft, on the **Store listing** tab, upload the small promo tile
   `store/promo-small-440x280.png`. **Save draft → Submit for review**, keeping it
   **Unlisted**.
2. When 0.1.1 is approved, run the installer live test (`installer/LIVE-TEST.md`), if
   you want the installer working before going public.
3. **Go public:** **Distribution** tab → **Visibility: Public** → **Save draft** →
   **Submit for review**. Leave everything else as is (free, all regions).

**Does switching visibility trigger a review?** Chrome's docs don't say. They say "All
visibility settings have the same policy requirements and will go through the same
review process"
([distribution docs](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)).
The only change they explicitly say does *not* trigger review is a rollout-percentage
change ([update docs](https://developer.chrome.com/docs/webstore/update)). Expect it may
go through review; the dashboard shows the status.

After it's public: the store link in `README.md` stays the same. Update `STATE.md`.
