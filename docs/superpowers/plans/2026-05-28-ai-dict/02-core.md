---
bundle: "02"
title: core
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["01"]
owns_files:
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - packages/core/src/types.ts
  - packages/core/src/ports.ts
  - packages/core/src/prompt-template.ts
  - packages/core/src/cache-policy.ts
  - packages/core/src/history-policy.ts
  - packages/core/src/default-template.ts
  - packages/core/src/wire-schema.ts
  - packages/core/src/error-mapper.ts
  - packages/core/src/workflow.ts
  - packages/core/src/index.ts
  - packages/core/wire-schema.snapshot.json
  - packages/core/test/fakes/**
  - packages/core/test/fixtures/gemini-responses/**
  - packages/core/test/*.test.ts
---

# Bundle 02 — core/ (pure domain)

**Purpose:** The browser-free hexagonal center: port interfaces, domain types, the lookup workflow orchestrator, pure policies (prompt-template, cache-policy LRU, history-policy FIFO), the default prompt template, the Gemini→`LookupError` mapper, and zod wire schemas with a committed JSON-schema snapshot. Ships shared fakes + fixtures consumed by downstream test suites. **Zero IO, zero browser API.** This bundle freezes the contracts the whole monorepo codes against.

## Lock protocol
Verify prereq `01-scaffold.md` has `status: DONE`. Flip this YAML → LOCKED, set `locked_by`/`locked_at`, commit `[02] lock`, `git pull --rebase`, abort on racing lock. Execute.

## Inputs
- Bundle 01 DONE: workspace resolution, `tsconfig.base.json`, eslint hex rules, vitest workspace.
- Spec §5.1, §5.2 (ports), §6.1 (wire/types), §6.9 (error map), §6.11 (cache key), §8.5 (wire snapshot), Appendix A (default template).

## Outputs (frozen contracts — see README contracts table)
- `ports.ts`: `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage`, `PublicSettings`, `Settings` (exactly per §5.2).
- `types.ts`: `LookupRequest`, `LookupResult`, `LookupError`, `SelectionEvent`, `AnchorRect`, `HistoryEntry` (§6.1).
- `workflow.ts`: `runLookupWorkflow(deps)` orchestrating steps [1]–[5] over ports only, incl. NO_KEY short-circuit (§6.7) and loading/result/error rendering.
- `prompt-template.ts`: substitutes only placeholders present in the template (data minimization, Appendix A list).
- `cache-policy.ts`: `deriveCacheKey` (FNV-1a 64-bit hex) + LRU (cap 1000) over `Storage`.
- `history-policy.ts`: append + paged list (`limit`/`cursor`) + clear; newest-first, cap 500 FIFO.
- `default-template.ts`: the Appendix A string.
- `error-mapper.ts`: `mapError` implementing the §6.9 table.
- `wire-schema.ts`: zod schemas for every `WireMessage`/`WireReply` variant + a snapshot exporter; `wire-schema.snapshot.json` committed.
- `test/fakes/**`: fake `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage`, re-exported as `@ai-dict/core/test/fakes`.
- `test/fixtures/gemini-responses/**`: success, INVALID_KEY (400+403), RATE_LIMIT (429 ±Retry-After), 5xx, malformed JSON, prompt-injection-in-markdown (§8.11).

## Definition of Done
- D1: All port interfaces + types compile and match §5.2 / §6.1 signatures exactly.
- D2: `runLookupWorkflow` happy path, cache-hit path, and NO_KEY short-circuit covered by tests using fakes.
- D3: `prompt-template` substitutes only present placeholders; absent placeholders (e.g. `{url}`) are NOT injected (data-minimization test).
- D4: `cache-policy` LRU evicts at cap 1000, `deriveCacheKey` is deterministic + collision-stable on fixtures; pure (no async crypto).
- D5: `history-policy` newest-first ordering, paging via cursor, cap-500 FIFO eviction, clear — all tested.
- D6: `error-mapper` maps every §6.9 row to the correct `code` + `retryable`; messages sanitized to ≤200 chars with key value scrubbed.
- D7: `wire-schema` zod schemas accept valid and reject malformed messages; `wire-schema.snapshot.json` regenerates identically (`pnpm wire:check` clean).
- D8: **[S1 security]** Neither `PublicSettings` nor any `WireReply` variant carries `apiKey`; a test asserts `apiKey` is absent from the `settings` reply schema.
- D9: Package coverage ≥ 90% (spec §8.2). Lint clean: `core/src/**` imports nothing from adapters/ui/extensions.

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** TDD: write failing test → run (fail) → minimal impl → run (pass) → commit, per file. Suggested internal order: types/ports → default-template → prompt-template → cache-policy → history-policy → error-mapper → wire-schema (+snapshot) → fakes → workflow.

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/core test --coverage` → all pass, coverage ≥ 90%.
- Run: `pnpm wire:check` → snapshot matches generated.

## Validate (sanity / no scope drift)
- `pnpm --filter @ai-dict/core typecheck` + `pnpm lint` clean (hex rule: no inward-facing imports).
- `git diff --stat` touches only `packages/core/**` (owned).
- No browser globals (`window`, `chrome`, `document`, `fetch`) referenced anywhere in `core/src`.
- No placeholder/TODO left in shipped source.

## Self-audit (run BEFORE sign-off)
- [ ] D1–D9 met with command evidence?
- [ ] [S1] `apiKey` provably absent from `PublicSettings` + wire replies?
- [ ] Pure: zero IO / zero browser API in `core/src`?
- [ ] Contracts (port + type + wire signatures) match README table exactly — downstream will freeze against them?
- [ ] Fakes re-exported as `@ai-dict/core/test/fakes`?
- [ ] Only `packages/core/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `02`.
