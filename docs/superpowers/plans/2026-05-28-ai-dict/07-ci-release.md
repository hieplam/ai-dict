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
> Internal order: config files first (`.size-limit.json`, `scripts/wire-check.mjs`, `scripts/release-bump.mjs`) so the workflows have something to call → `ci.yml` → `release.yml` → `renovate.json` → `RELEASE_CHECKLIST.md` → local validation. This bundle **only** wires `.github/**`, `scripts/**`, and the four leaf config/doc files; it invokes the frozen root scripts (`typecheck`, `lint`, `test`, `build`, `wire:check`, `size`, `release:bump`) and per-package `test`/`build` via `pnpm --filter`. It does **not** edit root `package.json` or anything under `packages/**`.
>
> **Frozen script names (Bundle 01, do not re-implement):** `typecheck`=`pnpm -r --if-present typecheck`, `test`=`vitest run`, `lint`=`eslint .`, `build`=`pnpm -r --if-present build`, `wire:check`=`node scripts/wire-check.mjs`, `size`=`size-limit`, `release:bump`=`node scripts/release-bump.mjs`.
>
> **⚠ Upstream prerequisite (surface before executing).** The frozen `size` script is the bare binary `size-limit`, and `wire:check`/`release:bump` are plain `node` (no `tsx`). Bundle 07 owns no `package.json`, so it **cannot** add tool dependencies. Two facts must already hold (both are Bundle 01's root-toolchain responsibility, since Bundle 01 owns the script *names* + root devDeps):
> 1. Root devDependencies include **`size-limit`** and **`@size-limit/file`** (so `pnpm size` resolves). *Wired in Bundle 01 Step 5's install list — alongside `eslint`/`vitest`/`prettier` for the other frozen scripts. If executing 07 before that landed, stop and request the amendment rather than editing root `package.json` here.*
> 2. `wire-check.mjs` needs **no** new dependency: core ships **`.ts` source with no build step** (Bundle 02 `exports: { ".": "./src/index.ts" }`), and Node 20 cannot import `.ts`, so we cannot `import` core's compiled `wireJsonSchema()`. Instead `wire:check` re-runs core's own snapshot test (which regenerates `wireJsonSchema()` and diffs the committed snapshot) — zero new deps, build-free.
>
> If fact (1) is not yet true when 07 is executed, **stop and request the one-line Bundle 01 amendment** rather than editing root `package.json` from here (that would breach D2 / the no-root-edit contract).

### Step 1 — `.size-limit.json` (budgets per §8.7, gzipped)

`size-limit` gzips by default and auto-detects `.size-limit.json` at repo root. Budgets are **exactly** §8.7. Safari has no `side-panel.js` (inline bottom sheet only — Bundle 06).

```json
[
  { "name": "chrome content.js",    "path": "packages/extension-chrome/dist/content.js",    "limit": "45 KB" },
  { "name": "chrome sw.js",         "path": "packages/extension-chrome/dist/sw.js",         "limit": "30 KB" },
  { "name": "chrome options.js",    "path": "packages/extension-chrome/dist/options.js",    "limit": "40 KB" },
  { "name": "chrome side-panel.js", "path": "packages/extension-chrome/dist/side-panel.js", "limit": "40 KB" },
  { "name": "safari content.js",    "path": "packages/extension-safari/dist/content.js",    "limit": "45 KB" },
  { "name": "safari sw.js",         "path": "packages/extension-safari/dist/sw.js",          "limit": "30 KB" },
  { "name": "safari options.js",    "path": "packages/extension-safari/dist/options.js",     "limit": "40 KB" }
]
```

> `pnpm size` requires both `dist/` trees to exist → the CI `size-check` job builds both extensions first (Step 4). `45 KB` is parsed by `bytes` as 45 000 bytes (size-limit convention); this matches the spec's "45KB gz" budget intent.

### Step 2 — `scripts/wire-check.mjs` (the `wire:check` implementation, build-free)

Re-runs core's committed snapshot test. The core test (`Bundle 02 Task G1`) does `expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot('../wire-schema.snapshot.json')` — it **regenerates the schema from the exporter and fails on any drift** (and never auto-updates unless `-u`). Forcing `CI=true` guarantees no silent update.

```js
#!/usr/bin/env node
// wire:check — drift gate for packages/core/wire-schema.snapshot.json (spec §8.5).
//
// Core ships TS source with no build step (Bundle 02: exports "./src/index.ts"),
// Node 20 cannot import .ts, and this repo forbids root package.json edits — so we
// cannot import core's compiled wireJsonSchema() from plain node. Instead we re-run
// core's own snapshot test, which regenerates wireJsonSchema() and diffs it against
// the committed snapshot (failing on drift). Zero new deps, no build required.
import { spawnSync } from 'node:child_process';

const res = spawnSync(
  'pnpm',
  ['--filter', '@ai-dict/core', 'test', 'wire-schema'],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } }, // CI=true => vitest never writes snapshots
);

if (res.status !== 0) {
  console.error('\nwire:check FAILED — wire-schema.snapshot.json is out of date or invalid.');
  console.error('If the schema changed intentionally: pnpm --filter @ai-dict/core test wire-schema -u, then commit.');
  process.exit(res.status ?? 1);
}
console.log('wire:check OK — wire schema matches the committed snapshot.');
```

> The positional `wire-schema` filters vitest to `test/wire-schema.test.ts` only. `pnpm` must be on `PATH` (true in CI and local dev).

### Step 3 — `scripts/release-bump.mjs` (version fan-out, dry-run-able)

Updates **root `package.json` `version`** + **both manifests** + **Xcode `MARKETING_VERSION`** (iOS target only — Bundle 06 generates no macOS target). Pure `node` (no deps): JSON round-trip for manifests/package.json, regex for `.pbxproj`. `--dry-run` prints planned edits and writes nothing.

> Editing root `package.json` *at release time* is this script's job (D6 / §8.10) and is **not** a Bundle-07 source edit — Bundle 07's own commit diff never touches `package.json`.

```js
#!/usr/bin/env node
// release:bump <major.minor.patch> [--dry-run]
// Single source of truth = root package.json version; fans out to both manifests
// and the iOS Xcode MARKETING_VERSION (no macOS target exists — Bundle 06 §5.5).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: pnpm release:bump <major.minor.patch> [--dry-run]');
  process.exit(1);
}

/** @type {{ file: string, from: string, next: string }[]} */
const edits = [];

// 1) root package.json (spread preserves key order; version stays in place)
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
edits.push({ file: pkgPath, from: pkg.version, next: JSON.stringify({ ...pkg, version }, null, 2) + '\n' });

// 2) both extension manifests
for (const rel of [
  'packages/extension-chrome/src/manifest.json',
  'packages/extension-safari/src/manifest.json',
]) {
  const p = resolve(root, rel);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  edits.push({ file: p, from: j.version, next: JSON.stringify({ ...j, version }, null, 2) + '\n' });
}

// 3) Xcode MARKETING_VERSION (iOS target only)
const pbx = findFirst(resolve(root, 'packages/extension-safari/xcode'), /\.pbxproj$/);
if (pbx) {
  const text = readFileSync(pbx, 'utf8');
  const from = (text.match(/MARKETING_VERSION = ([^;]+);/) ?? [, '(none)'])[1];
  const next = text.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  edits.push({ file: pbx, from, next });
} else {
  console.warn('warning: no .pbxproj under packages/extension-safari/xcode — skipping MARKETING_VERSION');
}

for (const e of edits) {
  console.log(`${dryRun ? '[dry-run] ' : ''}${e.from} -> ${version}   ${e.file}`);
  if (!dryRun) writeFileSync(e.file, e.next);
}
console.log(dryRun ? '\ndry-run: no files written.' : `\nbumped all targets to ${version}.`);

function findFirst(dir, re) {
  let hit = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!hit && re.test(name)) hit = full;
    }
  };
  try { walk(dir); } catch { /* xcode/ may not exist in early bundles */ }
  return hit;
}
```

> `findFirst` uses `readdirSync` (not `fs.globSync`, which is Node ≥ 22 — we pin `<21`). Manifest/package.json indentation stays 2-space (matches Bundles 01/05/06). `MARKETING_VERSION = X.Y.Z;` is unquoted in `.pbxproj` — the regex keeps it unquoted.

### Step 4 — `.github/workflows/ci.yml` (§8.9 jobs)

Each job repeats the same four-step **preamble** (shown fully in `install`; abbreviated as `# ── preamble ──` afterwards — copy the four steps verbatim). `pnpm/action-setup@v4` reads the pinned `packageManager` from root `package.json`; `setup-node` keys the pnpm-store cache off the lockfile so downstream `pnpm install --frozen-lockfile` is fast.

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 3 * * *' # nightly: dep-audit + gitleaks become blocking

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile

  typecheck:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      # ── job ──
      - run: pnpm typecheck

  lint:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm lint

  test-unit:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/core --filter @ai-dict/adapters-shared test

  test-component:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/shared-ui test # happy-dom + axe-core component tests

  test-contract:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/core test wire-schema # wire validation/contract tests

  wire-schema-check:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm wire:check

  shared-drift: # Bundle 06 promise: guard the deliberately-duplicated platform-agnostic files
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: router/inbound/dom-selection must stay byte-identical across extensions
        run: |
          set -e
          for f in src/router.ts src/inbound.ts src/adapters/dom-selection-source.ts; do
            diff -u "packages/extension-chrome/$f" "packages/extension-safari/$f" \
              || { echo "::error file=packages/extension-safari/$f::drifted from extension-chrome — re-sync, or hoist to a shared package if a 3rd consumer appeared"; exit 1; }
          done

  build-chrome:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/extension-chrome build

  build-safari:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/extension-safari build # web-ext dist only; Xcode archive deferred to release.yml (macOS)

  e2e-chrome:
    needs: [install, lint]
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/extension-chrome build
      - run: pnpm --filter @ai-dict/extension-chrome exec playwright install --with-deps chromium
      - run: pnpm --filter @ai-dict/extension-chrome exec playwright test
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: | # match the output dirs set in Bundle 05's playwright.config.ts
            packages/extension-chrome/test-results/**
            packages/extension-chrome/playwright-report/**
          retention-days: 7

  size-check:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - run: pnpm --filter @ai-dict/extension-chrome build
      - run: pnpm --filter @ai-dict/extension-safari build
      - run: pnpm size

  coverage-gate:
    needs: install
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      # Per-package thresholds (§8.2: core 90, adapters-shared 90, shared-ui 75,
      # extension-chrome 80, extension-safari 90) live in each package's
      # vitest.config.ts. Coverage is run PER PACKAGE (-r) so each package's own
      # thresholds apply — a single root projects-mode `vitest run --coverage`
      # would merge into one global report and miss per-package gates (D8).
      - run: pnpm -r --if-present test -- --coverage

  secret-scan: # gitleaks on PR + nightly (§8.6)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history for the nightly scan
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  dep-audit:
    runs-on: ubuntu-latest
    steps:
      # ── preamble ──
      - name: pnpm audit (informational on PR, blocking nightly)
        run: pnpm audit --audit-level=high
        continue-on-error: ${{ github.event_name != 'schedule' }}
```

> **Branch protection (documented, not code).** Mark these required on `main`: `typecheck`, `lint`, `test-unit`, `test-component`, `test-contract`, `wire-schema-check`, `shared-drift`, `build-chrome`, `build-safari`, `e2e-chrome`, `size-check`, `coverage-gate`, `secret-scan`. `dep-audit` is **not** required (informational on PRs). Record this in repo Settings → Branches.
>
> **D2 reading.** `pnpm --filter <pkg> test|build` invokes each package's own frozen `test`/`build` (all `vitest run` / `node esbuild.config.mjs`); `pnpm test -- --coverage` is the frozen root `test` plus a CLI flag. No new root script is introduced and root `package.json` is not edited — this honours the script-name contract while giving §8.9 its granular jobs.

### Step 5 — `.github/workflows/release.yml` (tag-driven, §8.10)

```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write # create the GitHub Release + open the follow-up issue

jobs:
  build-chrome:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @ai-dict/extension-chrome build
      - name: zip unpacked dist -> dist-chrome.zip
        run: cd packages/extension-chrome/dist && zip -r "$GITHUB_WORKSPACE/dist-chrome.zip" .
      - uses: actions/upload-artifact@v4
        with: { name: dist-chrome, path: dist-chrome.zip, retention-days: 7 }

  build-safari-ios:
    runs-on: macos-latest # required for Xcode
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @ai-dict/extension-safari build
      - run: pnpm --filter @ai-dict/extension-safari xcode:sync # copies dist/ into Xcode Resources (Bundle 06 A1)
      # VERIFY AT EXECUTION: project path, scheme name, and ExportOptions.plist are
      # produced by Bundle 06's safari-web-extension-converter output — confirm the
      # exact names in the committed xcode/ tree before relying on these.
      - name: archive iOS target (iOS app target only — no macOS)
        run: |
          xcodebuild \
            -project "$(ls packages/extension-safari/xcode/*.xcodeproj -d | head -1)" \
            -scheme "AI Dictionary" \
            -configuration Release \
            -destination 'generic/platform=iOS' \
            -archivePath "$RUNNER_TEMP/AIDict.xcarchive" \
            archive
      - name: export .ipa
        # NOTE (surfaced): a *store-signed* .ipa needs an Apple distribution cert +
        # provisioning profile supplied via repo secrets. Those are NOT in MVP scope,
        # so store upload stays manual (§8.10). At MVP this step exports with the
        # ExportOptions.plist committed by Bundle 06; if signing creds are absent the
        # archive (.xcarchive) is still uploaded as the asset and signing happens in
        # the manual Transporter step.
        run: |
          xcodebuild -exportArchive \
            -archivePath "$RUNNER_TEMP/AIDict.xcarchive" \
            -exportPath "$RUNNER_TEMP/export" \
            -exportOptionsPlist packages/extension-safari/xcode/ExportOptions.plist
      - uses: actions/upload-artifact@v4
        with:
          name: dist-safari-ios
          path: |
            ${{ runner.temp }}/export/*.ipa
            ${{ runner.temp }}/AIDict.xcarchive
          retention-days: 7

  github-release:
    needs: [build-chrome, build-safari-ios]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - name: create GitHub Release with both assets
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          generate_release_notes: true # notes from CHANGELOG/commits
          files: |
            artifacts/dist-chrome/dist-chrome.zip
            artifacts/dist-safari-ios/*.ipa
            artifacts/dist-safari-ios/*.xcarchive
      - name: open "Upload to stores" follow-up issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "Upload ${{ github.ref_name }} to stores" \
            --body $'Manual MVP store submission for **${{ github.ref_name }}**:\n\n- [ ] Chrome Web Store: drag-drop `dist-chrome.zip`.\n- [ ] App Store Connect: upload the signed `.ipa` via Transporter/Xcode Organizer.\n\nAssets: see the GitHub Release for this tag.'
```

> Release builds **iOS target only** (no macOS) and a **Chrome zip only** (no store auto-upload at MVP) — matches §8.10 and the bundle's Validate gate.

### Step 6 — `renovate.json`

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":dependencyDashboard", "schedule:weekly"],
  "lockFileMaintenance": { "enabled": true, "schedule": ["before 5am on monday"] },
  "packageRules": [
    {
      "matchManagers": ["npm"],
      "matchUpdateTypes": ["minor", "patch"],
      "groupName": "non-major npm deps"
    },
    {
      "matchManagers": ["github-actions"],
      "groupName": "github-actions"
    }
  ]
}
```

### Step 7 — `RELEASE_CHECKLIST.md` (§8.10 + §8.6)

```markdown
# Release checklist

Run on the tagged commit (`vX.Y.Z` on `main`) before publishing.

## Pre-tag
- [ ] All CI green on the commit to be tagged.
- [ ] `wire-schema.snapshot.json` matches generated (`pnpm wire:check` clean).
- [ ] Bundle sizes within budget (`pnpm size`).
- [ ] `gitleaks` clean (no secrets in history).
- [ ] `release:bump X.Y.Z` ran: root `package.json` version + both manifests + Xcode `MARKETING_VERSION` all equal the tag.
- [ ] Manifest permissions match §7.3 S8 exactly — **chrome**: `permissions:["storage","sidePanel"]`, `host_permissions:["<all_urls>","https://generativelanguage.googleapis.com/*"]`; **safari**: `permissions:["storage"]` (no `sidePanel`), same `host_permissions`; **both**: no `scripting`, no `externally_connectable`.
- [ ] Default prompt template reviewed — no inadvertent `{url}` / `{title}` placeholders (data minimization, §7.2 / Appendix A).
- [ ] CHANGELOG entry written for this version.
- [ ] Privacy disclosures updated if data flows changed.

## Manual passes
- [ ] iOS Simulator end-to-end pass complete (`packages/extension-safari/e2e/ios-simulator-checklist.md`, all 12 steps).
- [ ] Chrome smoke: clean profile, set key, look up a word on Wikipedia, verify card + history + cache hit on repeat.

## Publish
- [ ] Tag pushed; `release.yml` produced `dist-chrome.zip` + iOS `.ipa`/`.xcarchive`.
- [ ] GitHub Release created with both assets + notes.
- [ ] Store-listing screenshots + copy current.

## Store submission (manual at MVP)
- [ ] Chrome Web Store: drag-drop `dist-chrome.zip`.
- [ ] App Store Connect: upload signed `.ipa` via Transporter; enters App Review.
- [ ] Close the auto-opened "Upload to stores" issue when done.
```

### Step 8 — Local validation (do before sign-off)

```bash
# 1. Workflows parse + lint (install actionlint locally; it is not a repo dep)
actionlint .github/workflows/ci.yml .github/workflows/release.yml

# 2. Version fan-out is consistent and side-effect-free in dry-run
pnpm release:bump 0.0.1 --dry-run        # prints: root + 2 manifests + MARKETING_VERSION -> 0.0.1
git status --porcelain                    # MUST be empty (dry-run wrote nothing)

# 3. Wire snapshot has not drifted (requires Bundles 02 present)
pnpm wire:check                           # OK

# 4. Size budgets pass against real built bundles (requires 05/06 dist/ + size-limit dep)
pnpm --filter @ai-dict/extension-chrome build
pnpm --filter @ai-dict/extension-safari build
pnpm size                                 # all 7 entries within §8.7

# 5. Drift guard locally
for f in src/router.ts src/inbound.ts src/adapters/dom-selection-source.ts; do
  diff -u "packages/extension-chrome/$f" "packages/extension-safari/$f"; done
```

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
