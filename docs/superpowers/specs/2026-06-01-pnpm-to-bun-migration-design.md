# Design: Migrate toolchain from pnpm to bun

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `brainstorm-superpower` (implement on a dedicated migration branch)

## Goal

Standardize the repository's package management and script-running on **bun**,
replacing pnpm. This is a **package-manager + runtime migration** only — the
tools bun cannot natively replace (or that carry too much risk to swap) are
**kept and invoked through bun**.

## Scope decisions (locked)

| Concern                                                             | Decision                                                                | Rationale                                                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager                                                     | **pnpm → bun**                                                          | The actual ask.                                                                                                                                                                     |
| Workspaces                                                          | **`pnpm-workspace.yaml` → `"workspaces"` field** in root `package.json` | Bun reads workspaces from `package.json`.                                                                                                                                           |
| Lockfile                                                            | **`pnpm-lock.yaml` → `bun.lock`** (text, committed)                     | Bun's reproducible lockfile.                                                                                                                                                        |
| Bundler (esbuild)                                                   | **KEEP esbuild**, run via bun                                           | Content scripts require `iife`, which `Bun.build` marks experimental; a silent break would reach users and is invisible to source-level tests. esbuild already runs fine under bun. |
| Test runner (vitest)                                                | **KEEP vitest + coverage gates**, run via bun                           | Avoids a high-churn, regression-prone rewrite of every test file to `bun:test`.                                                                                                     |
| Script runner (node)                                                | **node → bun** for `scripts/*.mjs`                                      | In-scope runtime swap; low risk.                                                                                                                                                    |
| eslint / prettier / playwright / knip / size-limit                  | **KEEP**, invoke via bun / bunx                                         | Bun has no native equivalent.                                                                                                                                                       |
| `.nvmrc` + `engines.node`                                           | **REMOVE both**                                                         | Node is no longer the declared runtime.                                                                                                                                             |
| Historical plan docs (`docs/superpowers/plans/2026-05-28-ai-dict/`) | **LEAVE untouched**                                                     | They are a dated record of how the project was originally built; this migration gets its own new spec + plan instead.                                                               |

**Net principle:** nothing about _what_ the tools do changes — only _who launches them_.
Bundle output, test behavior, and `.size-limit.json` budgets stay byte-identical,
so the only thing to verify is "does each tool still run under bun."

## Change set

### 1. Root `package.json`

- **Add** `"workspaces": ["packages/*"]`.
- **Remove** `"packageManager": "pnpm@9.15.4"` (corepack field; bun ignores it).
- **Remove** the `"engines"` block (was `node >=20.11.0 <21`).
- **Scripts:**
  - `typecheck`: `pnpm -r --if-present typecheck` → `bun run --filter '*' typecheck` _(all 5 packages have `typecheck`)_
  - `build`: `pnpm -r --if-present build` → `bun run --filter '@ai-dict/extension-*' build` _(only the two extensions define `build`; explicit filter avoids the missing `--if-present`)_
  - `wire:check`: `node scripts/wire-check.mjs` → `bun scripts/wire-check.mjs`
  - `release:bump`: `node scripts/release-bump.mjs` → `bun scripts/release-bump.mjs`
  - `test` (`vitest run`), `test:watch` (`vitest`), `lint` (`eslint .`), `format`/`format:check` (`prettier …`), `size` (`size-limit`): **command strings unchanged**; bun runs them.

### 2. Workspace package files (`packages/*/package.json`)

- `workspace:*` dependencies: **no change** (bun supports the protocol).
- `build` scripts: `node esbuild.config.mjs` → `bun esbuild.config.mjs` (chrome, safari).
- All other scripts (`typecheck`, `test`, `e2e`, `xcode:sync`) unchanged.

### 3. Files deleted / added

- **Delete:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.nvmrc`.
- **Add:** `bun.lock` (from `bun install`, committed); `.bun-version` pinning `1.3.14`.
- `.gitignore`: already does not ignore lockfiles — `bun.lock` commits, no edit needed.

### 4. `scripts/`

- `wire-check.mjs`: `spawnSync('pnpm', ['--filter','@ai-dict/core','test','wire-schema'])`
  → `spawnSync('bun', ['run','--filter','@ai-dict/core','test','wire-schema'])`
  (verify trailing-arg forwarding; may need a `--` separator). Update the
  failure-hint text (`pnpm --filter … -u` → bun form).
- `release-bump.mjs`: usage string `pnpm release:bump` → `bun run release:bump`. Logic untouched.

### 5. CI — `.github/workflows/ci.yml`

- Replace every `pnpm/action-setup` + `actions/setup-node` (`cache: pnpm`) pair with a single
  `oven-sh/setup-bun@v2` step reading `.bun-version`.
- Command translations:
  - `pnpm install --frozen-lockfile` → `bun install --frozen-lockfile`
  - `pnpm typecheck` / `pnpm lint` / `pnpm wire:check` → `bun run <script>`
  - `pnpm --filter <pkg> test` → `bun run --filter <pkg> test`
  - `pnpm --filter @ai-dict/core test wire-schema` → `bun run --filter @ai-dict/core test wire-schema` (verify arg forwarding)
  - `pnpm --filter <pkg> build` → `bun run --filter <pkg> build`
  - `pnpm --filter <pkg> exec playwright …` → `cd packages/<pkg> && bunx playwright …` (bun has no filtered `exec`)
  - `pnpm -r --if-present test -- --coverage` → `bun run --filter '*' test -- --coverage` (verify arg forwarding + that `--filter '*'` tolerates packages without the script)
  - `pnpm dlx knip` → `bunx knip`
  - `pnpm audit --audit-level=high` → `bun audit --audit-level=high` (verify flag)
- Dependency caching: `actions/cache` on `~/.bun/install/cache`, key derived from `bun.lock`.
- The `shared-drift` job uses only `diff` — **unchanged**.

### 6. CI — `.github/workflows/release.yml`

- Same setup-bun swap and command translations for `build-chrome`, `build-safari-ios`
  (`bun run --filter @ai-dict/extension-safari xcode:sync`), and `github-release`.

### 7. Docs

- `RELEASE_CHECKLIST.md`: the four `pnpm …` commands → bun equivalents.
- `renovate.json`: no functional change required (renovate auto-detects bun via
  `package.json` + `bun.lock`; `matchManagers: ["npm"]` still matches `package.json` ranges).
  Note only.
- Historical plan docs: **left untouched** (see scope decisions).

### 8. Install regeneration

- Remove `node_modules/` and `pnpm-lock.yaml`; run `bun install` to produce `bun.lock`
  - a flat `node_modules`. Confirm all dependencies resolve.

## Risks & verification gates

Ordered by stakes. Each must be confirmed during implementation, not assumed.

1. **[PRIMARY] vitest under the bun runtime.** vitest is node-oriented (vite, worker
   threads). The full suite **and** every per-package coverage gate
   (core 90 / adapters 90 / shared-ui 75 / chrome 80 / safari 90) must come back
   green. Validate first. Contingency: if vitest misbehaves under bun, keep node
   available for the test step specifically and document the exception.
2. **`bun run --filter '*'` + missing-script tolerance.** Bun's `--filter` has no
   documented `--if-present`. Verify `--filter '*'` does not error on a package
   lacking the target script (affects `typecheck` and the coverage-gate `test`).
   Build already routes around this via the explicit `@ai-dict/extension-*` filter.
3. **Trailing-arg forwarding through `--filter`.** `test wire-schema` and
   `test -- --coverage` pass args to vitest. Confirm the bun syntax (likely needs `--`).
4. **`bun audit --audit-level=high`.** `bun audit` exists in 1.3; confirm the
   `--audit-level` flag. Contingency: parse output / drop the flag if unsupported.
5. **esbuild under bun.** `bun esbuild.config.mjs` must produce byte-comparable
   `dist/*.js`; `size-limit` must stay within the existing budgets.
6. **playwright e2e under bun.** `bunx playwright test` (with `xvfb-run` in CI) must pass.

## Reversibility

Fully reversible: restore `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`
from git and revert `package.json`. All work happens on a dedicated migration branch.

## Out of scope

- Replacing esbuild with `Bun.build`.
- Replacing vitest with `bun:test`.
- Replacing eslint / prettier / playwright / knip / size-limit.
- Editing historical plan docs.
- Any change to bundle output, test assertions, or size budgets.
