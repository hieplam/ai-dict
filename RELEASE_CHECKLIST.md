# Release checklist

Run on the tagged commit (`vX.Y.Z` on `main`) before publishing.

## Pre-tag

- [ ] All CI green on the commit to be tagged.
- [ ] Wire-schema contract tests pass (`bun run --filter @ai-dict/app test wire-schema` green).
- [ ] `bun audit --audit-level=high` clean (no high/critical advisories).
- [ ] `gitleaks` clean (no secrets in history).
- [ ] `release:bump X.Y.Z` ran: root `package.json` version + both manifests + Xcode `MARKETING_VERSION` all equal the tag.
- [ ] Manifest permissions match §7.3 S8 exactly — **chrome**: `permissions:["storage","sidePanel"]`, `host_permissions:["<all_urls>","https://generativelanguage.googleapis.com/*"]`; **safari**: `permissions:["storage"]` (no `sidePanel`), same `host_permissions`; **both**: no `scripting`, no `externally_connectable`.
- [ ] Default prompt template reviewed — no inadvertent `{url}` / `{title}` placeholders (data minimization, §7.2 / Appendix A).
- [ ] CHANGELOG entry written for this version.
- [ ] Privacy disclosures updated if data flows changed.
- [ ] Xcode project current: `bun run --filter @ai-dict/extension-safari xcode:sync` run and committed `xcode/` tree reflects latest `dist/` (release.yml `build-safari-ios` depends on this).

## Manual passes

- [ ] iOS Simulator end-to-end pass complete (`packages/extension-safari/e2e/ios-simulator-checklist.md`, all 12 steps).
- [ ] Chrome smoke: clean profile, set key, look up a word on Wikipedia, verify card + history + cache hit on repeat.
  - **Note:** Chrome lookup e2e runs automatically in CI (`e2e-chrome` job) under `PLAYWRIGHT_RUN_LOOKUP_E2E=1` via `xvfb-run -a`; no manual step needed — verify the CI job is green before tagging. If the job fails, check that env var and the virtual display setup in `.github/workflows/ci.yml` (`e2e-chrome` job).

## Publish

- [ ] Tag pushed; `release.yml` produced `dist-chrome.zip` + iOS `.ipa`/`.xcarchive`.
- [ ] GitHub Release created with both assets + notes.
- [ ] Store-listing screenshots + copy current.

## Store submission (manual at MVP)

- [ ] Chrome Web Store: drag-drop `dist-chrome.zip`.
- [ ] App Store Connect: upload signed `.ipa` via Transporter; enters App Review.
- [ ] Close the auto-opened "Upload to stores" issue when done.
