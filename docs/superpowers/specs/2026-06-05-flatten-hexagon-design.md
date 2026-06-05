# Flatten the Hexagon — Architecture Simplification

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan
**Branch:** `worktree-simplify-hexagon`

## Problem

The codebase is a small browser extension ("AI Dictionary": select text → look it up via
Gemini → render a card), shipped to Chrome and Safari. It is built with a full hexagonal
(ports-and-adapters) architecture spread across **5 packages**. For ~3,700 lines of source,
this is over-engineered: the layering forces **file duplication** across the two extension
packages and a multi-package indirection that adds navigation cost without adding value.

Verified duplication (byte-for-byte identical between `extension-chrome` and `extension-safari`):

- `src/router.ts` (153 lines each)
- `src/inbound.ts`
- `src/adapters/dom-selection-source.ts`
- `src/adapters/message-relay-lookup-client.ts`

## Goal

Keep the principles that earn their keep, drop the ceremony that does not.

**Keep:**
- **One-directional dependency flow.**
- **Abstraction via interfaces** (the `ports.ts` seam).
- **Pure domain** (no platform/UI imports).
- **Full test coverage** — refactor under green tests (baseline: 282 tests passing).

**Drop:**
- Multi-package indirection (5 → 3 packages).
- Per-platform file duplication.
- The duplicated lite-schema definitions (3 schema files in 2 packages → 2 files in 1).

## Non-Goals

- No behavior changes. This is a re-homing/de-duplication refactor, not a rewrite.
- No change to the shipped extension UX, manifest permissions, or store artifacts.
- No new features.

## Target Architecture

Three packages, strictly one-directional dependencies:

```
chrome / safari  →  app  →  ports  →  domain
```

Platforms implement the interfaces; `app` and `domain` never import a platform.

```
@ai-dict/app            (one shared library — everything platform-agnostic)
  src/domain/           types, workflow, cache-policy, history-policy,
                        error-mapper, prompt-template, default-template   ← pure
  src/ports.ts          the interfaces (the ONLY abstraction seam)        ← depends on domain
  src/wire.ts           full zod schema — TESTS + JSON-schema source
  src/wire-lite.ts      zero-zod runtime shim (the unified, stricter one)
  src/app/              router, inbound, dom-selection-source,
                        gemini-lookup-client, message-relay-lookup-client,
                        markdown-sanitize, inline-bottom-sheet-renderer    ← depends on ports + domain
  src/ui/               bottom-sheet, lookup-card, lookup-trigger,
                        settings-form, styles/adopt                        ← depends on ports + domain

@ai-dict/chrome         (thin shell)         @ai-dict/safari        (thin shell)
  src/manifest.json                            src/manifest.json
  src/sw.ts  content.ts  options.ts            src/sw.ts  content.ts  options.ts
  src/content-elements.ts  side-panel.*        (no side-panel / content-elements)
  src/adapters/  (platform-specific only):     src/adapters/  (platform-specific only):
    chrome-storage-store, chrome-kv-store,       safari-storage-store, safari-kv-store,
    chrome-floating-trigger,                     safari-floating-trigger,
    chrome-side-panel-mirror,                    message-relay-settings-store
    message-relay-settings-store
  esbuild.config.mjs (shim → app/wire-lite)    esbuild.config.mjs (shim → app/wire-lite)
```

## Wire-Schema: Why It Survives (Corrected Understanding)

This subsystem looked like ceremony but is doing real work:

1. **`wire.ts` (full zod) must NOT ship to the browser.** zod is ~250 kB; the bundle has a
   hard budget (`.size-limit.json`: `sw.js ≤ 30 kB gzip`). The build swaps `core`'s
   `./wire-schema` import for the dependency-free `wire-lite.ts` shim via an esbuild
   `onResolve` plugin. The full zod schema is used only in tests + JSON-schema generation.
2. **The drift gate (`scripts/wire-check.mjs` + `wire-schema.snapshot.json`) guards that the
   zod schema and the hand-rolled lite shim stay in agreement.** Two parallel hand-maintained
   definitions can drift. **The gate stays** (re-pointed at `app`). It is one script + one
   snapshot and guards a real divergence.

**Latent bug fixed in passing:** chrome's and safari's lite shims had diverged. Chrome's used
a loose `{ word: string; [k: string]: unknown }` that lets unknown extra fields survive the
strip; safari's reconstructs from a field whitelist (`word, context, url, title, target,
promptTemplate`). Unifying to **safari's stricter version** fixes the chrome path. This
preserves the security invariant **[S1]**: the message boundary must drop unknown keys
(notably never let `apiKey` cross), enforced at runtime by `wire-lite.ts`'s field whitelist.

## File Map (old → new)

| New location (`@ai-dict/app/src/`) | Source |
|---|---|
| `domain/*` | all of `core/src/*` except `ports.ts`, `wire-schema.ts`, `index.ts` |
| `ports.ts` | `core/src/ports.ts` |
| `wire.ts` | `core/src/wire-schema.ts` |
| `wire-lite.ts` | unified from `{chrome,safari}/src/lite-wire-schema.ts` (safari's stricter form) |
| `app/gemini-lookup-client.ts`, `app/markdown-sanitize.ts`, `app/inline-bottom-sheet-renderer.ts` | `adapters-shared/src/*` |
| `app/router.ts`, `app/inbound.ts`, `app/dom-selection-source.ts`, `app/message-relay-lookup-client.ts` | the identical chrome/safari copies (one survives) |
| `ui/*` | all of `shared-ui/src/*` |

| Stays in `@ai-dict/chrome` / `@ai-dict/safari` | |
|---|---|
| `manifest.json`, `sw.ts`, `content.ts`, `options.ts`, `options.html` | platform entry points |
| chrome only: `content-elements.ts`, `side-panel.ts`, `side-panel.html` | platform entry points |
| platform adapters: storage-store, kv-store, floating-trigger, (chrome) side-panel-mirror, message-relay-settings-store | genuinely platform-specific |
| `esbuild.config.mjs`, `playwright.config.ts` (chrome) | build config, re-pointed at `app/wire-lite.ts` |

**Net result:** 5 packages → 3; ~6 duplicate files deleted; 3 wire files in 2 packages → 2
files in 1; one latent strip-bug fixed.

## Package Wiring

- `@ai-dict/app` `exports` map: `.` → `./src/index.ts` plus subpath exports for `./ports`,
  `./wire`, `./wire-lite`, `./ui`, and the `./app/*` modules consumers need (mirrors the
  existing subpath-export convention in `core`/`adapters-shared`/`shared-ui`).
- `chrome` and `safari` `package.json`: replace the three `@ai-dict/{core,shared-ui,
  adapters-shared}` deps with a single `@ai-dict/app: workspace:*`.
- Both esbuild configs: shim plugin redirects `app`'s `./wire` (or `./wire-lite` import seam)
  to `app/src/wire-lite.ts`. Confirm the resolve-dir filter matches the new `app` location.
- `scripts/wire-check.mjs`: re-point the filter from `@ai-dict/core` to `@ai-dict/app`.
- Root `package.json` build/test scripts already use `--filter` globs; verify the renamed
  package filters (`build:chrome`, `build:safari`, `e2e:chrome`) still resolve.

## Dependency-Direction Invariants (enforceable)

After the move, these must hold (checked by eslint `import-x`/`no-restricted-imports` where
the project already configures boundaries, otherwise by review):

- `domain/*` imports nothing from `ports`, `app`, `ui`, or any platform.
- `ports.ts` imports only from `domain`.
- `app/*` and `ui/*` import only from `domain` + `ports` (+ third-party).
- `chrome`/`safari` import from `@ai-dict/app` only — never from each other.

## Migration Approach (refactor under green tests)

Move in small, independently-verifiable steps; tests stay green at each step. Order:

1. Scaffold `@ai-dict/app` package (package.json, tsconfig, vitest.config) — no code yet.
2. Move `core` → `app/{domain,ports,wire}` + tests; update `core` consumers' imports;
   `bun run test` green.
3. Move `shared-ui` → `app/ui` + tests; rewire; green.
4. Move `adapters-shared` → `app/app/*` + tests; rewire; green.
5. Move the **identical** chrome/safari files (`router`, `inbound`, `dom-selection-source`,
   `message-relay-lookup-client`) into `app/app/*`; delete the duplicates; rewire both
   extensions' imports; green.
6. Unify the two lite shims into `app/wire-lite.ts` (safari's form); re-point both esbuild
   configs + `wire-check.mjs`; `bun run wire:check` green; `bun run build:chrome` +
   `build:safari` succeed; `bun run size` within budget.
7. Delete the now-empty `core`, `adapters-shared`, `shared-ui` packages.
8. Full gate: `bun run test`, `typecheck`, `lint`, `format:check`, `wire:check`, `size`,
   and `e2e:chrome`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Bundle size regression (zod leaks into browser) | `bun run size` gate in step 6 + step 8; esbuild shim re-pointed and verified. |
| Lite-shim unification changes strip behavior | Adopt safari's stricter form (superset-correct); existing lite-wire-schema tests must pass; add a test asserting `apiKey` never survives. |
| Import path churn breaks builds | Per-step `typecheck` + `test`; one package moved per step. |
| e2e (Chrome) breaks from manifest/entry changes | Manifest + entry points stay in place; run `e2e:chrome` in step 8. |
| Release pipeline (`release.yml`, `RELEASE_CHECKLIST.md`) references old package names | Audit and update references as part of step 7. |

## Definition of Done

- 3 packages (`app`, `chrome`, `safari`); `core`, `adapters-shared`, `shared-ui` deleted.
- No duplicated source between `chrome` and `safari`.
- One `wire.ts` + one `wire-lite.ts`, both in `app`; drift gate green.
- All gates green: `test` (≥282), `typecheck`, `lint`, `format:check`, `wire:check`, `size`,
  `e2e:chrome`.
- Dependency-direction invariants hold.
- PR opened and squash-merged to `master`.
