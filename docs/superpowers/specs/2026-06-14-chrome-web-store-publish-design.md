# Chrome Web Store publish — design

**Date:** 2026-06-14
**Status:** Approved (brainstorming)
**Scope:** Publish the existing Chrome MV3 extension to the **Chrome Web Store** so desktop
users (Chrome, and Chromium browsers that accept Web Store installs — Brave, Opera, Edge via
its "allow other stores" toggle) can one-click **Add to Chrome** and receive auto-updates.
Version publishing is **automated from v1** via CI. **iOS/Safari (App Store) is an explicit
follow-up** — its own spec.

## Problem

Today there is **no real install path**. The only way a user can run the extension is
*sideloading*: download `dist-chrome.zip` from a GitHub Release → `chrome://extensions` →
Developer mode → **Load unpacked**. That flow is fine for testing but is not a genuine
install — it never auto-updates, shows scary warnings, and is hostile to non-technical users.
The README still says "Safari and iPhone/iPad are not supported yet."

Two concrete blockers prevent a Web Store listing right now:

1. **No icons.** `packages/extension-chrome/src/manifest.json` declares **no `icons` and no
   `action.default_icon`**. The Chrome Web Store **requires** a 128×128 store icon, and a real
   listing needs the full set (16/32/48/128).
2. **No publishing pipeline.** `release-please.yml` already builds + zips the extension and
   attaches `dist-chrome.zip` to each GitHub Release, but nothing uploads that build to the
   Chrome Web Store. Store submission is entirely manual (and currently undone).

## Goal / Outcome

A user opens the AI Dictionary listing on the Chrome Web Store, clicks **Add to Chrome**, and
the extension installs with **native auto-updates**. Every subsequent `release-please` version
(`v1.5.0`, …) **uploads and publishes itself** through CI — no manual drag-drop.

## Decisions locked (from brainstorming)

| Decision | Choice |
| --- | --- |
| Target channel | **Chrome Web Store** for PC now; iOS (Safari + App Store) is a planned follow-up. |
| Publishing model | **Automated from v1** — CI uploads + publishes via the Chrome Web Store API. |
| App icon | **Generated** in the existing brand-green "winter-morning" theme. |
| CI publish mechanism | **`chrome-webstore-upload-cli`** (option A), pinned + invoked in CI. |
| Privacy policy hosting | **`PRIVACY.md`** in the repo, referenced by its `github.com/.../blob/master/PRIVACY.md` URL. |

## The honest boundary of "automate from v1"

Publishing to the Chrome Web Store is **account-gated**, so a one-time manual setup is
unavoidable even with full automation. The Web Store API is for **updating an existing item**;
it cannot bootstrap a developer account, fill store-listing metadata, or create the very first
item's review-ready listing. Therefore:

- **One-time, manual (you):** create the developer account; create the item once in the
  dashboard to obtain its **App ID**; fill the listing (screenshots, description, privacy,
  data-use form); set up the OAuth client + refresh token; add the GitHub secrets.
- **Automated from v1 onward (CI):** the **package upload + publish action** runs in CI for
  every release — including v1 once the listing metadata and secrets are in place.

This spec delivers everything for both halves: the assets + pipeline I own, and a precise
runbook for the one-time steps you own.

## Design

### 1. Make the extension store-eligible — icons + manifest + build *(c3-2 / c3-210)*

- **Generate a brand-green icon set**: `16`, `32`, `48`, `128` px PNGs, legible at 16px,
  matching the existing winter-morning palette (the README's `#2f6f4e` family). Source from a
  single vector master, rasterized down so the 16px tile stays crisp. Committed under
  `packages/extension-chrome/src/icons/`.
- **Declare them in `manifest.json`**:
  - `"icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }`
  - extend the existing `"action"` block with a matching `"default_icon"` map.
  - Leave every existing permission/CSP field **unchanged** — only icon metadata is added.
- **Copy the icons in `esbuild.config.mjs`**: the build copies static files explicitly
  (`copyFile(...)`), so add `mkdir('dist/icons')` + copy each PNG into `dist/icons/`.
- **Update `packages/extension-chrome/test/manifest.test.ts`** to assert the `icons` /
  `action.default_icon` shape, without weakening the existing permission assertions
  (`permissions: ["storage","sidePanel"]`, no `scripting`, no `externally_connectable`).
- **Security invariant (`rule-api-key-isolation`, S1):** the distributed build **must leave
  `GEMINI_API_KEY` unset**. `esbuild.config.mjs` only bakes the key when the env var is
  present; the build-time `__GEMINI_API_KEY__` define is for **personal** builds only (see the
  c3-210 contract). The published artifact must ask each user for **their own** key via the
  options page. The release job never sets that env var today; we keep it that way and add a
  guard (below).

### 2. Store listing assets *(content — repo-versioned, not shipped in the extension)*

Stored under `docs/store/chrome/` so they are reviewed in-repo and reusable:

- **Screenshots** — 1–5 PNGs at **1280×800**, captured with **agent-browser driving a
  *bundled/standalone Chromium*** (per the repo guardrail — never the installed Google Chrome).
  Scenes: (a) select-a-word → **Define** trigger on a real article; (b) the in-page result card
  (IPA, POS, EN→EN, translation, example); (c) the side panel with lookup history; (d) the
  Settings/options page (provider + API key).
- **Small promo tile** — **440×280** PNG in brand green (name + one-line tagline).
- **Listing copy** — `docs/store/chrome/listing.md`, the canonical text to paste into the
  dashboard: name (`AI Dictionary`), **summary ≤132 chars**, full description, category
  (**Productivity**), language (English), **single-purpose statement**, **per-permission
  justifications**, and recommended **data-use disclosure** answers.
  - **Single purpose:** "Look up the meaning of a word or phrase you select on a web page, in
    context, using your own AI provider key."
  - **Permission justifications** (the `<all_urls>` host access is the **main review risk**):
    - `host_permissions: <all_urls>` + content scripts on all URLs — a dictionary must read the
      selected word **and its surrounding context** on whatever page the user is reading; no
      remote code is loaded; network egress is restricted by the manifest CSP `connect-src` to
      the chosen provider only (`generativelanguage.googleapis.com`, `api.openai.com`).
    - `storage` — store the user's API key, settings, and local history/cache.
    - `sidePanel` — the lookup history / result side panel.
- **Privacy policy** — `PRIVACY.md` at the repo root; Web Store privacy URL =
  `https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md`. Content: the extension sends the
  **selected text + a short surrounding context snippet** to the **user-chosen** AI provider
  using the user's **own** key; the API key, settings, history, and cache are stored **locally**
  (`chrome.storage.local`); the project operates **no server**, does **no analytics/tracking**,
  and **sells/​shares nothing**; data sent to Google/OpenAI is governed by **their** policies
  (linked). Aligns with the existing data-minimization rule (no `{url}`/`{title}` in prompts).

### 3. Automated publish pipeline — extend `release-please.yml` *(uncharted / repo-level)*

Add the publish into the workflow that **actually runs** — `release-please.yml`, gated on
`steps.release.outputs.release_created` — immediately **after** the existing
"Zip unpacked dist → dist-chrome.zip" step. (`release.yml` is tag-triggered and never fires,
because `release-please`'s `GITHUB_TOKEN` tags do not trigger tag-push workflows; it is left
untouched here.)

New steps (all guarded by `release_created`):

1. **API-key guard** — fail fast if a key was somehow baked: assert `GEMINI_API_KEY` is empty
   in the job env (`test -z "${GEMINI_API_KEY:-}"`). Documents and enforces S1 at release time.
2. **Publish to Chrome Web Store** — invoke the pinned `chrome-webstore-upload-cli` to upload
   `dist-chrome.zip` to the item and publish it:
   ```
   bunx chrome-webstore-upload-cli upload \
     --source dist-chrome.zip \
     --extension-id "$CWS_EXTENSION_ID" \
     --client-id "$CWS_CLIENT_ID" \
     --client-secret "$CWS_CLIENT_SECRET" \
     --refresh-token "$CWS_REFRESH_TOKEN" \
     --auto-publish
   ```
   Secrets are read from `env:` mapped to GitHub repo secrets.

**Pinning / supply chain:** add `chrome-webstore-upload-cli` to **root `devDependencies`** at a
pinned version so `bun.lock` records it and renovate keeps it current (consistent with the
repo's pinned-SHA / `bun audit` posture); invoke via `bunx`/`bun run` in CI.

**Don't break unconfigured releases:** until the secrets exist, the publish step must **skip,
not fail**, so cutting a release still produces the GitHub artifact. Map a secret into a
job-level env var (e.g. `CWS_CONFIGURED: ${{ secrets.CWS_EXTENSION_ID }}`) and guard the
publish step with `if: ${{ steps.release.outputs.release_created && env.CWS_CONFIGURED != '' }}`.

**Version monotonicity:** the Web Store rejects re-uploading an existing version.
`release-please` bumps `manifest.json`'s `version` on every release, so each uploaded package is
strictly newer — satisfied by construction.

### 4. One-time setup you own — runbook `docs/runbooks/chrome-web-store.md`

A precise, click-by-click runbook:

1. Register a **Chrome Web Store developer account** (one-time **$5**) + identity verification.
2. Produce a v1 zip (`bun run build:chrome` then zip `dist/`, or download `dist-chrome.zip`
   from a GitHub Release).
3. **Create the item** in the dashboard: upload the zip, fill the listing from
   `docs/store/chrome/listing.md` (store icon, screenshots, promo, description, category,
   language, **privacy URL**, **data-use form**), **Save draft**, and copy the **App ID**.
4. **Google Cloud**: create a project → **enable the Chrome Web Store API** → configure the
   **OAuth consent screen** → create an **OAuth client ID** (type **Desktop app**).
   - ⚠️ **Gotcha (must do):** set the consent screen to **In production**, *not* Testing —
     refresh tokens for a "Testing" app **expire after 7 days**, which would silently break CI
     publishing weekly. This app only calls the Web Store API for your own account, so no Google
     verification is required to publish the consent screen.
5. **Generate a refresh token** (one-time OAuth exchange — exact commands in the runbook).
6. Add four **GitHub repo secrets**: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`.
7. Merge the next `release-please` PR → CI uploads + publishes. (For v1, you may click
   **Publish** once in the dashboard after the listing is complete; CI handles every release
   thereafter.)
8. **Verify** the listing is live and install it from the store.

### 5. Docs

- **`RELEASE_CHECKLIST.md`** — Chrome publishing becomes **automated**; drop the manual
  "drag-drop `dist-chrome.zip`" item; keep the iOS/App Store item flagged as the follow-up.
- **`README.md`** — once live, repoint the Install section at the store listing ("Add to
  Chrome") while keeping the from-source dev build for contributors.
- **`PRIVACY.md`** (new, §2) and **`docs/runbooks/chrome-web-store.md`** (new, §4).

## Security & architecture guardrails

- **`rule-api-key-isolation` (S1):** distributed build leaves `GEMINI_API_KEY` unset; enforced
  by the §3 guard step. No change to the runtime key boundary.
- **Manifest permissions unchanged:** only icon metadata is added; `permissions`,
  `host_permissions`, and CSP stay exactly as the release checklist (§7.3 S8) requires.
- **No new network surface, no remote code:** publishing is a CI/packaging concern; the
  extension's behavior is unchanged.

## Out of scope

- **iOS / Safari App Store** — separate follow-up spec (Apple Developer Program $99/yr, Xcode
  signing, App Store review; the repo already scaffolds `extension-safari` + an Xcode project).
- Microsoft Edge Add-ons store, Firefox AMO.
- Staged/percentage rollout, trusted-tester track.
- Any change to extension runtime behavior, permissions, or the key boundary.
- Cleaning up the dead tag-triggered `release.yml` (out of scope; revisit with the iOS spec,
  since the Safari archive steps live there).

## Risks & mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Google review latency / rejection for broad `<all_urls>` | Tight single-purpose + per-permission justification + privacy policy; expect hours–days, first review longest. |
| R2 | OAuth **refresh token expires in 7 days** (Testing consent screen) | Runbook mandates **In production** consent screen. |
| R3 | Chicken-and-egg: API upload needs an existing **App ID** | One-time dashboard item creation (runbook §4.3); unavoidable. |
| R4 | Secrets absent → release CI fails | Publish step **guarded** to skip when unconfigured (§3). |
| R5 | `--auto-publish` goes live immediately after review | Intended ("automate from v1"); to stage, drop the flag and publish manually. |
| R6 | Re-upload of same version rejected | `release-please` bumps the version every release. |

## Definition of done

**This PR (what I own) — done when squash-merged with all CI green:**

- Icon set + `manifest.json` `icons`/`action.default_icon` + `esbuild.config.mjs` copy +
  updated `manifest.test.ts`.
- Listing assets: screenshots, promo tile, `listing.md`, `PRIVACY.md`.
- `release-please.yml` publish step (guarded) + pinned `chrome-webstore-upload-cli` dep.
- `docs/runbooks/chrome-web-store.md`, `RELEASE_CHECKLIST.md` + `README.md` updates.
- This spec + its implementation plan.

**Go-live (what you own), gated only on the one-time runbook §4:** dev account, item + App ID,
OAuth + refresh token, four GitHub secrets. I can pair live while you paste credentials.

## Verification / evidence

- `bun run build:chrome` produces `dist/icons/*` and a manifest with icons; **Load unpacked**
  shows the toolbar icon. Full `bun test`, `bun run lint` (incl. dep-direction gate), and the
  `e2e-chrome` job stay green.
- Workflow parses; with secrets **absent** the publish step **skips** and the release still
  attaches `dist-chrome.zip`; with secrets present, a dry-run upload reaches a draft item.
- Per repo convention, attach **Before/After** evidence + a short recording (build → icon'd zip
  → guarded publish step) to the PR, hosted on a `pr-assets/*` branch via **same-origin**
  `github.com/.../raw/...` URLs (private-repo requirement).

## C3 note

Per repo convention, implementation runs through C3:

- **ADR-first:** open the change with `c3 add adr <slug>` as the work order before editing code.
- **Ownership:** `manifest.json` is owned by **c3-210** (chrome-service-worker) under container
  **c3-2** (extension-chrome), which already owns "the MV3 `manifest.json`, the esbuild bundle".
  Governing rule: **`rule-api-key-isolation`**.
- **Parent Delta:** adding `icons`/`action.default_icon` is packaging metadata — record a
  **no-delta** (or a one-line responsibility note) against c3-2's Components/Responsibilities;
  no new component.
- **Codemap map-or-exclude:** `esbuild.config.mjs`, `test/manifest.test.ts`,
  `.github/workflows/release-please.yml`, `scripts/*`, `README.md`, `docs/**`, `PRIVACY.md`, and
  the new `src/icons/*` assets are currently **uncharted**; map them to c3-2 or explicitly
  exclude them during implementation.
- Run **`c3 check`** after every `.c3` mutation.
