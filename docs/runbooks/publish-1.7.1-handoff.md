# Handoff — publishing AI Dictionary v1.7.1 to the Chrome Web Store

**Read this first when continuing on another machine.** It is self-contained.
Full process reference: [`chrome-web-store.md`](./chrome-web-store.md).

Snapshot: 2026-07-03 · Extension ID `ipnmjhndmlkbhnifhmbknjjomdocgkeg` ·
[live listing](https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg)

## Where we are

- ✅ **All store assets refreshed and on `master`** (PR #86, merged): the 5-shot
  screenshot set, promo video + thumbnail, promo tile, `listing.md`, and the CWS
  runbook.
- ✅ **release-please is fixed** — it had silently skipped the bump because the #86
  squash subject started with the `[store-presence-1.7.1]` branch prefix, which its
  parser can't read (`commit could not be parsed`), so it never saw the `Release-As`
  footer. Fixed by the clean trigger commit `bd44134 chore: release 1.7.1`.
- ✅ **Release PR is open: [#87 `chore(master): release 1.7.1`](https://github.com/hieplam/ai-dict/pull/87)**
  — bumps `package.json` + `manifest.json` to 1.7.1 and writes the changelog.
- ⏳ **Not done yet:** merge #87 · build/upload the package · refresh the live
  listing · put the promo on YouTube.
- ⚠️ **The four `CWS_*` GitHub secrets are NOT set** → the pipeline will **not**
  auto-publish. You'll drag-drop the built zip into the Dashboard this release.

## Assets (paths on `master`, after `git pull`)

| Asset                                                | Path                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Screenshots (1280×800, upload in order)              | `docs/store/chrome/screenshots/01-result-card.png` … `05-onboarding.png` |
| Small promo tile (440×280)                           | `docs/store/chrome/promo-440x280.png`                                    |
| Promo video (1920×1080, ~48 s, **silent by design**) | `docs/store/chrome/promo-video.mp4`                                      |
| YouTube thumbnail (1280×720)                         | `docs/store/chrome/promo-thumbnail.png`                                  |
| Listing copy (summary/description/privacy)           | `docs/store/chrome/listing.md`                                           |

## Do this next (in order)

1. **Merge Release PR [#87](https://github.com/hieplam/ai-dict/pull/87).** This tags
   `v1.7.1` and CI builds `dist-chrome.zip`, attaching it to the
   [v1.7.1 GitHub Release](https://github.com/hieplam/ai-dict/releases).
2. **Download `dist-chrome.zip`** from that release.
3. **Upload the promo to YouTube** (`promo-video.mp4`): set the custom thumbnail
   (`promo-thumbnail.png`), title/description from `listing.md`, audience = _not
   made for kids_, visibility **Public or Unlisted (not Private)**. Copy the watch
   URL. (Silent audio is expected.)
4. **Chrome Web Store [Dashboard](https://chrome.google.com/webstore/devconsole) →
   AI Dictionary:**
   - **Package** tab → upload `dist-chrome.zip` (the 1.7.1 build).
   - **Store listing** tab → 5 screenshots in order, promo tile, summary +
     description from `listing.md`, **Official URL** `https://hieplam.github.io/ai-dict/`,
     **Support URL** `https://github.com/hieplam/ai-dict/issues`, paste the YouTube URL.
   - **Privacy practices** tab → single purpose + 3 permission justifications + data
     disclosures (all verbatim in `listing.md`); privacy policy
     `https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md`.
   - **Submit for review.**
5. **Verify** once review clears: the live listing shows **1.7.1** and the five new
   screenshots. Install on a clean profile and run one lookup.

## Gotchas / lessons

- **Branch-prefix vs release-please:** any release-driving commit (`feat`/`fix`, or a
  `Release-As:` trigger) must have a **clean conventional subject** — no `[BranchName]`
  prefix — or release-please drops it. Feature PRs so far merged with clean subjects,
  so it "worked"; it only broke when the trigger sat in a prefixed docs commit.
- **No auto-publish this release:** `CWS_*` secrets are unset, so upload the zip by
  hand. To automate future releases, mint them — see
  [`chrome-web-store.md` → One-time setup](./chrome-web-store.md#one-time-setup--the-four-cws_-github-secrets).
- **Evidence:** PR before/after images live on the throwaway branch
  `pr-assets/store-presence-1.7.1`.
