# Runbook — publishing AI Dictionary to the Chrome Web Store

One-time setup the repo owner performs. After it's done, every `release-please` release
uploads + publishes itself (`.github/workflows/release-please.yml` → "Publish to Chrome Web
Store"). All four `CWS_*` secrets must exist or that step **skips**.

## 1. Developer account (one-time, ~$5)

1. Go to the Chrome Web Store Developer Dashboard: https://chrome.google.com/webstore/devconsole
2. Pay the one-time US$5 registration fee and complete identity verification.

## 2. Build the first package

```bash
bun run build:chrome
cd packages/extension-chrome/dist && zip -r ../../../dist-chrome.zip . && cd ../../..
```

(Or download `dist-chrome.zip` from any GitHub Release.)

## 3. Create the item + fill the listing

1. Dashboard → **Add new item** → upload `dist-chrome.zip`.
2. Fill the listing from `docs/store/chrome/listing.md`: summary, description, **Productivity**
   category, English language, **store icon** (`packages/extension-chrome/src/icons/icon-128.png`),
   **screenshots** (`docs/store/chrome/screenshots/*.png`), **promo tile**
   (`docs/store/chrome/promo-440x280.png`), and the **privacy policy URL**
   (`https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md`).
3. Complete the **Privacy practices / data use** form using the answers in `listing.md`.
4. **Save draft.** Copy the **Item ID** (the long `a…p` id) — this is `CWS_EXTENSION_ID`.

## 4. OAuth credentials (so CI can publish)

1. Google Cloud Console → create/choose a project → **APIs & Services → Library** → enable
   **Chrome Web Store API**.
2. **OAuth consent screen** → User type **External** → fill the minimum fields.
   - ⚠️ **Set Publishing status to "In production"** (Audience tab). A consent screen left in
     **Testing** issues refresh tokens that **expire after 7 days**, which would silently break
     CI publishing every week. This app only calls the Chrome Web Store API for your own account,
     so no Google verification is needed to go to production.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the
   **Client ID** (`CWS_CLIENT_ID`) and **Client secret** (`CWS_CLIENT_SECRET`).

## 5. Generate a refresh token (one-time)

Canonical guide for this CLI family:
https://github.com/fregante/chrome-webstore-upload/blob/main/How-to-generate-Google-API-keys.md

Quickest path — Google's OAuth 2.0 Playground (https://developers.google.com/oauthplayground):

1. Click the gear (⚙) → check **Use your own OAuth credentials** → paste the **Client ID** +
   **Client secret** from step 4.
2. In "Input your own scopes", enter `https://www.googleapis.com/auth/chromewebstore` →
   **Authorize APIs** → approve with the Google account that owns the dev dashboard.
3. **Exchange authorization code for tokens** → copy the **Refresh token** → `CWS_REFRESH_TOKEN`.

Because the consent screen is **In production** (step 4), this refresh token does not expire after
7 days.

## 6. Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Secret              | Value                     |
| ------------------- | ------------------------- |
| `CWS_EXTENSION_ID`  | the Item ID from step 3   |
| `CWS_CLIENT_ID`     | OAuth Client ID           |
| `CWS_CLIENT_SECRET` | OAuth Client secret       |
| `CWS_REFRESH_TOKEN` | refresh token from step 5 |

## 7. Publish

- **v1:** once the listing is complete in the dashboard, click **Submit for review** (or let the
  next release's CI step publish it). Google review takes hours–days; the first review of a new
  item with broad host permissions takes longest.
- **Every release after:** merge the `release-please` PR → the workflow uploads the new version
  and publishes it automatically. (The Web Store rejects re-uploading an existing version;
  `release-please` bumps the version every release, so this is always satisfied.)

## 8. Verify + finish

- Confirm the listing is live and install it from the store on a clean profile; set your API key
  in Settings; look up a word.
- Update `README.md`'s Install section with the live "Add to Chrome" URL (replace the interim
  note added in this PR).
