---
id: ref-verification-loop
c3-seal: c584af609916dd7d5dc9a285c2cb80339378f3920411e607eba053d8f6de306b
title: verification-loop
type: ref
goal: |-
    Give every session — human or LLM, mid-conversation or fresh — one answer to "what must pass
    before merge, and what does each gate prove?" without re-deriving it from
    `.github/workflows/ci.yml`, `package.json` scripts, or past PR history each time. The recurring
    need this standardizes: a gate can exist in CI (mechanism) for months before anyone writes down
    *why* it exists, whether it is hard or review-enforced, or what to do when it goes red — and
    the rule entities describing individual gates (e.g. `rule-domain-purity`) can silently drift
    from the scanner path they claim to enforce once the scanner moves (as happened when campaign
    card V2 moved `scripts/check-dep-direction.mjs` to `scripts/hard-rule/check-dep-direction.mjs`
    without updating C3).
uses:
    - c3-1
    - c3-2
    - c3-3
    - rule-api-key-isolation
    - rule-domain-purity
    - rule-gate-runtime-messages
    - rule-sanitize-model-output
    - rule-typed-errors
---

## Goal

Give every session — human or LLM, mid-conversation or fresh — one answer to "what must pass
before merge, and what does each gate prove?" without re-deriving it from
`.github/workflows/ci.yml`, `package.json` scripts, or past PR history each time. The recurring
need this standardizes: a gate can exist in CI (mechanism) for months before anyone writes down
*why* it exists, whether it is hard or review-enforced, or what to do when it goes red — and
the rule entities describing individual gates (e.g. `rule-domain-purity`) can silently drift
from the scanner path they claim to enforce once the scanner moves (as happened when campaign
card V2 moved `scripts/check-dep-direction.mjs` to `scripts/hard-rule/check-dep-direction.mjs`
without updating C3).

## Choice

A two-artifact, ratified-priority verification loop, not a single document:

1. **`CLAUDE.md` "Verification loop" section — priority 1.** The narrative, LLM-first gate
registry: every gate → its exact command → what it proves → whether it runs at commit time
or CI-only; the hard/soft boundary (hard = `scripts/hard-rule/` folder, discovered by
filename, plus named contract tests; soft = review-enforced by name); the merge gate
(`gh pr checks` all green — this private, free-plan repo has no GitHub branch protection);
the flake-triage protocol (reproduce on `master` HEAD before waiving a red check, or use the
documented docs-only waiver); `dep-audit`'s deliberate PR-advisory/nightly-blocking split.
2. **This ref (`ref-verification-loop`) + patched rule entities — priority 2.** The queryable
mirror: each of the 5 security/architecture rule entities carries its own
"Enforcement (mechanical)" section naming its real scanner file and/or contract test, so
`c3 lookup <file>` and `c3 read <rule-id>` surface live enforcement facts instead of prose
that can quietly go stale.
3. **`.claude/rules/workflow-conventions.md`** mirrors only the two imperative lines (merge
gate, flake-triage) — it does not restate the registry, staying a checklist that
"complements" `CLAUDE.md` rather than a second source of truth.

## Why

An audit (2026-08-02, verification-loop campaign) found no artifact defined the loop at all:
every PR re-derived its "Testing performed" reasoning and its flake-triage judgment from
scratch by reading CI YAML. `CLAUDE.md` is read unconditionally at the start of every session
in this repo (per the harness's own project-instructions convention) — that makes it the only
artifact that can satisfy "answerable from one read" for a session that has not yet run any
`c3` command. C3 is kept as the second, not the only, artifact because it is not read
unconditionally; it earns its place as the *durable, queryable* record that a later session
(or `c3 check`) can interrogate per-file or per-rule, and because 4 of the 5 governed rule
entities (`rule-api-key-isolation`, `rule-gate-runtime-messages`, `rule-sanitize-model-output`,
`rule-typed-errors`) had no Enforcement section at all before this ref existed — leaving
`c3 lookup` silent on how they are actually mechanized, and the fifth (`rule-domain-purity`)
had one pointing at a script path that had not existed since campaign card V2. A single
combined artifact was rejected: collapsing the registry into one more rule entity would fail
this system's own Separation Test (a `rule` is one enforceable golden pattern; the verification
loop is *why* the gate set is shaped the way it is — CLAUDE.md-first, `gh pr checks` as the
merge-gate substitute, `dep-audit` deliberately advisory — which is rationale, i.e. a `ref`).

## How

The pattern already exists on `rule-domain-purity` and is now replicated onto the other 4
governed rules — an "Enforcement (mechanical, ...)" section naming the exact file(s):

```markdown
**Enforcement (mechanical, two surfaces — ADR `adr-20260610-dep-direction-build-gate`):**

1. **Build gate:** `scripts/hard-rule/check-dep-direction.mjs` enforces the full allowlist
   matrix [...]. It runs as the first command of both extension `build` scripts and of
   `bun run lint`, exits 1 with the violated rule and fix hint [...]. Matrix locked by
   `scripts/hard-rule/check-dep-direction.test.ts`.
2. **IDE/lint feedback:** `eslint.config.mjs` `import-x/no-restricted-paths` zones [...].
```

`CLAUDE.md`'s gate registry table (REQUIRED to stay a table, not prose — see
`docs/superpowers/specs/2026-08-03-v5-verification-loop-doc.md`) is the priority-1 counterpart;
each of its rows for a hard-rule scanner cites the same rule id this ref wires to, so the two
artifacts describe the same fact from two access paths instead of forking it.
