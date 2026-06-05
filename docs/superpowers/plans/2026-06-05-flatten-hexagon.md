# Flatten the Hexagon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 5-package hexagonal extension into 3 packages (one `@ai-dict/app` library + the two unchanged extension packages), removing per-platform file duplication and the wire-schema shim/drift/size apparatus, while preserving one-directional deps, the `ports.ts` interface seam, and all existing tests.

**Architecture:** Build the new `@ai-dict/app` library **additively** (copy all platform-agnostic code in, with its tests passing) before switching either extension to it; then switch chrome, switch safari, then delete the three old library packages; finally remove the dropped gates/CI jobs. Tests stay green at every commit. The dependency direction is `extensions → @ai-dict/app → ports → domain`.

**Tech Stack:** TypeScript, Bun workspaces, Vitest (happy-dom), esbuild, zod v4, Playwright (chrome e2e). No build step for the library (packages export `./src/*.ts` directly).

**Spec:** `docs/superpowers/specs/2026-06-05-flatten-hexagon-design.md`

**Baseline (already verified):** `bun run test` → 36 files, 282 tests passing.

---

## Conventions used in this plan

- Run all commands from the worktree root: `/Users/home/repos/ai-dict/.claude/worktrees/simplify-hexagon`.
- "Full suite" = `bun run test` (expected: ≥282 passing while old packages still exist; exactly 282 after deletes).
- "Typecheck" = `bun run typecheck` (runs `tsc --noEmit` in every workspace).
- Prefer `git mv` for moves (preserves history). After moving a file, fix the relative import paths inside it.
- Commit after each task. Use the message shown.

---

## Task 0: Scaffold the `@ai-dict/app` package

**Files:**

- Create: `packages/app/package.json`
- Create: `packages/app/tsconfig.json`
- Create: `packages/app/vitest.config.ts`
- Create: `packages/app/src/index.ts` (temporary empty barrel)

- [ ] **Step 1: Create `packages/app/package.json`**

```json
{
  "name": "@ai-dict/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./test/fakes": "./test/fakes/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^4.0.0",
    "marked": "^14.0.0",
    "dompurify": "^3.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "happy-dom": "^15.0.0",
    "axe-core": "^4.10.0"
  }
}
```

- [ ] **Step 2: Create `packages/app/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/app/vitest.config.ts`** (happy-dom covers both the old node and DOM tests; node globals remain available under happy-dom)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```

- [ ] **Step 4: Create a temporary empty barrel `packages/app/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Install + verify the workspace resolves**

Run: `bun install`
Expected: completes; `packages/app` is now a workspace member.

Run: `bun run --filter @ai-dict/app test`
Expected: PASS with "no tests" (passWithNoTests) — exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/app
git commit -m "chore(app): scaffold empty @ai-dict/app package"
```

---

## Task 1: Move `core` source into `@ai-dict/app` (domain + ports + wire + fakes)

The old `core` package stays in place for now (still consumed by shared-ui/adapters-shared/extensions); we are **copying its content into app** so app becomes self-sufficient. We physically move the files and re-create `core` as a thin re-export shim so nothing breaks until the final delete.

**Files:**

- Move: `packages/core/src/{types,ports,default-template,prompt-template,cache-policy,history-policy,error-mapper,workflow}.ts` → `packages/app/src/domain/` (and `ports.ts` → `packages/app/src/ports.ts`, `wire-schema.ts` → `packages/app/src/wire.ts`)
- Move: `packages/core/test/**` → `packages/app/test/**`
- Modify: `packages/app/src/index.ts` (real barrel)
- Modify: `packages/core/src/index.ts` (becomes a re-export shim to `@ai-dict/app`)

- [ ] **Step 1: Move the domain modules**

```bash
mkdir -p packages/app/src/domain
git mv packages/core/src/types.ts            packages/app/src/domain/types.ts
git mv packages/core/src/default-template.ts packages/app/src/domain/default-template.ts
git mv packages/core/src/prompt-template.ts  packages/app/src/domain/prompt-template.ts
git mv packages/core/src/cache-policy.ts     packages/app/src/domain/cache-policy.ts
git mv packages/core/src/history-policy.ts   packages/app/src/domain/history-policy.ts
git mv packages/core/src/error-mapper.ts     packages/app/src/domain/error-mapper.ts
git mv packages/core/src/workflow.ts         packages/app/src/domain/workflow.ts
git mv packages/core/src/ports.ts            packages/app/src/ports.ts
git mv packages/core/src/wire-schema.ts      packages/app/src/wire.ts
```

- [ ] **Step 2: Move the core tests + fakes**

```bash
mkdir -p packages/app/test
git mv packages/core/test/* packages/app/test/
```

- [ ] **Step 3: Fix internal relative imports in the moved files**

The domain modules import each other with `./x`; now that they share `domain/`, sibling imports are unchanged, but `ports.ts` and `wire.ts` moved up one level relative to domain, and `domain/*` files that imported `./ports` or `./types` need review.

Run this to find imports that crossed the new `domain/` boundary:

```bash
grep -rn "from '\./" packages/app/src/domain packages/app/src/ports.ts packages/app/src/wire.ts
```

Apply these rules:

- Inside `packages/app/src/domain/*.ts`: imports of former siblings now in `domain/` stay `./x`. An import of `./ports` becomes `../ports`. An import of `./wire-schema` becomes `../wire`.
- Inside `packages/app/src/ports.ts`: `./types` becomes `./domain/types`.
- Inside `packages/app/src/wire.ts`: `./types` becomes `./domain/types`.
- Inside `packages/app/test/**`: imports of `../src/<x>` must point at the new locations — e.g. `../src/workflow` → `../src/domain/workflow`, `../src/wire-schema` → `../src/wire`, `../src/ports` → `../src/ports`. Update each test's import paths to match.

- [ ] **Step 4: Write the real barrel `packages/app/src/index.ts`**

```ts
export * from './domain/types';
export * from './ports';
export * from './domain/default-template';
export * from './domain/prompt-template';
export * from './domain/cache-policy';
export * from './domain/history-policy';
export * from './domain/error-mapper';
export * from './wire';
export * from './domain/workflow';
```

- [ ] **Step 5: Turn old `core` into a thin shim so existing consumers keep working**

Replace `packages/core/src/index.ts` with:

```ts
export * from '@ai-dict/app';
```

Replace `packages/core/package.json` `exports` + `dependencies` so the shim resolves and the `test/fakes` subpath still works:

```json
{
  "name": "@ai-dict/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./test/fakes": "../app/test/fakes/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-dict/app": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.11.0"
  }
}
```

Delete the now-stale `packages/core/vitest.config.ts` and `packages/core/tsconfig.json`? No — keep `tsconfig.json`; delete `vitest.config.ts` (core has no tests now):

```bash
git rm packages/core/vitest.config.ts
```

- [ ] **Step 6: Reinstall + verify**

Run: `bun install`
Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test`
Expected: PASS, ≥282 (core's tests now run under the `app` project).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(app): move core domain/ports/wire into @ai-dict/app, core re-exports it"
```

---

## Task 2: Move `shared-ui` into `@ai-dict/app/ui` + extract element registration

**Files:**

- Move: `packages/shared-ui/src/*` → `packages/app/src/ui/*`
- Move: `packages/shared-ui/test/*` → `packages/app/test/ui/*` (or alongside; keep `*.test.ts`)
- Create: `packages/app/src/ui/register.ts`
- Modify: the 4 element class modules (remove top-level `define`)
- Modify: `packages/app/src/index.ts` (export ui + register fns)
- Modify: `packages/shared-ui/package.json` + `src/index.ts` (re-export shim)

- [ ] **Step 1: Move shared-ui source + tests**

```bash
mkdir -p packages/app/src/ui
git mv packages/shared-ui/src/lookup-trigger.ts packages/app/src/ui/lookup-trigger.ts
git mv packages/shared-ui/src/lookup-card.ts     packages/app/src/ui/lookup-card.ts
git mv packages/shared-ui/src/bottom-sheet.ts    packages/app/src/ui/bottom-sheet.ts
git mv packages/shared-ui/src/settings-form.ts   packages/app/src/ui/settings-form.ts
git mv packages/shared-ui/src/index.ts           packages/app/src/ui/index.ts
mkdir -p packages/app/src/ui/styles
git mv packages/shared-ui/src/styles/adopt.ts    packages/app/src/ui/styles/adopt.ts
mkdir -p packages/app/test/ui
git mv packages/shared-ui/test/* packages/app/test/ui/
```

- [ ] **Step 2: Fix relative imports in moved ui files**

```bash
grep -rn "from '@ai-dict/core'\|from '\.\./" packages/app/src/ui packages/app/test/ui
```

Rules:

- `from '@ai-dict/core'` → `from '../../src'` is wrong for tests; for **src** ui files use `from '../domain/types'` etc. via the barrel: replace `from '@ai-dict/core'` with `from '../index'` inside `packages/app/src/ui/*.ts` (the barrel is one level up). For nested `styles/adopt.ts`, use `from '../../index'` if it imports core.
- In `packages/app/test/ui/*.ts`: replace `from '@ai-dict/shared-ui/...'` with `from '../../src/ui/...'`, and `from '@ai-dict/core'` with `from '../../src'`.

- [ ] **Step 3: Remove the top-level `define` from each class module**

In each of `packages/app/src/ui/lookup-trigger.ts`, `lookup-card.ts`, `bottom-sheet.ts`, `settings-form.ts`, delete the final registration line (the one matching `customElements.define(...)`). Leave the exported class intact.

Lines to delete (exact current text):

```ts
if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
```

- [ ] **Step 4: Create `packages/app/src/ui/register.ts`**

```ts
import { LookupTrigger } from './lookup-trigger';
import { LookupCard } from './lookup-card';
import { BottomSheet } from './bottom-sheet';
import { SettingsForm } from './settings-form';

export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
}

export function registerSettingsForm(): void {
  if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
}
```

- [ ] **Step 5: Update `packages/app/src/ui/index.ts` to also export register**

```ts
export * from './lookup-trigger';
export * from './lookup-card';
export * from './bottom-sheet';
export * from './settings-form';
export * from './register';
```

- [ ] **Step 6: Extend the app barrel `packages/app/src/index.ts`** — append:

```ts
export * from './ui/index';
```

- [ ] **Step 7: Update the moved ui registration tests**

Tests that asserted "importing the module defines the element" must now call the function. In each affected file under `packages/app/test/ui/`, before asserting `customElements.get('...')` is defined, add a setup call:

```ts
import { registerContentElements, registerSettingsForm } from '../../src/ui/register';
// in a beforeEach or at the top of the relevant test:
registerContentElements(); // for trigger/card/bottom-sheet specs
registerSettingsForm(); // for the settings-form spec
```

Run the ui tests to find which assertions broke and fix each:
Run: `bun run --filter @ai-dict/app test`
Expected after fixes: PASS.

- [ ] **Step 8: Turn old `shared-ui` into a shim**

Replace `packages/shared-ui/src/index.ts`:

```ts
export * from '@ai-dict/app';
```

The old subpath imports (`@ai-dict/shared-ui/lookup-card` etc.) are still used by the extensions as **side-effect** imports for registration. They will be replaced in Tasks 4–5. Until then, recreate those subpath files as registration shims so current behavior is preserved. Replace `packages/shared-ui/package.json` `exports` with files that call the registration:

Create `packages/shared-ui/src/_register-trigger.ts`:

```ts
import { registerContentElements } from '@ai-dict/app';
registerContentElements();
```

(and `_register-card.ts`, `_register-bottom-sheet.ts` with the same body — registration is idempotent; `_register-settings.ts` calls `registerSettingsForm()` instead.)

Set `packages/shared-ui/package.json`:

```json
{
  "name": "@ai-dict/shared-ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./lookup-trigger": "./src/_register-trigger.ts",
    "./lookup-card": "./src/_register-card.ts",
    "./bottom-sheet": "./src/_register-bottom-sheet.ts",
    "./settings-form": "./src/_register-settings.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@ai-dict/app": "workspace:*" }
}
```

> Note: these shims preserve current behavior so the extensions stay green **before** we rewire them. They are deleted with `shared-ui` in Task 6. The `import type { LookupCard } from '@ai-dict/shared-ui/lookup-card'` type-only imports still resolve because the class is re-exported from the package root via `@ai-dict/app`; update those type imports to the package root in Tasks 4–5.

```bash
git rm packages/shared-ui/vitest.config.ts
```

- [ ] **Step 9: Reinstall + verify**

Run: `bun install`
Run: `bun run typecheck` (fix any leftover type-only `@ai-dict/shared-ui/<subpath>` imports that no longer resolve as types — point them at `@ai-dict/shared-ui` root, which re-exports the class)
Run: `bun run test`
Expected: PASS, ≥282.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(app): move shared-ui into @ai-dict/app/ui, extract element registration"
```

---

## Task 3: Move `adapters-shared` into `@ai-dict/app/app`

**Files:**

- Move: `packages/adapters-shared/src/*` → `packages/app/src/app/*`
- Move: `packages/adapters-shared/test/*` → `packages/app/test/app/*`
- Modify: app barrel
- Modify: `packages/adapters-shared` → shim

- [ ] **Step 1: Move source + tests**

```bash
mkdir -p packages/app/src/app packages/app/test/app
git mv packages/adapters-shared/src/markdown-sanitize.ts            packages/app/src/app/markdown-sanitize.ts
git mv packages/adapters-shared/src/gemini-lookup-client.ts         packages/app/src/app/gemini-lookup-client.ts
git mv packages/adapters-shared/src/inline-bottom-sheet-renderer.ts packages/app/src/app/inline-bottom-sheet-renderer.ts
git rm packages/adapters-shared/src/index.ts
git mv packages/adapters-shared/test/* packages/app/test/app/
```

- [ ] **Step 2: Fix relative imports in moved files**

```bash
grep -rn "from '@ai-dict/core'\|from '@ai-dict/shared-ui'\|from '\.\./" packages/app/src/app packages/app/test/app
```

Rules:

- In `packages/app/src/app/*.ts`: `from '@ai-dict/core'` → `from '../index'`; `from '@ai-dict/shared-ui'` or `from '@ai-dict/shared-ui/lookup-card'` (type imports) → `from '../ui/lookup-card'` (relative to `src/app/`).
- In `packages/app/test/app/*.ts`: `from '@ai-dict/adapters-shared'` → `from '../../src/app/<module>'`; `from '@ai-dict/core'` → `from '../../src'`; `from '@ai-dict/shared-ui/...'` → `from '../../src/ui/...'`.

- [ ] **Step 3: Extend the app barrel `packages/app/src/index.ts`** — append:

```ts
export * from './app/markdown-sanitize';
export * from './app/gemini-lookup-client';
export * from './app/inline-bottom-sheet-renderer';
```

- [ ] **Step 4: Turn old `adapters-shared` into a shim**

Set `packages/adapters-shared/package.json`:

```json
{
  "name": "@ai-dict/adapters-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./gemini-lookup-client": "./src/index.ts",
    "./inline-bottom-sheet-renderer": "./src/index.ts",
    "./markdown-sanitize": "./src/index.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@ai-dict/app": "workspace:*" }
}
```

Create `packages/adapters-shared/src/index.ts`:

```ts
export * from '@ai-dict/app';
```

```bash
git rm packages/adapters-shared/vitest.config.ts
```

- [ ] **Step 5: Reinstall + verify**

Run: `bun install`
Run: `bun run typecheck`
Run: `bun run test`
Expected: PASS, ≥282.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(app): move adapters-shared into @ai-dict/app/app"
```

---

## Task 4: Move the duplicated extension files into `@ai-dict/app/app`

These four files are byte-identical across the two extensions: `router.ts`, `inbound.ts`, `adapters/dom-selection-source.ts`, `adapters/message-relay-lookup-client.ts`. One copy moves into `app`; both extensions will import it.

**Files:**

- Move (from chrome copy): `packages/extension-chrome/src/router.ts`, `src/inbound.ts`, `src/adapters/dom-selection-source.ts`, `src/adapters/message-relay-lookup-client.ts` → `packages/app/src/app/`
- Delete (safari duplicates): the same four under `packages/extension-safari/src`
- Move the corresponding tests into `packages/app/test/app/`

- [ ] **Step 1: Move chrome's copy into app**

```bash
git mv packages/extension-chrome/src/router.ts                          packages/app/src/app/router.ts
git mv packages/extension-chrome/src/inbound.ts                         packages/app/src/app/inbound.ts
git mv packages/extension-chrome/src/adapters/dom-selection-source.ts   packages/app/src/app/dom-selection-source.ts
git mv packages/extension-chrome/src/adapters/message-relay-lookup-client.ts packages/app/src/app/message-relay-lookup-client.ts
```

- [ ] **Step 2: Delete safari's byte-identical duplicates**

```bash
git rm packages/extension-safari/src/router.ts
git rm packages/extension-safari/src/inbound.ts
git rm packages/extension-safari/src/adapters/dom-selection-source.ts
git rm packages/extension-safari/src/adapters/message-relay-lookup-client.ts
```

- [ ] **Step 3: Rewire imports inside the moved files** to use the app barrel + sibling modules

```bash
grep -rn "from '@ai-dict/core'\|from '@ai-dict/adapters-shared'\|from '\./" packages/app/src/app/router.ts packages/app/src/app/inbound.ts packages/app/src/app/dom-selection-source.ts packages/app/src/app/message-relay-lookup-client.ts
```

Rules (these files now live in `src/app/`):

- `from '@ai-dict/core'` → `from '../index'`.
- `from '@ai-dict/adapters-shared/...'` or `'@ai-dict/adapters-shared'` → `from './<module>'` (e.g. `./gemini-lookup-client`).
- `inbound.ts` imports the wire schema: ensure it imports `WireMessageSchema`/`WireReplySchema` from `../index` (the real zod schema — no lite shim).
- Any `./adapters/x` paths from the old chrome location → `./x` (now siblings in `src/app/`).

- [ ] **Step 3b: Export the hoisted modules from the app barrel** — append to `packages/app/src/index.ts`:

```ts
export * from './app/router';
export * from './app/inbound';
export * from './app/dom-selection-source';
export * from './app/message-relay-lookup-client';
```

(These provide the `buildRouter`, `WriteQueue`, `SUPPRESS`, `classifyInbound`, `DomSelectionSource`, `MessageRelayLookupClient` symbols that both extensions import from `@ai-dict/app` in Task 5.)

- [ ] **Step 4: Move the shared tests for these files into app**

Identify the tests that exercise router/inbound/dom-selection/message-relay (they live in each extension's `test/` or `src/adapters/*.test.ts`). The platform-agnostic ones move to app; platform-specific adapter tests stay. Move the agnostic ones:

```bash
# chrome's lite-wire / inbound / router tests that are platform-agnostic:
git mv packages/extension-chrome/test/router.test.ts   packages/app/test/app/router.test.ts 2>/dev/null || true
git mv packages/extension-chrome/test/inbound.test.ts  packages/app/test/app/inbound.test.ts 2>/dev/null || true
git mv packages/extension-chrome/src/adapters/dom-selection-source.test.ts packages/app/test/app/dom-selection-source.test.ts 2>/dev/null || true
git mv packages/extension-chrome/src/adapters/message-relay-lookup-client.test.ts packages/app/test/app/message-relay-lookup-client.test.ts 2>/dev/null || true
# delete safari's now-duplicate copies of the same agnostic tests:
git rm packages/extension-safari/test/router.test.ts packages/extension-safari/test/inbound.test.ts 2>/dev/null || true
git rm packages/extension-safari/src/adapters/dom-selection-source.test.ts packages/extension-safari/src/adapters/message-relay-lookup-client.test.ts 2>/dev/null || true
```

Fix import paths in the moved tests: `from '@ai-dict/core/test/fakes'` → `from '../fakes'` or `from '@ai-dict/app/test/fakes'`; `from '../src/router'`/`'./router'` → `from '../../src/app/router'`; `from '@ai-dict/core'` → `from '../../src'`.

> Note: the `shared-drift` CI job that guarded these byte-identical files is removed in Task 7. Locally nothing enforces it, so intermediate commits are fine.

- [ ] **Step 5: Verify (chrome still imports old local paths — expect breakage here, fixed in Task 5)**

Run: `bun run --filter @ai-dict/app test`
Expected: app tests PASS (router/inbound/etc. now tested in app).

Do **not** run the full extension typecheck yet — chrome/safari still reference the moved files and will be rewired in Task 5. Commit this structural move first.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(app): hoist duplicated router/inbound/dom-selection/relay into @ai-dict/app"
```

---

## Task 5: Rewire both extensions onto `@ai-dict/app`

Switch every `@ai-dict/{core,shared-ui,adapters-shared}` import in both extensions to `@ai-dict/app`, replace the moved local imports, swap side-effect registration for the register functions, and drop the lite-wire shim + esbuild shim plugin.

**Files (chrome):** `sw.ts`, `content.ts`, `content-elements.ts`, `options.ts`, `side-panel.ts`, `router`/`inbound` consumers, `adapters/*` that import libs, `esbuild.config.mjs`, `package.json`. Delete `lite-wire-schema.ts` + test.
**Files (safari):** `sw.ts`, `content.ts`, `options.ts`, `adapters/*`, `esbuild.config.mjs`, `package.json`. Delete `lite-wire-schema.ts` + test.

- [ ] **Step 1: Update both extension `package.json` deps**

In `packages/extension-chrome/package.json` and `packages/extension-safari/package.json`, replace the three lib deps with one:

```json
  "dependencies": {
    "@ai-dict/app": "workspace:*"
  },
```

(keep each extension's existing devDependencies: `@types/chrome`/`@types/webextension-polyfill`, `@playwright/test` (chrome), `esbuild`, `happy-dom`.)

- [ ] **Step 2: Rewire library imports in both extensions' remaining `src/**`\*\*

```bash
grep -rln "@ai-dict/core\|@ai-dict/shared-ui\|@ai-dict/adapters-shared" packages/extension-chrome/src packages/extension-safari/src
```

For each hit apply:

- `from '@ai-dict/core'` → `from '@ai-dict/app'`.
- `from '@ai-dict/adapters-shared'` and `from '@ai-dict/adapters-shared/<x>'` → `from '@ai-dict/app'`.
- `import type { LookupCard } from '@ai-dict/shared-ui/lookup-card'` (and the other type-only ui imports) → `from '@ai-dict/app'`.

- [ ] **Step 3: Replace side-effect registration imports with function calls**

- chrome `content-elements.ts`: delete the three `import '@ai-dict/shared-ui/...'` lines; add:
  ```ts
  import { registerContentElements } from '@ai-dict/app';
  registerContentElements();
  ```
- safari `content.ts`: delete the three `import '@ai-dict/shared-ui/...'` lines; add the same two lines as above (top of file).
- chrome `options.ts` and safari `options.ts`: delete `import '@ai-dict/shared-ui/settings-form'`; add:

  ```ts
  import { registerSettingsForm } from '@ai-dict/app';
  registerSettingsForm();
  ```

- [ ] **Step 4: Repoint the moved-file imports inside the extensions**

The extensions previously imported `./router`, `./inbound`, `./adapters/dom-selection-source`, `./adapters/message-relay-lookup-client` locally. Those now live in `@ai-dict/app`.

```bash
grep -rn "from '\./router'\|from '\./inbound'\|from '\./adapters/dom-selection-source'\|from '\./adapters/message-relay-lookup-client'" packages/extension-chrome/src packages/extension-safari/src
```

Replace each with the named import from `@ai-dict/app`, e.g.:

- `import { buildRouter, WriteQueue, SUPPRESS } from './router';` → `from '@ai-dict/app';`
- `import { classifyInbound } from './inbound';` → `from '@ai-dict/app';`
- `import { DomSelectionSource } from './adapters/dom-selection-source';` → `from '@ai-dict/app';`
- `import { MessageRelayLookupClient } from './adapters/message-relay-lookup-client';` → `from '@ai-dict/app';`

(Platform-specific adapters like `./adapters/chrome-kv-store` stay local.)

- [ ] **Step 5: Delete the lite-wire shims + their tests**

```bash
git rm packages/extension-chrome/src/lite-wire-schema.ts packages/extension-chrome/src/lite-wire-schema.test.ts
git rm packages/extension-safari/src/lite-wire-schema.ts packages/extension-safari/src/lite-wire-schema.test.ts
```

Find any remaining references and repoint to the real schema from `@ai-dict/app`:

```bash
grep -rn "lite-wire-schema" packages/extension-chrome packages/extension-safari
```

`inbound`/`content`/`sw` that referenced the lite shim should already import `WireMessageSchema` from `@ai-dict/app`.

- [ ] **Step 6: Remove the esbuild `wire-schema-shim` plugin from both configs**

In `packages/extension-chrome/esbuild.config.mjs` and `packages/extension-safari/esbuild.config.mjs`:

- Delete the `coreSrcDir`/`liteWireSchemaPath` consts and the entire `wireSchemaShim` plugin object (the comment block + `const wireSchemaShim = {...}`).
- Remove `wireSchemaShim` from the `plugins: [...]` array in `common` (leave `plugins: []` or drop the key).

Keep everything else (the `content.ts` `define: { customElements: '__ce' }` banner stays — harmless safety net).

- [ ] **Step 7: Verify typecheck, tests, and builds**

Run: `bun run typecheck`
Expected: PASS (fix any missed import).

Run: `bun run test`
Expected: PASS, 282 (duplicates removed; count should settle at the original 282).

Run: `bun run build:chrome && bun run build:safari`
Expected: both succeed; `dist/sw.js` etc. produced. (zod is now in the bundle — that is accepted.)

- [ ] **Step 8: Smoke-check the service worker has no `customElements` reference**

```bash
grep -c "customElements" packages/extension-chrome/dist/sw.js || echo "0 — good, SW is clean"
```

Expected: `0` (or "good"). If non-zero, a UI module leaked into the SW bundle — re-check that `sw.ts` imports only logic symbols and that the class modules no longer call `define` at top level.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(ext): rewire chrome + safari onto @ai-dict/app, drop lite-wire shim"
```

---

## Task 6: Delete the three old library packages

Nothing imports `@ai-dict/{core,shared-ui,adapters-shared}` anymore (all rewired to `@ai-dict/app`). Remove them.

- [ ] **Step 1: Confirm no remaining references**

```bash
grep -rn "@ai-dict/core\|@ai-dict/shared-ui\|@ai-dict/adapters-shared" packages --include='*.ts' --include='*.mjs' --include='*.json' | grep -v node_modules | grep -v coverage
```

Expected: only matches inside the packages about to be deleted (the shims themselves). If any other file matches, fix it first.

- [ ] **Step 2: Delete the packages**

```bash
git rm -r packages/core packages/shared-ui packages/adapters-shared
```

- [ ] **Step 3: Reinstall + full verify**

Run: `bun install`
Run: `bun run typecheck`
Run: `bun run test`
Expected: PASS, 282.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete old core/shared-ui/adapters-shared packages (merged into @ai-dict/app)"
```

---

## Task 7: Remove the dropped gates, CI jobs, and stale references

**Files:**

- Delete: `scripts/wire-check.mjs`, `packages/core/wire-schema.snapshot.json` (already gone with core — verify), `.size-limit.json`
- Modify: root `package.json` (drop `wire:check`, `size` scripts), `.github/workflows/ci.yml`, `knip.json`, `tsconfig.base.json`, `RELEASE_CHECKLIST.md`

- [ ] **Step 1: Delete the gate scripts/config**

```bash
git rm scripts/wire-check.mjs .size-limit.json
ls packages/core 2>/dev/null && echo "core still present — should be gone" || echo "core gone, snapshot gone — good"
```

- [ ] **Step 2: Drop root scripts**

In `package.json`, remove these two lines from `scripts`:

```json
    "wire:check": "bun scripts/wire-check.mjs",
    "size": "size-limit",
```

Also remove `@size-limit/file` and `size-limit` from `devDependencies` (no longer used).

- [ ] **Step 3: Update `.github/workflows/ci.yml`**

- Delete the entire `wire-schema-check:` job (the one running `bun run wire:check`).
- Delete the entire `size-check:` job (the one running `bun run size`).
- Delete the entire `shared-drift:` job (the byte-identical guard — duplication is gone).
- In `test-contract:`, change `bun run --filter @ai-dict/core test wire-schema` → `bun run --filter @ai-dict/app test wire` (the wire tests now live in app; confirm the vitest filter name matches the moved test file, e.g. `wire.test.ts`).
- In the `shared-ui` component-test job, change `bun run --filter @ai-dict/shared-ui test` → `bun run --filter @ai-dict/app test`.
- Remove any `needs: [...]` entries that referenced the deleted jobs.

- [ ] **Step 4: Update `knip.json` and `tsconfig.base.json`**

```bash
grep -n "core\|shared-ui\|adapters-shared\|size-limit\|wire-check" knip.json tsconfig.base.json
```

Update any `workspaces`/`paths`/`entry`/`project` globs that named the deleted packages or scripts to reference `packages/app` instead.

- [ ] **Step 5: Update `RELEASE_CHECKLIST.md`**

```bash
grep -n "core\|shared-ui\|adapters-shared\|wire:check\|size" RELEASE_CHECKLIST.md
```

Remove/repoint any steps referencing `wire:check`, `size`, or the deleted package names.

- [ ] **Step 6: Verify everything green**

Run: `bun install`
Run: `bun run typecheck && bun run test && bun run lint && bun run format:check`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove wire:check + size gates, shared-drift job, stale refs"
```

---

## Task 8: Final full verification + PR

- [ ] **Step 1: Run the complete gate**

```bash
bun run typecheck
bun run test          # expect 282 passing
bun run lint
bun run format:check
bun run build:chrome
bun run build:safari
bun run e2e:chrome
```

Expected: all PASS. If `format:check` fails, run `bun run format` and re-commit.

- [ ] **Step 2: Verify the end-state invariants**

```bash
ls packages            # expect exactly: app  extension-chrome  extension-safari
grep -rn "@ai-dict/core\|@ai-dict/shared-ui\|@ai-dict/adapters-shared\|lite-wire\|wire:check\|size-limit" packages scripts .github knip.json package.json | grep -v node_modules | grep -v coverage
```

Expected: package list is the 3 packages; the grep returns nothing.

- [ ] **Step 3: Confirm no duplication remains between extensions**

```bash
for f in $(cd packages/extension-chrome/src && find . -name '*.ts' -not -name '*.test.ts'); do
  [ -f "packages/extension-safari/src/$f" ] && diff -q "packages/extension-chrome/src/$f" "packages/extension-safari/src/$f" >/dev/null 2>&1 && echo "STILL IDENTICAL: $f"
done
echo "(no STILL IDENTICAL lines = good)"
```

- [ ] **Step 4: Update the README dev-workflow section if it lists removed scripts**

```bash
grep -n "wire:check\|size\|core\|shared-ui\|adapters-shared" README.md
```

Repoint or remove any stale references (the "Known tradeoffs" note added earlier stays).

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin worktree-simplify-hexagon
gh pr create --base master --title "Flatten hexagon: 5 packages -> 3, kill duplication" --body "$(cat <<'EOF'
## Summary
Collapses the 5-package hexagonal architecture into 3 packages — one `@ai-dict/app`
library plus the two unchanged extension packages — removing per-platform file
duplication and the wire-schema shim/drift/size apparatus, while preserving
one-directional dependencies, the `ports.ts` interface seam, pure domain, and all tests.

## Key changes
- Merge `core` + `adapters-shared` + `shared-ui` into `@ai-dict/app` (single barrel).
- Hoist the byte-identical `router`/`inbound`/`dom-selection-source`/`message-relay-lookup-client` into `app` (the `shared-drift` CI guard anticipated this).
- Extract custom-element registration into `registerContentElements()` / `registerSettingsForm()` so the single barrel never drags `customElements.define` into the service worker.
- Accept zod in the browser bundle; delete the lite-wire shim, esbuild shim plugin, `wire:check` drift gate, and `.size-limit.json` size gate. Tradeoff recorded in README.

## Verification
- `bun run test` → 282 passing
- `typecheck`, `lint`, `format:check`, `build:chrome`, `build:safari`, `e2e:chrome` green
- `dist/sw.js` contains no `customElements` reference

Spec: `docs/superpowers/specs/2026-06-05-flatten-hexagon-design.md`
Plan: `docs/superpowers/plans/2026-06-05-flatten-hexagon.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Confirm CI is green on the PR**, then squash-merge to `master` (the project's definition of done).

---

## Self-review (plan vs. spec)

- **Spec coverage:** 3-package target (Tasks 1–6), single barrel (Task 0/1 barrel), zod-in-bundle + drop lite shim (Task 5), drop drift gate + size gate + shared-drift (Task 7), element-registration extraction for SW safety (Task 2 + Task 5 step 8 smoke check), no extension rename (kept throughout), dependency-direction invariants (Task 8 step 2), README note (added pre-plan; preserved in Task 8 step 4). All covered.
- **Placeholders:** none — every move has exact paths/commands; new-file contents are given in full.
- **Type/name consistency:** `registerContentElements` / `registerSettingsForm` used identically in Task 2 (definition), Task 5 (calls), and the SW smoke check. `@ai-dict/app` barrel path consistent. `test/fakes` export preserved (Task 0) and consumers repointed (Task 4).
- **Known soft spots flagged for the implementer:** exact test-file import-path fixes are rule-based (grep-then-fix) rather than enumerated per file, because the moves are mechanical and the compiler/tests will pinpoint each; the `test-contract` CI filter name (`wire` vs `wire-schema`) must match the moved test filename — verify in Task 7 step 3.
