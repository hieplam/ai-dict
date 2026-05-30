---
bundle: "01"
title: scaffold
status: DONE               # AVAILABLE | LOCKED | DONE | BLOCKED
locked_by: ""
locked_at: ""
done_at: "2026-05-30T06:57:16Z"
prereqs: []
owns_files:
  - pnpm-workspace.yaml
  - package.json
  - pnpm-lock.yaml
  - tsconfig.base.json
  - eslint.config.mjs            # ESLint 9 flat config (typescript-eslint + import-x zones)
  - .prettierrc.json
  - .prettierignore
  - vitest.config.ts             # root: test.projects (vitest.workspace.* is deprecated since 3.2)
  - .gitignore
  - .nvmrc
  - .npmrc
---

# Bundle 01 — Monorepo Scaffold

**Purpose:** Establish the pnpm-workspace monorepo root: package resolution, shared TS config, hex layering lint rules, formatting, the workspace-wide vitest runner, and the canonical root `package.json` scripts that every other bundle and CI depend on. No package source code — only root-level config.

## Lock protocol
Prereqs: none → immediately lockable. Flip YAML `status: AVAILABLE → LOCKED`, set `locked_by` + `locked_at` (UTC ISO8601), commit atomically (`git commit -m "[01] lock"`), `git pull --rebase`. If another lock for 01 already landed, abort. Execute.

## Inputs
- The spec only. Greenfield repo (currently just `README.md` + `docs/`).

## Outputs
- `pnpm-workspace.yaml` globbing `packages/*`.
- Root `package.json` with `engines.node` `>=20.11.0 <21`, exact `packageManager: pnpm@<installed 9.x>`, and the **frozen script-name contract**: `test`, `lint`, `typecheck`, `build`, `wire:check`, `size`, `release:bump` (+ helpers `format`, `format:check`).
- `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (spec §8.6). **DOM-free `lib`** (packages needing DOM add it in their own tsconfig — keeps `core` pure by default).
- `eslint.config.mjs`: `@typescript-eslint` `recommendedTypeChecked` + `import-x/no-restricted-paths` hex zones (spec §8.3) + shared-ui types-only via `@typescript-eslint/no-restricted-imports` `allowTypeImports`.
- `.prettierrc.json` + `.prettierignore`; `vitest.config.ts` (`test.projects: ['packages/*']`); `.gitignore`; `.nvmrc`; `.npmrc`.
- `pnpm install` produces a committed `pnpm-lock.yaml`.

## Definition of Done
- D1: `pnpm install` completes; `pnpm-lock.yaml` committed.
- D2: `pnpm typecheck`, `pnpm test`, `pnpm lint` all exit 0 with **zero packages** present (no-op) — proving scripts are wired and safe before any package exists.
- D3: `tsconfig.base.json` enables the three strict flags from §8.6; a probe snippet violating `noUncheckedIndexedAccess` fails `tsc` (then removed).
- D4: ESLint hex zones present per §8.3; a probe importing across a forbidden boundary errors (then removed); empty workspace lints clean.
- D5: Root `package.json` exposes all seven contract script names.
- D6: Node/pnpm versions pinned (`engines` + `packageManager` + `.nvmrc`).

---

## Implementation steps

- [ ] **Step 1: Pin the toolchain version (pnpm + node)**

```bash
corepack enable
node --version          # expect v20.11.x – v20.x (must satisfy >=20.11.0 <21)
pnpm --version          # note the exact 9.x.y for packageManager below
```
Expected: node in range; pnpm 9.x.y printed. Record the pnpm version string.

- [ ] **Step 2: Create `.nvmrc`, `.npmrc`, `.gitignore`**

`.nvmrc`:
```
20
```

`.npmrc`:
```
engine-strict=true
shamefully-hoist=false
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
.DS_Store
*.ipa
*.xcarchive
.vitest/
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: Create root `package.json` (frozen script contract)**

Replace `pnpm@9.0.0` with the exact version from Step 1.
```json
{
  "name": "ai-dict",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.11.0 <21" },
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "build": "pnpm -r --if-present build",
    "wire:check": "node scripts/wire-check.mjs",
    "size": "size-limit",
    "release:bump": "node scripts/release-bump.mjs"
  },
  "devDependencies": {}
}
```
Note: `wire:check`, `size`, `release:bump` point at scripts/config owned by Bundle 07; the **names** are the frozen contract here. They are not exercised by D2.

- [ ] **Step 5: Install the root toolchain (fills devDependencies + lockfile)**

```bash
pnpm add -Dw typescript vitest @vitest/coverage-v8 \
  eslint @eslint/js typescript-eslint \
  eslint-plugin-import-x eslint-import-resolver-typescript \
  eslint-config-prettier prettier \
  size-limit @size-limit/file
```
Expected: registry resolves latest stable; `package.json.devDependencies` populated; `pnpm-lock.yaml` written.

> `size-limit` + `@size-limit/file` back the frozen `size` script (Step 4); they live here with the other root-script tooling because the `size` *script name* is owned by this bundle while the `.size-limit.json` *config* is owned by Bundle 07. (`wire:check` and `release:bump` need no extra dep — Bundle 07 implements them with plain `node`.)

- [ ] **Step 6: Create `tsconfig.base.json` (strict, DOM-free)**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 7: Create `vitest.config.ts` (projects, not workspace)**

```ts
import { defineConfig } from 'vitest/config';

// `test.workspace` / `vitest.workspace.*` is deprecated since Vitest 3.2 — use `test.projects`.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
```

- [ ] **Step 8: Create Prettier config**

`.prettierrc.json`:
```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

`.prettierignore`:
```
dist/
coverage/
pnpm-lock.yaml
**/*.snapshot.json
```

- [ ] **Step 9: Create `eslint.config.mjs` (hex layering rules — §8.3)**

```js
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.snapshot.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allow root config TS files AND per-package vitest configs to type-check
        // via an inferred default project (packages/*/vitest.config.ts is needed so
        // package-level vitest configs resolve types correctly under projectService)
        projectService: { allowDefaultProject: ['*.config.ts', '*.config.mts', 'packages/*/vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true },
    },
    rules: {
      // §8.3 structural zones (path-based)
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // core MUST NOT import from adapters/ui/extensions
            {
              target: './packages/core/src',
              from: [
                './packages/adapters-shared',
                './packages/shared-ui',
                './packages/extension-chrome',
                './packages/extension-safari',
              ],
            },
            // adapters-shared MUST NOT import from extensions
            {
              target: './packages/adapters-shared/src',
              from: ['./packages/extension-chrome', './packages/extension-safari'],
            },
            // extension tests MUST NOT import sibling adapters (inject via fakes)
            {
              target: './packages/extension-chrome/test',
              from: ['./packages/extension-chrome/src/adapters'],
            },
            {
              target: './packages/extension-safari/test',
              from: ['./packages/extension-safari/src/adapters'],
            },
          ],
        },
      ],
    },
  },
  // §8.3 rule 3: shared-ui may import core TYPES ONLY (value imports forbidden)
  {
    files: ['packages/shared-ui/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ai-dict/core', '@ai-dict/core/*'],
              allowTypeImports: true,
              message: 'shared-ui may import core types only (import type ...).',
            },
          ],
        },
      ],
    },
  },
  // JS config files (eslint.config.mjs etc.) have no type info — turn off type-checked rules
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
```

- [ ] **Step 10: Verify empty-workspace no-op (D2)**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm lint
```
Expected: all exit 0. `pnpm test` (vitest) reports "No test files found" but exits 0; `pnpm typecheck`/`build` no-op via `--if-present`; `eslint .` finds no violations.

- [ ] **Step 11: Probe the strict TS flags (D3), then remove**

```bash
mkdir -p packages/_probe/src
printf '{"extends":"../../tsconfig.base.json","compilerOptions":{"noEmit":true},"include":["src"]}' > packages/_probe/tsconfig.json
printf 'export const f = (a: string[]) => a[0].length;\n' > packages/_probe/src/probe.ts   # a[0] is string | undefined under noUncheckedIndexedAccess
npx tsc -p packages/_probe/tsconfig.json
```
Expected: **FAIL** — `'a[0]' is possibly 'undefined'`. Then delete the probe:
```bash
rm -rf packages/_probe
```

- [ ] **Step 12: Probe the hex zone (D4), then remove**

```bash
mkdir -p packages/core/src packages/shared-ui/src
printf 'export const x = 1;\n' > packages/shared-ui/src/dummy.js
printf "import { x } from '../../shared-ui/src/dummy.js';\nexport const y = x;\n" > packages/core/src/probe.js
pnpm exec eslint packages/core/src/probe.js
```
Expected: **FAIL** — `import-x/no-restricted-paths` reports core importing from shared-ui. (Probe uses `.js` so the type-aware `projectService` is not required — `no-restricted-paths` is path-based and still fires.) Then clean up:
```bash
rm -rf packages/core packages/shared-ui
```

- [ ] **Step 13: Commit the scaffold**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json \
  eslint.config.mjs .prettierrc.json .prettierignore vitest.config.ts \
  .gitignore .nvmrc .npmrc
git commit -m "feat(scaffold): pnpm workspace, strict tsconfig, hex eslint zones, vitest projects"
```

## Verify (correctness)
- `pnpm install --frozen-lockfile` → success (Step 10).
- `pnpm typecheck && pnpm test && pnpm lint` → exit 0 on empty workspace (Step 10).
- Strict-flag probe fails `tsc` (Step 11). Hex-zone probe fails eslint (Step 12).

## Validate (sanity / no scope drift)
- `git diff --stat` touches only files in `owns_files` (root config). **No surviving `packages/**`** — both probes deleted.
- No source code, no extension manifests, no CI yaml (those belong to 02–07).
- Script names match the README contracts table exactly (no rename).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D6 all met and evidenced by command output?
- [ ] Both probes (`packages/_probe`, `packages/core`, `packages/shared-ui`) removed — `git status` clean of them?
- [ ] Seven contract scripts present and correctly named?
- [ ] Hex zones match spec §8.3 (4 rules: core⇏outward, adapters⇏ext, ext/test⇏adapters, shared-ui⇏core-values)?
- [ ] Strict TS flags confirmed by a failing probe?
- [ ] `packageManager` pinned to the actual installed pnpm 9.x?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README status board checkbox `01`.

## Retroactive attribution (post-DONE)
During Bundle 02 execution, `eslint.config.mjs` required a one-line addition to `allowDefaultProject`:
`'packages/*/vitest.config.ts'` was added so per-package `vitest.config.ts` files
type-check correctly under `projectService`. This pattern belongs to Bundle 01's
`eslint.config.mjs` ownership — Bundle 02 discovered the gap and the change is
retroactively credited here. The Step 9 template above has been updated to include
this pattern so future re-runs of Bundle 01 produce the correct config from the start.
