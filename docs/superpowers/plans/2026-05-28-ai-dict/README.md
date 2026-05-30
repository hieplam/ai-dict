# AI Dictionary — Main Plan (Orchestrator)

> **Orchestrator file. Subagents do NOT read this.** The main agent uses it for dispatch + status only. Each subagent reads its own `NN-*.md` sub-plan and (optionally) its prereqs' YAML frontmatter.

**Spec:** `../../specs/2026-05-24-ai-dict-design.md`
**Plan style:** Split into isolated, dependency-aware sub-plans (`splitting-plans` Option B). Each skeleton is filled with TDD content by a per-bundle `writing-plans` pass before execution.
**Execution:** `superpowers:subagent-driven-development` — fresh subagent per bundle, two-stage review, worktree per subagent (`superpowers:using-git-worktrees`).

---

## Goal

Two BYOK browser extensions (Chrome MV3 desktop + Safari iOS Web Extension) that look up word/phrase meaning in-page via Google Gemini, sharing a pure hexagonal `core/` plus shared UI and adapters. No backend, no accounts, no telemetry.

## Architecture (recap)

```
ai-dict/                         ← Bundle 01 (scaffold) owns root config
├── packages/
│   ├── core/                    ← Bundle 02 — DOMAIN. Pure. Zero IO. Zero browser API.
│   ├── shared-ui/               ← Bundle 03 — presentational Web Components only
│   ├── adapters-shared/         ← Bundle 04 — platform-free port impls (uses shared-ui)
│   ├── extension-chrome/        ← Bundle 05 — Chrome MV3 extension + Playwright e2e
│   └── extension-safari/        ← Bundle 06 — Safari iOS web ext + Xcode wrapper
└── .github/, scripts/, *.config ← Bundle 07 (ci-release)
```

Hex dependency rule (lint-enforced, §8.3 of spec): `core` imports nothing inward; `shared-ui` imports core **types only**; `adapters-shared` may not import `extension-*`; `extension-*/test` must inject ports via fakes.

## Dispatch protocol

Self-picking queue. A subagent:
1. Reads the **Bundle index** below. Picks the first bundle whose `status: AVAILABLE` AND every listed prereq is `status: DONE`.
2. Locks it (see each sub-plan's Lock protocol) — flip YAML to `LOCKED` + `locked_by` + `locked_at`, commit atomically, `git pull --rebase` to detect a racing lock; abort if lost.
3. Executes the sub-plan's Implementation steps (filled by `writing-plans`).
4. Runs the three-stage gate (Verify → Validate → Self-audit) before flipping `DONE`.
5. On completion, flips YAML `status: DONE` + `done_at`, commits, and updates the checkbox below.

A bundle may only be filled with TDD code (`writing-plans`) once all its prereqs are filled, so its frozen contracts are stable.

## Bundle index (status board)

- [x] 01 — scaffold          → `01-scaffold.md`          — prereqs: none
- [x] 02 — core              → `02-core.md`              — prereqs: 01
- [x] 03 — shared-ui         → `03-shared-ui.md`         — prereqs: 02
- [x] 04 — adapters-shared   → `04-adapters-shared.md`   — prereqs: 02, 03
- [x] 05 — extension-chrome  → `05-extension-chrome.md`  — prereqs: 02, 03, 04
- [ ] 06 — extension-safari  → `06-extension-safari.md`  — prereqs: 02, 03, 04
- [ ] 07 — ci-release        → `07-ci-release.md`        — prereqs: 05, 06

## Dependency waves

```
Wave A:  01 scaffold
Wave B:  02 core
Wave C:  03 shared-ui
Wave D:  04 adapters-shared
Wave E:  05 extension-chrome   ∥   06 extension-safari      ← only true parallel wave (max parallelism = 2)
Wave F:  07 ci-release
```

The hexagonal chain is mostly linear. The single genuine fan-out is **chrome ∥ safari** in Wave E (disjoint `owns_files`, shared read-only deps). All other waves are single-bundle.

## Cross-bundle contracts (single source of truth — drift control)

A subagent that changes any identifier below MUST update every dependent bundle's sub-plan in the same pass. Once a defining bundle is `DONE`, its contract is frozen for downstream bundles.

| Identifier | Defined in | Used by |
|---|---|---|
| Package names `@ai-dict/core`, `@ai-dict/shared-ui`, `@ai-dict/adapters-shared` | 01 (workspace) + each pkg `package.json` | downstream importers (03–07) |
| Port interfaces: `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage` (signatures per spec §5.2) | 02 `core/src/ports.ts` | 03, 04, 05, 06 |
| Domain types: `LookupRequest`, `LookupResult`, `LookupError`, `Settings`, `PublicSettings`, `SelectionEvent`, `AnchorRect`, `HistoryEntry` (spec §6.1) | 02 `core/src/types.ts` | all |
| Wire types + zod schemas: `WireMessage`, `WireReply` + `wire-schema.snapshot.json` (spec §6.1, §8.5) | 02 `core/src/wire-schema.ts` | 05, 06; 07 (`pnpm wire:check`) |
| `runLookupWorkflow(deps)` orchestrator signature (spec §5.6) | 02 `core/src/workflow.ts` | 05, 06 composition roots |
| `deriveCacheKey(req)` + `fnv1a64Hex` (spec §6.11) | 02 `core/src/cache-policy.ts` | 05, 06 (SW cache) |
| `mapError(...)` Gemini→`LookupError.code` table (spec §6.9) | 02 (error mapper) | 04 (gemini client), 05, 06 (SW) |
| Web Component tags + events: `<lookup-trigger>` (`lookup-click`), `<lookup-card state>` (`close`,`expand`), `<bottom-sheet>` (`dismiss`), `<settings-form>` (`save`,`clear-cache`,`clear-history`,`test-connection`,`export-history`) (spec §5.3) | 03 `shared-ui` | 04 (renderer), 05, 06 |
| Default prompt template + supported placeholders `{word}`,`{context}`,`{target_lang}`,`{source_lang}`,`{url}`,`{title}` (spec Appendix A) | 02 `core/src/default-template.ts` + `prompt-template.ts` | 05, 06 (options page) |
| Root `package.json` script names: `test`, `lint`, `typecheck`, `build`, `wire:check`, `size`, `release:bump` | 01 | 07 (CI jobs invoke them) |
| `tsconfig.base.json` compiler flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); eslint hex `no-restricted-paths` rules (spec §8.3, §8.6) | 01 | every package extends/obeys; 07 lint job |
| Per-package coverage thresholds — core 90 / adapters-shared 90 / shared-ui 75 / extension-chrome 80 / extension-safari 90 (spec §8.2) | spec | each pkg sets own `vitest.config`; 07 coverage-gate enforces |
| Manifest permission lists + strict CSP (spec §7.3 S5, S8) | spec | 05, 06 manifests; 07 release checklist verifies |
| Bundle size budgets (spec §8.7) | spec | 05, 06 (build outputs); 07 `.size-limit.json` |
| Gemini endpoint + model `gemini-2.5-flash`, header `X-Goog-Api-Key` (spec §7.3 S2) | spec | 04 gemini client |

## Security invariants (carried as DoD items in the named bundles)

- **S1 key isolation** — `apiKey` never appears in `PublicSettings`, never crosses the wire, never reaches content scripts. Enforced in: 02 (types/wire schema exclude it), 05/06 (relay adapters receive `PublicSettings` only; options page writes key direct to `storage.local`).
- **S3 sender check** — SW listener guards `sender.id === chrome.runtime.id`; no `externally_connectable`. Enforced in 05/06 sw-router.
- **S4 XSS** — Gemini Markdown rendered with raw-HTML-disabled renderer + DOMPurify allowlist. Enforced in 04 (`inline-bottom-sheet-renderer`) / 03 (`<lookup-card>`).
- **S5 CSP / S8 permissions** — strict CSP + minimal permissions in manifests. Enforced in 05/06; verified in 07.

## Three-stage quality gate (every sub-plan, before sign-off)

| Gate | Purpose | This project |
|---|---|---|
| **Verify** | Prove DoD directly | `pnpm --filter <pkg> test` (vitest), targeted unit/component/e2e |
| **Validate** | Catch silent regression / scope drift | `pnpm --filter <pkg> typecheck` + `lint` (hex rules), `git diff --stat` (only owned files), no TODO/placeholder grep |
| **Self-audit** | Final sweep against DoD checklist | re-read DoD D1..Dn, tick each, confirm security invariants, then flip `DONE` |

Any gate failing → status stays `LOCKED` or moves to `BLOCKED` (with reason). Never flip `DONE` on partial.

## Main-plan self-audit

- [ ] Every bundle owns disjoint files (root / per-package dir / `.github`+scripts)? — yes
- [ ] Every shared identifier listed in the contracts table? — yes (ports, types, wire, tags, scripts, budgets, CSP)
- [ ] Waves diagram matches the `prereqs` in each sub-plan's YAML? — verify after skeleton generation
- [ ] No bundle reaches into another bundle's owned files? — yes (downstream deps are read-only imports, not edits)
- [ ] No spec requirement silently dropped? — coverage map maintained below
- [ ] No bundle added outside the spec's scope? — 7 bundles map 1:1 to spec packages + scaffold + CI; no extras
- [ ] Security invariants (S1–S5) assigned to specific bundles? — yes (see section above)
- [ ] Parallelism claim honest? — yes; only Wave E (chrome ∥ safari) is parallel, stated explicitly

## Spec coverage map (requirement → bundle)

| Spec section | Bundle(s) |
|---|---|
| §4.2 monorepo layout / workspaces | 01 |
| §5.1 core files; §6.1 types; §6.11 cache key; §8.5 wire schema | 02 |
| §5.3 Web Components + a11y (§7.5) | 03 |
| §5.1 `gemini-lookup-client`, `inline-bottom-sheet-renderer`; §7.3 S4 sanitize | 04 |
| §5.4 Chrome extension (sw/content/adapters/options/side-panel); §6.3–6.10 flows; §7.3 S1–S11; §8.1 e2e-chrome | 05 |
| §5.5 Safari extension + Xcode wrapper; §8.1 manual iOS checklist; §8.10 ios checklist file | 06 |
| §8.6 static analysis; §8.7 size budgets; §8.9 CI; §8.10 release flow + RELEASE_CHECKLIST | 07 |

> **Non-goals confirmed unbuilt:** no macOS Safari target, no Chrome-on-iOS, no backend, no telemetry, no TTS, no automated Safari E2E (manual checklist only), no UI localization. (spec §2, §8.12)
