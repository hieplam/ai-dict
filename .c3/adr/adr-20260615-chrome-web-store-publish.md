---
id: adr-20260615-chrome-web-store-publish
c3-seal: 411df2f2eca34c23b47e7295cf436867a8e01c1eead6b395ca23763ddbfb2335
title: chrome-web-store-publish
type: adr
goal: 'Publish the existing Chrome MV3 extension (`c3-2`) to the Chrome Web Store so desktop users can one-click "Add to Chrome" and receive automatic OTA updates via Google''s hosting. Every subsequent `release-please` release must upload and publish itself through CI — no manual drag-drop. The concrete work order: add a 16/32/48/128 icon set + `action.default_icon` to `packages/extension-chrome/src/manifest.json`; wire icon copies into the esbuild build; create store listing assets (screenshots, promo tile, `listing.md`, `PRIVACY.md`); add a guarded `chrome-webstore-upload-cli` publish step to `.github/workflows/release-please.yml`; and write a one-time setup runbook. iOS/Safari App Store is an explicit follow-up in a separate spec.'
status: implemented
date: "2026-06-15"
---

# Chrome Web Store publish

## Goal

Publish the existing Chrome MV3 extension (`c3-2`) to the Chrome Web Store so desktop users can one-click "Add to Chrome" and receive automatic OTA updates via Google's hosting. Every subsequent `release-please` release must upload and publish itself through CI — no manual drag-drop. The concrete work order: add a 16/32/48/128 icon set + `action.default_icon` to `packages/extension-chrome/src/manifest.json`; wire icon copies into the esbuild build; create store listing assets (screenshots, promo tile, `listing.md`, `PRIVACY.md`); add a guarded `chrome-webstore-upload-cli` publish step to `.github/workflows/release-please.yml`; and write a one-time setup runbook. iOS/Safari App Store is an explicit follow-up in a separate spec.

## Context

Today there is no real install path. The only route is sideloading: download `dist-chrome.zip` from a GitHub Release → `chrome://extensions` → Developer mode → Load unpacked. This flow never auto-updates, shows scary warnings, and is hostile to non-technical users. Two concrete blockers prevent a Web Store listing: (1) `packages/extension-chrome/src/manifest.json` declares no `icons` and no `action.default_icon` — the Chrome Web Store requires a 128×128 store icon and a full 16/32/48/128 set; (2) `release-please.yml` builds and zips the extension but nothing uploads it to the Web Store. Full rationale: `docs/superpowers/specs/2026-06-14-chrome-web-store-publish-design.md`. Affected topology: `c3-2` (extension-chrome) and its child component `c3-210` (chrome-service-worker, which owns `manifest.json` and the esbuild bundle).

## Decision

Publish to the Chrome Web Store using `chrome-webstore-upload-cli` invoked from `release-please.yml`, guarded so unconfigured releases skip rather than fail. Concretely: (a) generate brand-green 16/32/48/128 PNG icons committed under `packages/extension-chrome/src/icons/`; (b) add `"icons"` and `"action.default_icon"` maps to `manifest.json` — no other permission/CSP field changes; (c) extend `esbuild.config.mjs` to copy icons into `dist/icons/`; (d) update `packages/extension-chrome/test/manifest.test.ts` to assert the icon shape; (e) add `chrome-webstore-upload-cli` to root `devDependencies` at a pinned version; (f) add a CI `GEMINI_API_KEY` guard + upload/publish step to `release-please.yml`; (g) produce listing assets under `docs/store/chrome/` and `PRIVACY.md`; (h) write `docs/runbooks/chrome-web-store.md`. iOS/Safari App Store is a separate follow-up. This approach wins because: sideloading is not a genuine install (no auto-update, friction for non-technical users); manual store upload each release is error-prone and requires owner action per release; `chrome-webstore-upload-cli` is the de-facto CI publish tool for MV3 and requires only pinned repo secrets.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-2 | container | Owns the MV3 extension shell; its manifest, esbuild config, icon assets, and CI workflow are all changed. Icons and build wiring land here. | Review rule-api-key-isolation to confirm the release build leaves GEMINI_API_KEY unset; verify manifest permission fields are unchanged. |
| c3-210 | component | Owns manifest.json and the esbuild bundle; icon declarations and asset-copy steps are added directly to its owned files. | Check that no new permissions or CSP changes are introduced; confirm icon metadata is packaging-only. |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | The esbuild config and CI workflow must not introduce new inward dependencies from c3-2 into c3-1's domain layer. Icon assets are static files; the copy step must add no runtime import that violates the one-way dependency direction. | comply |
| ref-dependency-injection | The CI publish step and icon copy are build-time concerns; verify the build change does not wire a new runtime dependency into the composition root. | comply |
| N.A - ref-kv-storage-prefixes does not apply: this ADR adds no new storage keys or KV namespaces |  |  |
| N.A - ref-wire-protocol-validation does not apply: this ADR makes no changes to the wire protocol or message validation |  |  |
| N.A - ref-web-components-shadow-dom does not apply: this ADR makes no changes to UI web components or shadow DOM |  |  |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | The distributed Chrome Web Store build must leave GEMINI_API_KEY unset; baking the key into a published artifact would expose it to every installer. A CI guard (test -z "${GEMINI_API_KEY:-}") enforces this at release time, documenting and mechanically enforcing S1 in the release job. | comply |
| N.A - rule-sanitize-model-output does not apply: this ADR makes no changes to model output handling or sanitization paths |  |  |
| N.A - rule-gate-runtime-messages does not apply: this ADR makes no changes to runtime message gating in the service worker |  |  |
| N.A - rule-domain-purity does not apply: this ADR makes no changes to the domain layer; icon assets are packaging metadata only |  |  |
| N.A - rule-typed-errors does not apply: this ADR adds no new error-handling paths; the CI guard uses shell exit codes |  |  |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| packages/extension-chrome/src/icons/ | Generate brand-green PNGs at 16/32/48/128 px and commit them. | ls packages/extension-chrome/src/icons/ shows four PNGs |
| packages/extension-chrome/src/manifest.json | Add "icons" map and extend "action" with "default_icon" map pointing to icons/icon-{16,32,48,128}.png. No other field changes. | bun run build:chrome and jq '.icons' dist/manifest.json shows the four entries |
| packages/extension-chrome/esbuild.config.mjs | Add mkdir('dist/icons') and copyFile calls for each PNG so the build outputs dist/icons/icon-{16,32,48,128}.png. | bun run build:chrome and ls dist/icons/ |
| packages/extension-chrome/test/manifest.test.ts | Add assertions for icons and action.default_icon shape without weakening existing permission assertions. | bun test green |
| package.json (root devDependencies) | Pin chrome-webstore-upload-cli at a specific version so bun.lock records it. | jq '.devDependencies["chrome-webstore-upload-cli"]' package.json shows pinned version |
| .github/workflows/release-please.yml | Add (a) GEMINI_API_KEY guard step and (b) upload+publish step guarded by if: steps.release.outputs.release_created && env.CWS_CONFIGURED != ''. | Workflow YAML is valid; skips when secrets absent |
| docs/store/chrome/ | Screenshots (1280x800), 440x280 promo tile, listing.md with name/summary/description/justifications. | Files present under docs/store/chrome/ |
| PRIVACY.md | New file at repo root describing data handling (selected text + context to user-chosen AI provider, local-only storage, no server, no analytics). | File present; URL https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md resolves |
| docs/runbooks/chrome-web-store.md | Step-by-step owner runbook: dev account, item creation, OAuth setup (In-production consent screen), refresh token, four GitHub secrets, first publish. | File present |
| README.md | Repoint Install section to store listing once live; keep from-source dev build for contributors. | README updated |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-210 codemap (component) | Added 8 exact-path codemap entries via c3 set --append: esbuild.config.mjs, test/manifest.test.ts, e2e/store-screenshots.spec.ts, src/icons/icon-16.png, src/icons/icon-32.png, src/icons/icon-48.png, src/icons/icon-128.png, scripts/generate-brand-assets.mjs — all mapped to c3-210 (chrome-service-worker), which already owns manifest.json and the esbuild bundle | c3 lookup on each path returns c3-210 via c3-2; no new component or responsibility change |
| No new component or ref required | Existing c3-210 / c3-2 ownership covers all changed files; icon assets and build glue are packaging-only and belong to the Chrome service-worker component | c3 check --include-adr passes with 0 issues |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| .github/workflows/release-please.yml GEMINI_API_KEY guard step | test -z "${GEMINI_API_KEY:-}" fails the job if the key was accidentally baked into the release environment. | CI log shows step passes (key absent) on every release |
| .github/workflows/release-please.yml publish step if-guard | Skips the upload when CWS_CONFIGURED env var (mapped from secrets.CWS_EXTENSION_ID) is empty, so unconfigured releases still produce the GitHub artifact without failing. | CI dry-run with secrets absent shows step as skipped, not failed |
| packages/extension-chrome/test/manifest.test.ts | Asserts icons and action.default_icon shape; any removal of icon entries or permission drift fails the suite. | bun test green |
| bun run lint dep-direction gate | Pre-existing gate; confirms the esbuild copy step introduces no dependency-direction violations. | bun run lint green |
| c3 check --include-adr | Validates architecture docs stay consistent with every .c3/ mutation during implementation. | c3 check --include-adr passes |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep sideloading as the only install method | Not a genuine install path: no auto-update, shows Developer Mode warnings, requires 5-step manual setup hostile to non-technical users who are the project's target audience. |
| Manual Web Store upload each release with no CI automation | Requires owner action for every release; error-prone; defeats the release-please zero-touch release model already in place in this repo. |
| Microsoft Edge Add-ons store or Firefox AMO as the first publish target | Edge and Firefox reach a smaller audience for this first publish; CWS is the dominant desktop channel and is the one users expect for Chrome extensions. Can be added later without architectural change. |
| chrome-webstore-upload GitHub Action instead of chrome-webstore-upload-cli | Third-party Actions introduce an additional supply-chain trust boundary that this repo's current workflow avoids; chrome-webstore-upload-cli is invoked via bunx and pinned in bun.lock, consistent with the repo's existing dependency-pinning posture. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Google review latency or rejection for broad <all_urls> host permission | Tight single-purpose statement and per-permission justifications in listing.md and PRIVACY.md; first review typically takes hours to days. | Listing is live and installable; no policy violation email received. |
| OAuth refresh token expires in 7 days if consent screen is left in Testing mode | Runbook step mandates setting consent screen to In production before generating the refresh token, so the token is perpetual. | Refresh token remains valid beyond 7 days; no token-expired error in CI logs. |
| GEMINI_API_KEY accidentally baked into the published artifact | CI guard step (test -z "${GEMINI_API_KEY:-}") fails the job if the variable is set; the release job never sets it today, and we keep it that way. | bun run build:chrome in an env with GEMINI_API_KEY unset produces a bundle without the key string. |
| Publish step fails when secrets are not yet configured, breaking CI | Publish step is guarded by if: env.CWS_CONFIGURED != ''; skips gracefully and the release artifact is still attached to the GitHub Release. | CI dry-run with secrets absent shows step as skipped, not failed. |
| Re-upload of the same extension version is rejected by the Web Store API | release-please bumps manifest.json's version field on every release; each uploaded zip is strictly newer by construction. | Two successive CI runs upload different version strings without rejection. |

## Verification

| Check | Result |
| --- | --- |
| bun test | All tests pass, including new manifest.test.ts assertions for icons and action.default_icon. |
| bun run lint | Lint and dep-direction gate pass with no violations. |
| bun run build:chrome | dist/icons/icon-{16,32,48,128}.png present; dist/manifest.json contains "icons" and "action"."default_icon" maps. |
| c3 check --include-adr | No errors reported. |
| CI dry-run with secrets absent | Publish step shows as skipped; dist-chrome.zip still attached to the GitHub Release artifact. |
| CI run with secrets present after owner setup | Upload and publish step succeeds; Web Store item moves to pending review. |
