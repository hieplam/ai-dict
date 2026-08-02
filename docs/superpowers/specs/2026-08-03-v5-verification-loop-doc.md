# V5 — the explicit verification loop (verification-loop campaign, card 5)

**Depends on:** V2, V3, V4 (documents the final gate set — must land last).

**Goal (measurable):** the verification loop exists as a written, LLM-consultable artifact in
two places (ratified priority order): (1) the project `CLAUDE.md`, (2) the C3 model. Proof: a
fresh session can answer "what must pass before merge, and what does each gate prove?" from one
read, without re-deriving anything; `c3 check` green after the C3 changes.

**Why:** audit 2026-08-02 confirmed no artifact defines the loop — every PR re-derives its
"Testing performed" reasoning and its flake-triage judgment by hand. Mechanism exists (CI YAML);
policy does not.

## Ratified content (owner 2026-08-02/03 + delegated Shaman rulings)

### 1. Project `CLAUDE.md` — new "Verification loop" section (priority 1)

Must contain, concisely:

- **The gate registry table**: every gate → command → what it proves. Gates: hard-rule scanners
  (each scanner listed by rule), eslint, typecheck, format, unit suite, wire-schema contract
  tests (incl. the flatten test), coverage-gate, builds (chrome+safari), e2e suite, knip,
  gitleaks. Note which run at commit time (pre-commit: format + lint) vs CI.
- **The hard/soft boundary, explicit**: hard rules = `scripts/hard-rule/` folder + named
  contract tests (the registry IS the folder). Soft rules listed by name with "review-enforced"
  label — at minimum "adapters stay thin and decision-free" (ratified soft).
- **The merge gate**: GitHub branch protection is unavailable (private repo, free plan —
  ratified skip); the substitute is a hard workflow rule: **merge only after `gh pr checks`
  reports every check green**. An LLM performing a merge MUST run it first.
- **The flake-triage protocol**: a red check may be waved off ONLY after reproducing the same
  failure on current `master` HEAD; the waiver and its evidence go in the PR body. Docs-only
  changes may use the documented docs-only waiver.
- **Deliberate-advisory note**: `dep-audit` is advisory on PRs and blocking nightly — by
  ratified design, not neglect.
- **Pointer** to `docs/testing/e2e-case-inventory.md` (the e2e coverage floor + zero-flake wall)
  and to this campaign's specs for the "why".

### 2. C3 model (priority 2) — via the c3 CLI ONLY (never hand-edit `.c3/`)

- ADR for this change (the ADR is the change-unit), then:
- New `ref-verification-loop` entity carrying the same policy in C3's Choice/Why/How shape,
  wired to the entities it governs.
- Patch the existing rule entities (frozen facts → change-unit patches) whose Enforcement story
  changed: rule-domain-purity (script path moved), rule-api-key-isolation, rule-gate-runtime-
  messages, rule-sanitize-model-output, rule-typed-errors — each now names its scanner/contract
  test, mirroring rule-domain-purity's "Enforcement (mechanical)" section style.
- `c3 check` green afterwards.

### 3. `.claude/rules/workflow-conventions.md`

Add the merge-gate line ("merge only after `gh pr checks` all green") and the flake-triage rule
to the Always list; keep it an imperative mirror of CLAUDE.md, not a second source of truth.

## Out of scope

Any code or CI change (all landed in V1–V4). No new gates invented here — this card only writes
down what now exists.

## Acceptance

1. CLAUDE.md section present, accurate against the ACTUAL merged state of V1–V4 (verify each
   gate name/command by running it, not from this spec).
2. `c3 check` green; new ref readable via `c3 read ref-verification-loop`; each patched rule
   names its mechanical gate.
3. PR body: "Testing performed" (for a docs card: gates run to verify accuracy + c3 check).
