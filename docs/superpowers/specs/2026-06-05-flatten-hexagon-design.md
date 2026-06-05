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

Verified duplication — and the project even has a CI job (`shared-drift`) that *enforces*
these files staying byte-identical across `extension-chrome` and `extension-safari`, with a
comment anticipating this exact fix (*"hoist to a shared package if a 3rd consumer
appeared"*):

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
- The entire wire-schema shim/drift/size apparatus (see Decisions below).

## Non-Goals

- No behavior changes. This is a re-homing/de-duplication refactor, not a rewrite.
- No change to the shipped extension UX, manifest permissions, or store artifacts.
- No new features.
- **No rename of the extension packages.** `@ai-dict/extension-chrome` and
  `@ai-dict/extension-safari` keep their names and directories, to avoid churn in the
  release pipeline (`release.yml`, `RELEASE_CHECKLIST.md`), the Xcode sync script, and CI
  filters. The "3 packages" outcome is met by collapsing the three library packages into
  one.

## Key Decisions (locked with the user)

1. **Single merged library `@ai-dict/app`** absorbs `core` + `adapters-shared` + `shared-ui`
   plus the de-duplicated platform-agnostic extension files. Result: 3 packages total
   (`app`, `extension-chrome`, `extension-safari`).
2. **Single barrel export.** `@ai-dict/app` exposes one entry: `.` → `./src/index.ts`.
   Consumers import everything from `@ai-dict/app`. (Chosen over subpath exports for
   simplicity.)
3. **Accept zod in the browser bundle.** The full `zod` schema is imported directly by the
   extension entry points (`inbound.ts`). We accept the size cost (~250 kB unminified; zod
   v4 is tree-shakeable so the real hit is smaller). Recorded as a tradeoff in `README.md`
   ("Known tradeoffs"), to revisit if service-worker cold-start latency becomes a problem.
4. **Delete the lite shim.** `lite-wire-schema.ts` (both platforms) + their tests, and the
   esbuild `wire-schema-shim` plugin in both `esbuild.config.mjs`, are removed.
5. **Delete the drift gate.** `scripts/wire-check.mjs`, `wire-schema.snapshot.json`, the
   `wire:check` root script, the snapshot test in `wire-schema.test.ts`, and the CI
   `wire-schema-check` job are removed. The schema's accept/reject *behavior* is still
   covered by the rest of `wire-schema.test.ts`.
6. **Delete the size gate.** `.size-limit.json`, the `size` root script, and the CI
   `size-check` job are removed.

## Target Architecture

Three packages, strictly one-directional dependencies:

```
extension-chrome / extension-safari  →  app  →  ports  →  domain
```

Platforms implement the interfaces; `app` and `domain` never import a platform.

```
@ai-dict/app            (one shared library — everything platform-agnostic)
  src/index.ts          single barrel — re-exports the public surface
  src/domain/           types, workflow, cache-policy, history-policy,
                        error-mapper, prompt-template, default-template   ← pure
  src/ports.ts          the interfaces (the ONLY abstraction seam)        ← depends on domain
  src/wire.ts           zod schema — used by tests AND at runtime (inbound)
  src/app/              router, inbound, dom-selection-source,
                        gemini-lookup-client, message-relay-lookup-client,
                        markdown-sanitize, inline-bottom-sheet-renderer    ← depends on ports + domain
  src/ui/               bottom-sheet, lookup-card, lookup-trigger,
                        settings-form, styles/adopt                        ← depends on ports + domain

@ai-dict/extension-chrome   (thin shell)     @ai-dict/extension-safari   (thin shell)
  src/manifest.json                            src/manifest.json
  src/sw.ts  content.ts  options.ts            src/sw.ts  content.ts  options.ts
  src/content-elements.ts  side-panel.*        (no side-panel / content-elements)
  src/adapters/  (platform-specific only):     src/adapters/  (platform-specific only):
    chrome-storage-store, chrome-kv-store,       safari-storage-store, safari-kv-store,
    chrome-floating-trigger,                     safari-floating-trigger,
    chrome-side-panel-mirror,                    message-relay-settings-store
    message-relay-settings-store
  esbuild.config.mjs (no shim plugin)          esbuild.config.mjs (no shim plugin)
```

## File Map (old → new)

| New location (`@ai-dict/app/src/`) | Source |
|---|---|
| `domain/*` | all of `core/src/*` except `ports.ts`, `wire-schema.ts`, `index.ts` |
| `ports.ts` | `core/src/ports.ts` |
| `wire.ts` | `core/src/wire-schema.ts` (zod; now imported at runtime too) |
| `app/gemini-lookup-client.ts`, `app/markdown-sanitize.ts`, `app/inline-bottom-sheet-renderer.ts` | `adapters-shared/src/*` |
| `app/router.ts`, `app/inbound.ts`, `app/dom-selection-source.ts`, `app/message-relay-lookup-client.ts` | the identical chrome/safari copies (one survives) |
| `ui/*` | all of `shared-ui/src/*` |
| `index.ts` | new barrel re-exporting the public surface |

| Stays in `extension-chrome` / `extension-safari` | |
|---|---|
| `manifest.json`, `sw.ts`, `content.ts`, `options.ts`, `options.html` | platform entry points |
| chrome only: `content-elements.ts`, `side-panel.ts`, `side-panel.html` | platform entry points |
| platform adapters: storage-store, kv-store, floating-trigger, (chrome) side-panel-mirror, message-relay-settings-store | genuinely platform-specific |
| `esbuild.config.mjs` (shim plugin removed), `playwright.config.ts` (chrome) | build config |

**Deleted outright:**
- `packages/core`, `packages/adapters-shared`, `packages/shared-ui` (emptied into `app`).
- `{extension-chrome,extension-safari}/src/lite-wire-schema.ts` + their `.test.ts`.
- `scripts/wire-check.mjs`, `packages/core/wire-schema.snapshot.json`.
- `.size-limit.json`.
- Root scripts: `wire:check`, `size`.
- CI jobs: `wire-schema-check`, `size-check`, `shared-drift`.

## Package & Build Wiring

- **`@ai-dict/app/package.json`** `exports`: `{ ".": "./src/index.ts" }` (single barrel),
  `dependencies` carry `zod`, `marked`, `dompurify` (from the old lib packages); dev deps
  carry `happy-dom`, `axe-core`.
- **`extension-chrome` / `extension-safari` `package.json`:** replace the three
  `@ai-dict/{core,shared-ui,adapters-shared}` deps with a single `@ai-dict/app: workspace:*`.
- **Both `esbuild.config.mjs`:** delete the `wire-schema-shim` plugin and its `onResolve`
  hook; the bundle resolves `@ai-dict/app` normally (zod included).
- **`inbound.ts` (both platforms):** import `WireMessageSchema` / `WireReplySchema` from
  `@ai-dict/app` directly (the real zod schema) — same validation, no shim.
- **Root `package.json`:** remove `wire:check` and `size` scripts; `build:chrome`,
  `build:safari`, `e2e:chrome` filters unchanged (extension package names unchanged).
- **`.github/workflows/ci.yml`:** delete `wire-schema-check`, `size-check`, `shared-drift`
  jobs; re-point `test-contract` and the `shared-ui` job from `@ai-dict/{core,shared-ui}` to
  `@ai-dict/app`; update any `needs:` references accordingly.
- **`knip.json`, `tsconfig.base.json`, `vitest.config.ts`:** update any path/workspace
  globs that name the deleted packages.

## Dependency-Direction Invariants

After the move these must hold (eslint `import-x` boundary rules where configured, else
review):

- `domain/*` imports nothing from `ports`, `app`, `ui`, or any platform.
- `ports.ts` imports only from `domain`.
- `app/*` and `ui/*` import only from `domain` + `ports` (+ third-party).
- `extension-chrome` / `extension-safari` import from `@ai-dict/app` only — never each other.

## Migration Approach (refactor under green tests)

Small, independently-verifiable steps; tests stay green at each step.

1. Scaffold `@ai-dict/app` (package.json, tsconfig, vitest.config, empty `src/`).
2. Move `core` → `app/{domain,ports,wire}` + tests; add barrel `index.ts`; rewire the two
   extensions' `@ai-dict/core` imports to `@ai-dict/app`; `bun run test` green.
3. Move `shared-ui` → `app/ui` + tests; rewire; green.
4. Move `adapters-shared` → `app/app/*` + tests; rewire; green.
5. Move the **identical** chrome/safari files (`router`, `inbound`, `dom-selection-source`,
   `message-relay-lookup-client`) into `app/app/*`; delete the duplicates; rewire both
   extensions; delete the `shared-drift` CI job; green.
6. Delete the lite shims + tests; remove the esbuild `wire-schema-shim` from both configs;
   point `inbound.ts` at the real zod schema; `bun run build:chrome` + `build:safari`
   succeed.
7. Delete the drift gate (`wire-check.mjs`, snapshot, snapshot test, `wire:check` script,
   CI `wire-schema-check`) and the size gate (`.size-limit.json`, `size` script, CI
   `size-check`). Add the README "Known tradeoffs" note.
8. Delete the now-empty `core`, `adapters-shared`, `shared-ui` packages; update
   `ci.yml`, `knip.json`, `tsconfig.base.json`, `vitest.config.ts`, `RELEASE_CHECKLIST.md`
   references.
9. Full gate: `bun run test`, `typecheck`, `lint`, `format:check`, `e2e:chrome`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Builds break from import-path churn | One package moved per step; per-step `typecheck` + `test`. |
| zod bundling breaks the build (unlikely) | `bun run build:chrome`/`build:safari` in step 6 must succeed before proceeding. |
| Service-worker cold-start latency from zod | Accepted + documented in README; out of scope to fix now. |
| e2e (Chrome) breaks from entry/manifest changes | Manifests + entry points stay in place; run `e2e:chrome` in step 9. |
| Dangling references to deleted packages/gates | Grep sweep in step 8 across CI, knip, tsconfig, release docs, scripts. |
| Behavior regression in message validation | `wire-schema.test.ts` behavior tests + `inbound.test.ts` (both platforms) must stay green. |

## Definition of Done

- 3 packages (`app`, `extension-chrome`, `extension-safari`); `core`, `adapters-shared`,
  `shared-ui` deleted.
- No duplicated source between the two extensions; `shared-drift` job removed.
- One `wire.ts` (zod), imported by tests and runtime; no shim, no drift gate, no size gate.
- README "Known tradeoffs" note present.
- All remaining gates green: `test` (≥282), `typecheck`, `lint`, `format:check`,
  `e2e:chrome`.
- Dependency-direction invariants hold.
- No dangling references to deleted packages/scripts/jobs (grep-clean).
- PR opened and squash-merged to `master`.
