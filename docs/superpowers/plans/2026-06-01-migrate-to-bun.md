# Migrate Toolchain from pnpm to bun — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pnpm with bun as the package manager and script runner across the repo, while keeping esbuild (bundler), vitest (tests), eslint, prettier, playwright, knip, and size-limit — each now invoked through bun.

**Architecture:** This is a package-manager + runtime migration only. Tool *behavior* is unchanged; only the launcher changes (pnpm → bun). Workspaces move from `pnpm-workspace.yaml` into `package.json`'s `workspaces` field; the lockfile becomes `bun.lock`; CI swaps `pnpm/action-setup`+`setup-node` for `oven-sh/setup-bun`. Because bundle output and test assertions are untouched, the work is verification-driven: each task ends by running the real command and confirming it stays green.

**Tech Stack:** bun 1.3.14, esbuild, vitest, eslint, prettier, playwright, knip, size-limit, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-01-pnpm-to-bun-migration-design.md`

**Branch:** `migrate-to-bun` (already created).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `workspaces`; drop `packageManager` + `engines`; rewrite scripts to bun. |
| `pnpm-workspace.yaml` | Delete | Workspaces moved into `package.json`. |
| `pnpm-lock.yaml` | Delete | Replaced by `bun.lock`. |
| `.npmrc` | Delete | pnpm-specific settings. |
| `.nvmrc` | Delete | Node no longer the declared runtime. |
| `bun.lock` | Create (generated) | Reproducible install lockfile (committed). |
| `.bun-version` | Create | Pin bun to `1.3.14` for local + CI parity. |
| `packages/extension-chrome/package.json` | Modify | `build` script: `node` → `bun`. |
| `packages/extension-safari/package.json` | Modify | `build` script: `node` → `bun`. |
| `scripts/wire-check.mjs` | Modify | Spawn `bun` instead of `pnpm`; update hint text. |
| `scripts/release-bump.mjs` | Modify | Usage string `pnpm` → `bun run`. |
| `.github/workflows/ci.yml` | Modify | setup-bun + bun command translations + bun cache. |
| `.github/workflows/release.yml` | Modify | setup-bun + bun command translations. |
| `RELEASE_CHECKLIST.md` | Modify | `pnpm` commands → bun. |

Untouched by design: `vitest.config.ts`, `packages/*/vitest.config.ts`, `.size-limit.json`, `knip.json`, `eslint.config.mjs`, `esbuild.config.mjs` (both), `renovate.json`, historical plan docs.

---

## Task 1: Capture the green baseline

**Files:** none (read-only reference capture).

- [ ] **Step 1: Confirm bun is the expected version**

Run: `bun --version`
Expected: `1.3.14`. If different, update `.bun-version` content in Task 2 to match the installed version.

- [ ] **Step 2: Record the current pnpm-based green state + bundle sizes**

Run:
```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build && pnpm size > /tmp/baseline-size.txt 2>&1
cat /tmp/baseline-size.txt
```
Expected: all exit 0; `/tmp/baseline-size.txt` lists each bundle within budget. Keep this file — Task 6 compares against it.

- [ ] **Step 3: No commit** (read-only task).

---

## Task 2: Convert `package.json` and remove pnpm config files

**Files:**
- Modify: `package.json`
- Delete: `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`
- Create: `.bun-version`

- [ ] **Step 1: Replace root `package.json` with the bun version**

Write `package.json`:
```json
{
  "name": "ai-dict",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "build": "bun run --filter '@ai-dict/extension-*' build",
    "wire:check": "bun scripts/wire-check.mjs",
    "size": "size-limit",
    "release:bump": "bun scripts/release-bump.mjs"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@size-limit/file": "^12.1.0",
    "@types/node": "^20.19.41",
    "@vitest/coverage-v8": "^4.1.7",
    "eslint": "^10.4.1",
    "eslint-config-prettier": "^10.1.8",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import-x": "^4.16.2",
    "prettier": "^3.8.3",
    "size-limit": "^12.1.0",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.60.0",
    "vitest": "^4.1.7"
  }
}
```
(`packageManager` and `engines` removed; `workspaces` added; `typecheck`/`build`/`wire:check`/`release:bump` rewritten. `@types/node` is retained — `@ai-dict/core` and the `.mjs` scripts use Node type/API surface.)

- [ ] **Step 2: Create `.bun-version`**

Write `.bun-version`:
```
1.3.14
```

- [ ] **Step 3: Delete the pnpm config files**

Run:
```bash
git rm pnpm-workspace.yaml .npmrc .nvmrc
```
Expected: three files staged for deletion.

- [ ] **Step 4: Do NOT commit yet** — `package.json` references won't resolve until `bun install` runs (Task 3). Commit at the end of Task 3.

---

## Task 3: Generate `bun.lock` and install

**Files:**
- Delete: `pnpm-lock.yaml`
- Create: `bun.lock` (generated)

- [ ] **Step 1: Remove pnpm's lockfile and the pnpm-linked node_modules**

Run:
```bash
git rm pnpm-lock.yaml
rm -rf node_modules packages/*/node_modules
```

- [ ] **Step 2: Install with bun (generates `bun.lock` + flat node_modules)**

Run: `bun install`
Expected: exits 0; `bun.lock` created at repo root; `node_modules/` repopulated; workspace packages (`@ai-dict/*`) linked.

- [ ] **Step 3: Confirm workspace linking works**

Run: `bun pm ls 2>/dev/null | head -30 || ls node_modules/@ai-dict`
Expected: the five `@ai-dict/*` packages are present/symlinked.

- [ ] **Step 4: Commit the package-manager swap**

```bash
git add package.json .bun-version bun.lock
git commit -m "build(bun): switch package manager pnpm→bun (workspaces, lockfile, scripts)"
```

---

## Task 4 [PRIMARY GATE]: Verify vitest runs green under bun

**Files:** none (verification).

This is the highest-risk step. vitest is node-oriented; confirm the full suite and every per-package coverage gate pass before touching CI.

- [ ] **Step 1: Run the full suite via bun**

Run: `bun run test`
Expected: PASS — same test count and result as the Task 1 baseline.

- [ ] **Step 2: Run the per-package coverage gates via bun**

Run: `bun run --filter '*' test -- --coverage`
Expected: PASS for every package, each meeting its threshold (core 90, adapters-shared 90, shared-ui 75, extension-chrome 80, extension-safari 90).

- [ ] **Step 3: Decision checkpoint**

If Steps 1–2 are green → proceed.
If vitest misbehaves under bun (vite/worker-thread errors, missing globals): STOP and report. Contingency = keep node available and run the `test` step via node (`node_modules/.bin/vitest run`) while bun handles everything else; document the exception in the spec's "Risks" section. Do not silently work around a red suite.

- [ ] **Step 4: No commit** (verification only).

---

## Task 5: Verify filter semantics + arg forwarding

**Files:** none (verification).

- [ ] **Step 1: Verify `--filter '*'` tolerates packages without the script**

Run: `bun run --filter '*' typecheck`
Expected: PASS across all 5 packages (all define `typecheck`). Confirm bun does not error on the filter glob itself.

- [ ] **Step 2: Verify trailing-arg forwarding (single positional arg)**

Run: `bun run --filter @ai-dict/core test wire-schema`
Expected: runs only the wire-schema test in core and PASSES. If bun does NOT forward `wire-schema` to vitest (e.g. it tries to run a `wire-schema` script), retry with a `--` separator: `bun run --filter @ai-dict/core test -- wire-schema`. Record which form works — it feeds Tasks 7 and 10.

- [ ] **Step 3: Verify trailing-flag forwarding**

Run: `bun run --filter @ai-dict/core test -- --coverage`
Expected: core's tests run with coverage. Record the working form for Task 10's coverage-gate job.

- [ ] **Step 4: No commit** (verification only).

---

## Task 6: Switch extension build scripts to bun and verify bundles

**Files:**
- Modify: `packages/extension-chrome/package.json`
- Modify: `packages/extension-safari/package.json`

- [ ] **Step 1: Update the chrome build script**

In `packages/extension-chrome/package.json`, change:
```json
    "build": "node esbuild.config.mjs",
```
to:
```json
    "build": "bun esbuild.config.mjs",
```

- [ ] **Step 2: Update the safari build script**

In `packages/extension-safari/package.json`, change:
```json
    "build": "node esbuild.config.mjs",
```
to:
```json
    "build": "bun esbuild.config.mjs",
```

- [ ] **Step 3: Build both extensions via bun**

Run: `bun run build`
Expected: exits 0; `packages/extension-chrome/dist/` and `packages/extension-safari/dist/` populated (sw.js, content.js, options.js, side-panel.js [chrome], manifests, html).

- [ ] **Step 4: Confirm bundles stay within budget**

Run: `bun run size`
Expected: every entry within its `.size-limit.json` limit. Compare against `/tmp/baseline-size.txt` from Task 1 — sizes should be effectively identical (esbuild unchanged). If any bundle now exceeds budget, STOP and report (esbuild-under-bun produced different output than expected).

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/package.json packages/extension-safari/package.json
git commit -m "build(bun): run esbuild via bun in extension build scripts"
```

---

## Task 7: Convert the `scripts/` helpers

**Files:**
- Modify: `scripts/wire-check.mjs`
- Modify: `scripts/release-bump.mjs`

- [ ] **Step 1: Point `wire-check.mjs` at bun**

In `scripts/wire-check.mjs`, change the spawn target and args:
```js
const res = spawnSync(
  'pnpm',
  ['--filter', '@ai-dict/core', 'test', 'wire-schema'],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } }, // CI=true => vitest never writes snapshots
);
```
to (use the arg form confirmed working in Task 5, Step 2 — shown here without `--`; add `'--'` before `'wire-schema'` if Task 5 required it):
```js
const res = spawnSync(
  'bun',
  ['run', '--filter', '@ai-dict/core', 'test', 'wire-schema'],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } }, // CI=true => vitest never writes snapshots
);
```

- [ ] **Step 2: Update the failure-hint text in `wire-check.mjs`**

Change:
```js
  console.error('If the schema changed intentionally: pnpm --filter @ai-dict/core test wire-schema -u, then commit.');
```
to:
```js
  console.error('If the schema changed intentionally: bun run --filter @ai-dict/core test wire-schema -u, then commit.');
```

- [ ] **Step 3: Update the usage string in `release-bump.mjs`**

In `scripts/release-bump.mjs`, change:
```js
  console.error('usage: pnpm release:bump <major.minor.patch> [--dry-run]');
```
to:
```js
  console.error('usage: bun run release:bump <major.minor.patch> [--dry-run]');
```

- [ ] **Step 4: Verify wire:check**

Run: `bun run wire:check`
Expected: `wire:check OK — wire schema matches the committed snapshot.` and exit 0.

- [ ] **Step 5: Verify release:bump dry-run is safe**

Run: `bun run release:bump 0.0.0 --dry-run`
Expected: prints intended edits, writes nothing, exits 0. Confirm `git status` shows no file changes from this command.

- [ ] **Step 6: Commit**

```bash
git add scripts/wire-check.mjs scripts/release-bump.mjs
git commit -m "build(bun): run wire-check + release-bump via bun"
```

---

## Task 8: Verify lint, format, and e2e under bun

**Files:** none (verification).

- [ ] **Step 1: Lint**

Run: `bun run lint`
Expected: exit 0, no violations (matches baseline).

- [ ] **Step 2: Format check**

Run: `bun run format:check`
Expected: exit 0 (all files formatted).

- [ ] **Step 3: knip dead-code gate via bunx**

Run: `bunx knip`
Expected: exit 0, no unused exports/deps reported (matches current CI behavior).

- [ ] **Step 4: Playwright e2e via bunx (local smoke)**

Run:
```bash
cd packages/extension-chrome
bunx playwright install --with-deps chromium
PLAYWRIGHT_RUN_LOOKUP_E2E=1 bunx playwright test
cd ../..
```
Expected: e2e suite passes. If the local environment cannot run headed/xvfb Chromium, note it and rely on the CI job (Task 10) — but do not mark this step done without either a local pass or an explicit CI-deferral note.

- [ ] **Step 5: No commit** (verification only).

---

## Task 9: Verify `bun audit`

**Files:** none (verification).

- [ ] **Step 1: Confirm the audit command + flag exist**

Run: `bun audit --audit-level=high`
Expected: runs an advisory scan and exits 0 (no high/critical advisories), matching the current `pnpm audit` behavior.

- [ ] **Step 2: Handle absent flag (contingency)**

If `bun audit` rejects `--audit-level` or the subcommand is unavailable in 1.3.14:
- Try `bun audit` (no flag) and confirm it reports severities.
- Record the working invocation; Task 10's `dep-audit` job uses it. If no severity gating exists, keep `bun audit` as informational (the existing job is already non-blocking on PRs via `continue-on-error`).

- [ ] **Step 3: No commit** (verification only).

---

## Task 10: Rewrite `.github/workflows/ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml`

The current file has many jobs that share an identical setup block. Apply the **setup-block replacement** to every job that currently uses pnpm, then translate each `run:` line per the **command table**. Leave the `secret-scan` and `shared-drift` jobs' `run:`/steps unchanged (they use gitleaks / `diff` only and need no toolchain setup).

- [ ] **Step 1: Replace the setup block in every pnpm-using job**

Remove this recurring pair of steps:
```yaml
      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
```
(and the single-line `with: { node-version-file: .nvmrc, cache: pnpm }` variant)

with:
```yaml
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
          restore-keys: bun-${{ runner.os }}-
```

- [ ] **Step 2: Translate every `run:` command**

Apply these exact replacements (left = current, right = new). Use the arg form confirmed in Task 5 for the two forwarding cases:

| Current `run:` | New `run:` |
|---|---|
| `pnpm install --frozen-lockfile` | `bun install --frozen-lockfile` |
| `pnpm typecheck` | `bun run typecheck` |
| `pnpm lint` | `bun run lint` |
| `pnpm --filter @ai-dict/core --filter @ai-dict/adapters-shared test` | `bun run --filter @ai-dict/core --filter @ai-dict/adapters-shared test` |
| `pnpm --filter @ai-dict/shared-ui test` | `bun run --filter @ai-dict/shared-ui test` |
| `pnpm --filter @ai-dict/core test wire-schema` | `bun run --filter @ai-dict/core test wire-schema` *(add `--` before `wire-schema` iff Task 5 required it)* |
| `pnpm wire:check` | `bun run wire:check` |
| `pnpm --filter @ai-dict/extension-chrome build` | `bun run --filter @ai-dict/extension-chrome build` |
| `pnpm --filter @ai-dict/extension-safari build` | `bun run --filter @ai-dict/extension-safari build` |
| `pnpm size` | `bun run size` |
| `pnpm -r --if-present test -- --coverage` | `bun run --filter '*' test -- --coverage` |
| `pnpm dlx knip` | `bunx knip` |
| `pnpm audit --audit-level=high` | `bun audit --audit-level=high` *(or the form confirmed in Task 9)* |

- [ ] **Step 3: Translate the two `pnpm … exec playwright …` lines in `e2e-chrome`**

Replace:
```yaml
      - run: pnpm --filter @ai-dict/extension-chrome build
      - run: pnpm --filter @ai-dict/extension-chrome exec playwright install --with-deps chromium
      - run: xvfb-run -a pnpm --filter @ai-dict/extension-chrome exec playwright test
```
with:
```yaml
      - run: bun run --filter @ai-dict/extension-chrome build
      - run: cd packages/extension-chrome && bunx playwright install --with-deps chromium
      - run: cd packages/extension-chrome && xvfb-run -a bunx playwright test
```

- [ ] **Step 4: Validate the workflow file syntax**

Run: `bunx --bun @action-validator/cli .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok` (or action-validator clean). Also re-read the file and confirm no `pnpm`, `pnpm/action-setup`, `setup-node`, or `.nvmrc` references remain except where intentionally none.

- [ ] **Step 5: Confirm no stray pnpm references**

Run: `grep -n "pnpm\|action-setup\|setup-node\|\.nvmrc" .github/workflows/ci.yml || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(bun): run CI on bun (setup-bun, bun install/run, bun cache)"
```

---

## Task 11: Rewrite `.github/workflows/release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Apply the same setup-block replacement** (from Task 10, Step 1) to `build-chrome` and `build-safari-ios`. The `github-release` job has no toolchain setup — leave its steps unchanged.

- [ ] **Step 2: Translate the `run:` commands**

| Current `run:` | New `run:` |
|---|---|
| `pnpm install --frozen-lockfile` | `bun install --frozen-lockfile` |
| `pnpm --filter @ai-dict/extension-chrome build` | `bun run --filter @ai-dict/extension-chrome build` |
| `pnpm --filter @ai-dict/extension-safari build` | `bun run --filter @ai-dict/extension-safari build` |
| `pnpm --filter @ai-dict/extension-safari xcode:sync` | `bun run --filter @ai-dict/extension-safari xcode:sync` |

The `xcodebuild`, `zip`, `gh issue create`, and upload-artifact steps are unchanged.

- [ ] **Step 3: Confirm no stray pnpm references**

Run: `grep -n "pnpm\|action-setup\|setup-node\|\.nvmrc" .github/workflows/release.yml || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(bun): run release workflow on bun"
```

---

## Task 12: Update operational docs

**Files:**
- Modify: `RELEASE_CHECKLIST.md`

- [ ] **Step 1: Translate the pnpm commands in `RELEASE_CHECKLIST.md`**

Apply these replacements:
```
`pnpm wire:check`  → `bun run wire:check`
`pnpm size`        → `bun run size`
`pnpm audit --audit-level=high`  → `bun audit --audit-level=high`
`pnpm --filter @ai-dict/extension-safari xcode:sync`  → `bun run --filter @ai-dict/extension-safari xcode:sync`
```

- [ ] **Step 2: Confirm no stray pnpm references in operational docs**

Run: `grep -n "pnpm" RELEASE_CHECKLIST.md || echo "clean"`
Expected: `clean`. (Historical plan docs under `docs/superpowers/plans/2026-05-28-ai-dict/` are intentionally left as-is per the spec.)

- [ ] **Step 3: Commit**

```bash
git add RELEASE_CHECKLIST.md
git commit -m "docs(bun): update RELEASE_CHECKLIST commands to bun"
```

---

## Task 13: Full green sweep + finish

**Files:** none (final verification).

- [ ] **Step 1: Clean install from the committed lockfile**

Run:
```bash
rm -rf node_modules packages/*/node_modules
bun install --frozen-lockfile
```
Expected: exits 0; no lockfile drift (proves `bun.lock` is authoritative and committed).

- [ ] **Step 2: Run the whole local gate sequence via bun**

Run:
```bash
bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build && bun run size && bun run wire:check && bunx knip
```
Expected: every command exits 0; bundle sizes within budget; matches the Task 1 baseline.

- [ ] **Step 3: Final repo-wide pnpm sweep (excluding historical plan docs + lockfile artifacts)**

Run:
```bash
grep -rniE "pnpm|action-setup|setup-node" \
  --include="*.json" --include="*.yml" --include="*.yaml" --include="*.mjs" --include="*.md" \
  . --exclude-dir=node_modules \
  | grep -v "docs/superpowers/plans/2026-05-28-ai-dict/" \
  | grep -v "pnpm-lock" \
  || echo "clean"
```
Expected: `clean` (only the intentionally-preserved historical plan docs may still mention pnpm, and they are filtered out).

- [ ] **Step 4: Confirm deleted files are gone and new files present**

Run: `ls pnpm-lock.yaml pnpm-workspace.yaml .npmrc .nvmrc 2>&1; ls bun.lock .bun-version`
Expected: the four pnpm files report "No such file"; `bun.lock` and `.bun-version` exist.

- [ ] **Step 5: Push the branch and open a PR (only if the user asks)**

Per project policy, push/PR only on explicit user request. When asked:
```bash
git push -u origin migrate-to-bun
gh pr create --title "Migrate toolchain from pnpm to bun" --body "<summary + link to spec>"
```

---

## Self-Review

**Spec coverage:** every spec change-set item maps to a task — root package.json (T2), workspace deletes + lockfile (T2/T3), extension build scripts (T6), `scripts/` (T7), ci.yml (T10), release.yml (T11), docs (T12), install regen (T3/T13). All four spec verification gates are explicit tasks: vitest-under-bun (T4, primary), filter/arg-forwarding (T5), bun audit (T9), esbuild + playwright under bun (T6/T8). `.nvmrc`/`engines` removal (T2); historical docs left untouched (T12 note + T13 filter).

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code/command step shows concrete content. The two intentionally conditional points (the `--` arg separator, the `bun audit` flag) are resolved by earlier verification tasks (T5, T9) whose outcome feeds the later edit — not placeholders.

**Type/command consistency:** filter syntax (`bun run --filter <pkg> <script>`) is uniform across T4/T5/T7/T10/T11; the arg-forwarding form is decided once in T5 and referenced (not re-guessed) in T7 and T10; script names (`typecheck`, `build`, `wire:check`, `release:bump`, `size`) match between the package.json in T2 and their invocations everywhere else.
