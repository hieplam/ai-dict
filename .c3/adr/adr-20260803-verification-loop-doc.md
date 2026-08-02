---
id: adr-20260803-verification-loop-doc
c3-seal: 41bf401d08dd0c6b9210ed758cb47fd65e6c06597bd156ec3cfd63635a8b2d12
title: verification-loop-doc
type: adr
goal: |-
    Make the merge/verification gate set for ai-dict a written, LLM-consultable artifact in two
    ratified places — the project `CLAUDE.md` (priority 1) and the C3 model (priority 2) — so a
    fresh session can answer "what must pass before merge, and what does each gate prove?" from one
    read, without re-deriving it from `.github/workflows/ci.yml` or past PR history, and so
    `c3 lookup`/`c3 read` on any governed rule surfaces its actual enforcing scanner/contract test.
status: implemented
date: "2026-08-03"
---

## Goal

Make the merge/verification gate set for ai-dict a written, LLM-consultable artifact in two
ratified places — the project `CLAUDE.md` (priority 1) and the C3 model (priority 2) — so a
fresh session can answer "what must pass before merge, and what does each gate prove?" from one
read, without re-deriving it from `.github/workflows/ci.yml` or past PR history, and so
`c3 lookup`/`c3 read` on any governed rule surfaces its actual enforcing scanner/contract test.

## Context

Audit 2026-08-02 (verification-loop campaign) confirmed no artifact defines the verification
loop as policy: `.github/workflows/ci.yml` encodes the mechanism (jobs, commands, thresholds),
but nothing tells a reader — human or LLM — which gates are hard vs. review-enforced, that
`gh pr checks` is the merge-gate substitute (this private repo is on the free plan, so GitHub
branch protection is unavailable), how to triage a red check without guessing, or why
`dep-audit` is intentionally advisory on PRs and blocking only on the nightly schedule. Every
PR re-derives its "Testing performed" section and its flake-triage judgment by hand.

Campaign cards V2–V4 landed the mechanism this card documents: V2 moved the hard-rule scanners
into the discovered-by-filename `scripts/hard-rule/` folder (`scripts/check-dep-direction.mjs`
→ `scripts/hard-rule/check-dep-direction.mjs`, plus `run-all.mjs`); V3 added the S3
(`check-msg-gate.mjs`) and S4 (`check-safe-html.mjs`) hard-rule scanners; V4 closed e2e coverage
gaps. None of those cards updated C3: `rule-domain-purity`'s "Enforcement (mechanical)" section
still names the pre-move path `scripts/check-dep-direction.mjs`, and `rule-api-key-isolation`,
`rule-gate-runtime-messages`, `rule-sanitize-model-output`, `rule-typed-errors` have no
"Enforcement (mechanical)" section at all even though each now has a real scanner or named
contract test proving it. This ADR is documentation-only — no source, test, or CI file changes
(all gates already exist and were re-run verbatim to verify accuracy before writing this ADR,
per the campaign's evidence policy) — its Decision is entirely about where and how the existing
gate set is written down.

## Decision

Write the verification loop down in the two ratified places, in ratified priority order, plus
one imperative mirror:

1. **`CLAUDE.md` "Verification loop" section (priority 1, narrative/LLM-first)** — a gate
registry table (gate → command → what it proves → commit-time vs. CI-only), the hard/soft
boundary (hard = the `scripts/hard-rule/` folder + named contract tests, discovered by
filename so the registry IS the folder; soft = review-enforced, at minimum "adapters stay
thin and decision-free"), the merge gate (`gh pr checks` all green — the branch-protection
substitute), the flake-triage protocol (reproduce on `master` HEAD before waiving off a red
check; a docs-only diff may instead use a documented docs-only waiver), the
`dep-audit` PR-advisory/nightly-blocking split as deliberate design, and a pointer to
`docs/testing/e2e-case-inventory.md`.
2. **C3 model (priority 2, queryable)** — a new `ref-verification-loop` entity carrying the
same policy in Choice/Why/How shape, wired to every entity it governs (the 3 containers +
the 5 rule entities), so `c3 lookup`/`c3 read` surfaces it. Patch the 5 rule entities whose
Enforcement story is stale or missing an "Enforcement (mechanical)" section, mirroring
`rule-domain-purity`'s existing style, each naming its real scanner file and/or contract
test.
3. **`.claude/rules/workflow-conventions.md`** — add the merge-gate line and the flake-triage
line to the `## Always` checklist, as an imperative mirror only (CLAUDE.md stays the
narrative source; this file already declares itself a checklist that "complements" it).

CLAUDE.md leads because an LLM session reads it unconditionally at session start (no query
needed); C3 follows because it is the durable, queryable architecture record that later
`c3 lookup`/`c3 check` runs depend on, and because the 5 rule entities' Enforcement sections
must not drift further from what `scripts/hard-rule/` actually contains.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-0 | system | CLAUDE.md and .claude/rules/workflow-conventions.md are system-level (repo-root) documentation, not container/component code; this ADR's CLAUDE.md + C3 changes are system-scoped | c3 check after doc writes; no code-map, no source diff |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | ref-verification-loop wires to the rule entities that mechanize this ref (rule-domain-purity); must not restate or contradict its Choice | comply |
| ref-wire-protocol-validation | The gate registry names the wire-schema contract tests (incl. the typed-errors wire-flatten contract) that prove this ref's schemas hold at runtime | comply |
| ref-dependency-injection | Cited by several components under c3-1/c3-2/c3-3, which this ADR wires ref-verification-loop to for governance-coverage purposes only; no injection site, port, or adapter changes | N.A - no injection-site change; documentation-only card |
| ref-kv-storage-prefixes | Cited by components under c3-1/c3-2/c3-3 for the same wiring reason; no storage key/prefix changes | N.A - no storage-shape change; documentation-only card |
| ref-web-components-shadow-dom | Cited by UI components under c3-1/c3-2/c3-3 for the same wiring reason; no UI/shadow-DOM changes | N.A - no UI-surface change; documentation-only card |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-domain-purity | Its "Enforcement (mechanical)" section names the pre-move script path scripts/check-dep-direction.mjs; must be corrected to scripts/hard-rule/check-dep-direction.mjs and to name check-core-agnostic.mjs alongside it | update-rule |
| rule-api-key-isolation | Has no "Enforcement (mechanical)" section; must gain one naming scripts/hard-rule/check-key-isolation.mjs + check-key-isolation.test.ts, mirroring rule-domain-purity's style | update-rule |
| rule-gate-runtime-messages | Has no "Enforcement (mechanical)" section; must gain one naming scripts/hard-rule/check-msg-gate.mjs + check-msg-gate.test.ts (landed by campaign card V3) | update-rule |
| rule-sanitize-model-output | Has no "Enforcement (mechanical)" section; must gain one naming scripts/hard-rule/check-safe-html.mjs + check-safe-html.test.ts (landed by campaign card V3) | update-rule |
| rule-typed-errors | Has no "Enforcement (mechanical)" section; must gain one naming the ESLint @typescript-eslint/only-throw-error rule (throw form) and the packages/app/test/wire-schema.test.ts "typed-errors: wire-flatten contract" describe block (flatten form) | update-rule |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| CLAUDE.md | New "# Verification loop" section: gate registry table, hard/soft boundary, merge gate, flake-triage protocol, dep-audit note, e2e-case-inventory pointer — every command in the table re-run verbatim first | Gate output captured before writing; PR body "Testing performed" lists each command + result |
| .claude/rules/workflow-conventions.md | Two new ## Always lines: merge-gate (gh pr checks all green) + flake-triage (reproduce on master HEAD; docs-only waiver) | Diff review; imperative mirror only, no new source of truth |
| ref-verification-loop (new C3 ref) | Goal/Choice/Why/How authored to c3 schema ref; wired to c3-1, c3-2, c3-3, and the 5 rule entities | c3 read ref-verification-loop --full; c3 check green |
| rule-domain-purity | "Enforcement (mechanical)" section 1 rewritten: scripts/check-dep-direction.mjs → scripts/hard-rule/check-dep-direction.mjs; add check-core-agnostic.mjs as a named second scanner | c3 read rule-domain-purity --full shows corrected path |
| rule-api-key-isolation | New "Enforcement (mechanical)" section naming check-key-isolation.mjs + its test | c3 read rule-api-key-isolation --full |
| rule-gate-runtime-messages | New "Enforcement (mechanical)" section naming check-msg-gate.mjs + its test | c3 read rule-gate-runtime-messages --full |
| rule-sanitize-model-output | New "Enforcement (mechanical)" section naming check-safe-html.mjs + its test | c3 read rule-sanitize-model-output --full |
| rule-typed-errors | New "Enforcement (mechanical)" section naming the ESLint rule + the wire-flatten contract test describe block | c3 read rule-typed-errors --full |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no c3x CLI/validator/schema/template change | This ADR only creates one ref entity and patches 5 rule entity bodies via c3 add ref / c3 write — no change to the c3x binary, its validators, schemas, hints, or templates | N.A - content-only; c3 check green after writes proves the existing validators accept the new content |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| CLAUDE.md "Verification loop" section | Read unconditionally at session start; an LLM merging a PR without first running gh pr checks is now contradicting a written instruction, not just an unstated norm | Section present; every command in it re-run and its result recorded in this card's PR body |
| ref-verification-loop + patched rule entities | c3 lookup <file> / c3 read <rule-id> on any governed file now surfaces the real enforcing scanner/contract test instead of a stale or missing path | c3 check green; c3 read on each of the 5 rule entities shows an "Enforcement (mechanical)" section |
| .claude/rules/workflow-conventions.md | Imperative checklist gains the two lines; the file's own header says it "complements" CLAUDE.md, so this is a mirror, not a fork | Diff review |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| C3 only, no CLAUDE.md section | CLAUDE.md is read unconditionally at session start; C3 requires a query. The spec's proof condition — "a fresh session can answer [...] from one read" — needs the narrative artifact, not just the queryable one |
| CLAUDE.md only, no C3 change | Would leave rule-domain-purity's Enforcement section pointing at a script path that has not existed since campaign card V2 — c3 lookup/c3 read would keep surfacing wrong information to any future session that queries C3 instead of reading CLAUDE.md |
| One combined rule-verification-loop entity instead of a ref + 5 patched rules | The verification loop is policy/rationale (why hard vs. soft, why gh pr checks, why dep-audit is advisory) — a ref's Choice/Why/How shape, not a single enforceable golden-pattern rule; the per-scanner Enforcement facts belong on the rule entities they already govern, not duplicated onto a new rule |
| Re-deriving the gate list from ci.yml at review time each PR (status quo) | This is the exact problem the audit found: manual re-derivation is what "no artifact defines the loop" means; leaving it as-is fails the card's own acceptance criterion |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A documented gate command drifts from the real CI command (e.g. ci.yml changes a flag) | Every command in the CLAUDE.md table was copied from ci.yml/package.json verbatim and re-run in a clean worktree before writing, not transcribed from the spec | Gate output pasted into this card's PR body under "Testing performed" |
| The new ref-verification-loop restates rule content instead of adding rationale (fails the ref Separation Test) | ref-verification-loop's Why section states WHY the CLAUDE.md/C3 split and the gh pr checks substitute were chosen (see Decision), not a restatement of what each scanner does — that stays on the rule entities | c3 check ref-separation validation green |
| Patched rule bodies drift from rule-domain-purity's existing Enforcement style, reading inconsistently | Each new Enforcement section is authored to mirror rule-domain-purity's exact heading ("Enforcement (mechanical, ... surfaces)") and numbered-list shape | Manual diff comparison against rule-domain-purity's current body during Phase 3 |

## Verification

| Check | Result |
| --- | --- |
| bun run lint (hard-rule scanners + eslint) | Re-run in a clean worktree checkout of origin/master; 6/6 scanners pass, eslint clean |
| bun run typecheck | Re-run; 3/3 packages clean |
| bun run format:check | Re-run; all files match Prettier |
| bun run --filter @ai-dict/app test | Re-run; 703/703 tests pass |
| bun run --filter @ai-dict/app test wire-schema | Re-run; 50/50 tests pass, incl. the typed-errors wire-flatten contract |
| bun run --filter '*' test -- --coverage | Re-run; app/extension-chrome/extension-safari all clear their own vitest.config.ts thresholds (90/80/90) |
| bun run build:chrome / bun run build:safari | Re-run; both build clean, scanners re-run first |
| bun run e2e:chrome (bunx playwright test against a GA4-env, non-GEMINI_API_KEY-tainted build) | Re-run; 140 passed, 11 skipped (env-gated media specs, excluded from the coverage metric) |
| bunx knip | Re-run; exit 0 (pre-existing config hints only, no dead-export/unused-dep failures) |
| c3 check | Green after ref-verification-loop creation and the 5 rule patches |
| c3 read ref-verification-loop --full | Readable; wired to c3-1, c3-2, c3-3, and the 5 rule entities |
