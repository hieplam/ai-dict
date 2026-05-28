---
bundle: "07"
title: ci-release
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["05", "06"]
owns_files:
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - .size-limit.json
  - scripts/release-bump.mjs
  - scripts/wire-check.mjs
  - RELEASE_CHECKLIST.md
  - renovate.json
---

# Bundle 07 — ci-release (CI pipeline + release flow)

**Purpose:** Wire the GitHub Actions CI pipeline (typecheck, lint, unit/component/contract tests, wire-schema drift, Playwright e2e-chrome, builds, size budgets, coverage gates, gitleaks, dep-audit), the tag-driven release workflow (Chrome zip on ubuntu + Safari `.ipa` via xcodebuild on macOS), the `size-limit` budgets, the version-bump script, and the release checklist. Invokes the frozen root `package.json` scripts from Bundle 01 — does not edit them.

## Lock protocol
Verify prereqs `05` AND `06` are `DONE` (CI must be able to build/test both extensions). Flip YAML → LOCKED, commit `[07] lock`, rebase, abort on race. Execute.

## Inputs
- Bundles 01–06 DONE: all packages build/test/lint/size cleanly; root scripts (`test`,`lint`,`typecheck`,`build`,`wire:check`,`size`,`release:bump`) exist; both extensions emit `dist/`; Xcode project present.
- Spec §8.6 (static analysis), §8.7 (budgets), §8.9 (CI jobs), §8.10 (release flow + RELEASE_CHECKLIST + iOS checklist).

## Outputs
- `.github/workflows/ci.yml`: jobs `install`, `typecheck`, `lint`, `test-unit`, `test-component`, `test-contract`, `wire-schema-check`, `e2e-chrome` (ubuntu, `needs:[install,lint]`, uploads traces/screenshots on failure, 7-day retention), `build-chrome`, `build-safari` (web-ext code on ubuntu; Xcode deferred), `size-check`, `coverage-gate`, `secret-scan` (gitleaks), `dep-audit` (`pnpm audit --audit-level=high`, informational PR / blocking nightly). `pnpm install --frozen-lockfile`. Branch protection note documented.
- `.github/workflows/release.yml`: `on: push tags v*`; `build-chrome` (ubuntu → `dist-chrome.zip`), `build-safari-ios` (macos-latest → xcodebuild archive iOS target → `.ipa`), `github-release` (needs both, notes from CHANGELOG, opens "Upload to stores" follow-up issue).
- `.size-limit.json`: budgets per §8.7 for chrome + safari bundles.
- `scripts/release-bump.mjs`: bumps root `package.json` version + both manifests + Xcode `MARKETING_VERSION` (iOS only). Wired as `release:bump`.
- `scripts/wire-check.mjs`: regenerate + diff `wire-schema.snapshot.json` (the `wire:check` implementation; consumes core's exporter).
- `RELEASE_CHECKLIST.md` per §8.10 (incl. permission-list match, default-template `{url}`/`{title}` audit, version=tag, gitleaks clean, wire snapshot match, manual iOS pass).
- `renovate.json` (scheduled).

## Definition of Done
- D1: `ci.yml` defines every §8.9 job with the stated `needs`/runners; YAML lints (`actionlint`/parse) clean.
- D2: All CI jobs invoke **only** the frozen root scripts (no root `package.json` edits by this bundle).
- D3: `release.yml` is tag-triggered, builds Chrome zip on ubuntu + iOS `.ipa` on macos-latest (iOS target only), creates a GitHub Release with both assets.
- D4: `.size-limit.json` budgets match §8.7 exactly; `pnpm size` passes for the real built bundles.
- D5: `pnpm wire:check` (via `scripts/wire-check.mjs`) passes against the committed snapshot.
- D6: `release:bump <semver>` updates root version + both manifests + Xcode `MARKETING_VERSION` consistently (dry-run verified).
- D7: `RELEASE_CHECKLIST.md` covers all §8.10 items; gitleaks + dep-audit jobs present.
- D8: Coverage-gate job enforces per-package thresholds (§8.2) and fails on under-coverage.

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** Author workflows + scripts; validate locally with `act`/dry-runs where possible; assert script wiring without re-implementing package scripts.

## Verify (correctness)
- Run: `pnpm wire:check` → clean.
- Run: `pnpm size` → within all §8.7 budgets (requires 05/06 `dist/`).
- Run: `pnpm release:bump 0.0.1 --dry-run` (or equivalent) → consistent version edits.
- Lint workflows (`actionlint`).

## Validate (sanity / no scope drift)
- `git diff --stat` touches only `.github/**`, `scripts/**`, `.size-limit.json`, `RELEASE_CHECKLIST.md`, `renovate.json` — **no `packages/**` and no root `package.json` edits**.
- CI references only existing frozen script names.
- Release builds iOS target only (no macOS), Chrome zip only (no store auto-upload at MVP).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D8 met with evidence?
- [ ] Root `package.json` untouched (script-name contract respected)?
- [ ] All §8.9 jobs present with correct runners/needs?
- [ ] Size budgets + coverage thresholds match spec numbers exactly?
- [ ] Release = iOS target only, Chrome zip only (MVP scope)?
- [ ] RELEASE_CHECKLIST includes permission-match + template `{url}`/`{title}` audit?
- [ ] Only owned files changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `07`. Plan complete — all bundles DONE.
