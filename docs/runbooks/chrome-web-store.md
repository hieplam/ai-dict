# Runbook — Chrome Web Store

How AI Dictionary reaches the Chrome Web Store (CWS). Referenced by
`RELEASE_CHECKLIST.md`.

Live listing: <https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg>
Extension ID: `ipnmjhndmlkbhnifhmbknjjomdocgkeg`

## The two halves — what is automated, what is not

CWS splits an item into the **package** (the extension zip) and the **listing**
(screenshots, promo tile, description, video, URLs). They are reviewed together
but reach the store by different paths:

|                 | Package (the code)                                                                      | Listing (screenshots / copy / video)         |
| --------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| How it ships    | **Automated** — `release-please.yml` runs `chrome-webstore-upload` on every release tag | **Manual** — the Developer Dashboard         |
| Trigger         | Merging the release-please Release PR                                                   | You, in the browser                          |
| Source of truth | `packages/extension-chrome/dist` → `dist-chrome.zip`                                    | `docs/store/chrome/` (`listing.md` + assets) |

`chrome-webstore-upload --source dist-chrome.zip` uploads the new package **into
the item's current draft and publishes that draft**. It does **not** touch
screenshots, description, or the video — those only change when you edit them in
the Dashboard. So a listing refresh is always a manual step.

## One-time setup — the four `CWS_*` GitHub secrets

The "Publish to Chrome Web Store" step in `release-please.yml` **skips silently**
until these repo secrets exist (Settings → Secrets and variables → Actions):

| Secret              | What it is                                                  |
| ------------------- | ----------------------------------------------------------- |
| `CWS_EXTENSION_ID`  | `ipnmjhndmlkbhnifhmbknjjomdocgkeg` (from the Dashboard URL) |
| `CWS_CLIENT_ID`     | OAuth 2.0 client id (Desktop-app type)                      |
| `CWS_CLIENT_SECRET` | that client's secret                                        |
| `CWS_REFRESH_TOKEN` | refresh token for the account that owns the item            |

To mint them:

1. In a Google Cloud project, **enable the "Chrome Web Store API"**.
2. **APIs & Services → Credentials → Create OAuth client ID → Desktop app.** Copy
   the client id + secret.
3. Get a refresh token for the **publishing Google account** (the one that owns
   the item, or a member of the publisher group):
   ```
   bunx chrome-webstore-upload-keys        # interactive; opens the consent flow
   ```
   Paste the client id/secret when prompted, approve in the browser, copy the
   printed `refresh_token`.
4. Add all four as repo secrets. Next release, the publish step runs instead of
   skipping.

> If the publish step logs "skipping" on the release run, one of these secrets is
> missing or the token was revoked (they expire if unused ~6 months, or after a
> password change).

## Cutting a release (automated package publish)

1. Land your changes on `master`. `release-please` keeps an open **Release PR**
   that bumps `package.json` + `packages/extension-chrome/src/manifest.json` and
   updates `CHANGELOG.md`. (To force a specific version, land a commit whose body
   contains `Release-As: X.Y.Z`.)
2. **Refresh the listing draft first** (next section) so the new screenshots/video
   ride along with the package in a single review.
3. Merge the Release PR. release-please tags `vX.Y.Z`, which:
   - builds `dist-chrome.zip` and attaches it to the GitHub Release, and
   - runs `chrome-webstore-upload` → uploads + submits the item for publication.
4. Publication still goes through Google review (minutes to a few days). Watch the
   **release-please** workflow run; confirm the "Publish to Chrome Web Store" step
   succeeded (not skipped).

## Refreshing the store listing (manual — Dashboard)

Do this **before** merging the Release PR (step 2 above) so one review covers both.

1. Open the **[Developer Dashboard](https://chrome.google.com/webstore/devconsole)**
   → **AI Dictionary**.
2. **Store listing** tab — everything here comes from `docs/store/chrome/`:
   - **Screenshots** (1280×800): delete the old ones, upload these five in order —
     `screenshots/01-result-card.png`, `02-select-define.png`, `03-side-panel.png`,
     `04-options.png`, `05-onboarding.png`.
   - **Small promo tile** (440×280): `promo-440x280.png`.
   - **Description / summary / category / language**: copy from `listing.md`.
   - **Official URL**: `https://hieplam.github.io/ai-dict/` · **Support URL**:
     `https://github.com/hieplam/ai-dict/issues`.
   - **YouTube video**: upload `promo-video.mp4` to YouTube (title/description
     suggestions in `listing.md`; custom thumbnail `promo-thumbnail.png`), then
     paste the watch URL into the **Video** field.
3. **Privacy practices** tab: single purpose, the three permission justifications,
   and the data-use disclosures — all verbatim in `listing.md`. Privacy policy URL:
   `https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md`.
4. **Save draft.** If doing a listing-only change (no new package), click **Submit
   for review**. If a package publish is coming, leave it saved as a draft — the
   automated publish will submit the combined draft.

## Verify & roll back

- **Verify:** after review clears, the [live listing](https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg)
  shows the new version number and the five new screenshots; install on a clean
  profile and run one lookup.
- **Roll back a bad package:** re-publish the previous good `dist-chrome.zip` from
  its GitHub Release (drag-drop into the Dashboard **Package** tab, or re-run the
  publish against that artifact). CWS keeps no automatic version rollback.
- **Roll back listing copy:** the Dashboard keeps the previously published listing;
  discard the draft to revert.
