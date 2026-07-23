# Campaign snapshot — Roadmap spec/plan authoring (2026-07-17) · AUTHORING COMPLETE (2026-07-23)

> **2026-07-23 completion note.** The 6 remaining artifacts were authored, adversarially
> verified, and merged — **every roadmap idea now has an executor-ready spec + plan pair.**
> Owner rulings for this wave: one PR per card, merged immediately on review-pass without
> waiting for CI (docs-only diffs), regular merge only.
>
> | Card                            | PR   | Merge   | Review outcome                                             |
> | ------------------------------- | ---- | ------- | ---------------------------------------------------------- |
> | A5 gloss-mode (plan)            | #118 | 973a0d2 | verifier PASS; Task 4 hardened to anchor-based hunks       |
> | A13 quiet-mode (plan)           | #119 | 82bf36e | 2 findings fixed (B3 gating-scope mismatch flagged for B3) |
> | A14 double-click (plan)         | #120 | 7ee102d | 3 findings fixed (2 citations, test-count arithmetic)      |
> | A6 placement (plan)             | #121 | ab8f10b | verifier PASS; test counts re-based to pristine master     |
> | A2 recursive-lookup (spec+plan) | #122 | 8c28470 | 2 findings fixed (phantom ICON_PIN anchor, append anchor)  |
> | A7 pin-cards (plan)             | #123 | a52ff66 | verifier PASS; 2 prototype-proven fixes promoted into spec |
>
> Process incident worth remembering: the first A7 author implemented the entire feature in the
> shared worktree instead of writing the plan (ignored 2 interventions; stopped). Its prototype
> was archived and mined by a successor into the plan — which surfaced 2 production-only defects
> the spec had (cross-world method call; click-swallowing synchronous reparent on pointerdown).
> Every substantive verifier finding across the wave traced to that uncommitted prototype
> contaminating the shared tree; authors/verifiers must ground against `origin/master`, and
> plans must use anchor-based hunks + "pre-existing + exactly N new" test counts so they survive
> sibling cards merging first.
>
> **Remaining campaign backlog (unchanged from the pause):** the 11 older pairs still awaiting
> adversarial verify (A1 A3 A11 A12 A15 B4 B6 B9 B11 B12 B14 B15 per the table below), and the
> cross-pair reconciliation ledger (§ below) — plus one new ledger item: B3's spec assumes A13
> gates the whole content script; A13 actually gates only the trigger's visible mount (B3 must
> consume `isQuietSite` directly).

**Owner directive:** every unshipped roadmap idea gets an executor-ready spec + implementation
plan pair under `docs/superpowers/`, so an orchestrator can dispatch implementation with zero
advice needed. Anti-goal: vague plans that force a subagent to ask.
**Paused by owner** 2026-07-17 ~09:50 (+07) after subagent token burn; usage window resets
2:10pm (Asia/Saigon). Live run state: `.okra/runs/spec-all-cards-2026-07-17/SHAMAN-STATE.md`
(+ CONTRACTS.md, DISPATCH-NOTES.md, AUTHOR-PROMPT-TEMPLATE.md, VERIFY-PROMPT-TEMPLATE.md,
REPO-FACTS.md, RECONCILE.md in the same run dir — the run dir is local-only, not committed).

## Scope ruling (verified against the roadmap + git)

41 cards total. Shipped (have pairs already): A4 A8 A16 B1 B2 B5 B7 C10. Pre-existing current
pairs: C1 C2 C3(v2, commit 21b83d6) C4 C5 C6 C7 C8 C9 B3. This campaign authors the remaining
**24 pairs** dated `2026-07-17-*`.

## Status per card (this campaign's 24)

| Card                       | Spec | Plan | Adversarial verify                                                      |
| -------------------------- | ---- | ---- | ----------------------------------------------------------------------- |
| A9 instant-cache-hits      | ✅   | ✅   | ✅ PASS (after 2 fixes, re-verified)                                    |
| A10 tts-pronunciation      | ✅   | ✅   | ✅ PASS (after 2 fixes, re-verified)                                    |
| B8 anki-csv-export         | ✅   | ✅   | ✅ PASS (29 citations)                                                  |
| B10 weekly-digest          | ✅   | ✅   | ✅ PASS (1 Minor fixed, grep-confirmed)                                 |
| B13 related-words          | ✅   | ✅   | ✅ PASS (2 Minors fixed, grep-confirmed)                                |
| C11 install-aware-landing  | ✅   | ✅   | ✅ PASS (27 citations)                                                  |
| A11 pdf-spike              | ✅   | ✅   | 🟡 2 findings FIXED (grep-confirmed); formal re-verify not run          |
| A1 streamed-answers        | ✅   | ✅   | ⬜ verify was in flight when limit hit — restart                        |
| A3 follow-up-chips         | ✅   | ✅   | ⬜ verify was in flight — restart (passed Shaman structural spot-check) |
| A12 non-english-source     | ✅   | ✅   | ⬜ not verified                                                         |
| A15 trigger-latency-budget | ✅   | ✅   | ⬜ verify was in flight — restart                                       |
| B4 hover-recall            | ✅   | ✅   | ⬜ not verified                                                         |
| B6 words-page              | ✅   | ✅   | ⬜ not verified                                                         |
| B9 backup-restore          | ✅   | ✅   | ⬜ verifier died before verdict — restart                               |
| B11 casual-review-flip     | ✅   | ✅   | ⬜ not verified                                                         |
| B12 llm-auto-grouping      | ✅   | ✅   | ⬜ verifier died before verdict — restart                               |
| B14 sense-aware-dedup      | ✅   | ✅   | ⬜ verify was in flight — restart                                       |
| B15 site-lookup-stats      | ✅   | ✅   | ⬜ verify was in flight — restart                                       |
| A5 gloss-mode              | ✅   | ❌   | —                                                                       |
| A6 smart-card-placement    | ✅   | ❌   | —                                                                       |
| A7 pin-cards               | ✅   | ❌   | —                                                                       |
| A13 per-site-quiet-mode    | ✅   | ❌   | —                                                                       |
| A14 double-click-trigger   | ✅   | ❌   | —                                                                       |
| A2 recursive-lookup        | ❌   | ❌   | —                                                                       |

**Metric:** executor-ready (authored+verified) 7/24 · authored-awaiting-verify 11/24 ·
spec-only 5/24 · not started 1/24. Also done: B3's spec had a stale evidence-video step
(retired policy) — fixed in this branch.

## Cross-pair reconciliation (MUST resolve before dispatching implementation)

1. **`saved.list` wire message is pinned by THREE plans (B8, B10, B15)** — same zero-payload /
   `{entries: SavedWordEntry[]}` shape per reports. Confirm byte-identical, then patch all three
   wire tasks with "skip creation if it already exists (landed via another card), verify shape".
   B6 likely wants it too.
2. **`HistoryEntry.url?` added by BOTH B10 (url+title) and B15 (url)** — unify names/semantics +
   skip-if-exists notes; B15 must not assume `title?` unless B10 shipped.
3. Rebuild the concurrency matrix from each pair's Files-touched table (A9 corrected CONTRACTS
   §5's guess); serialize cards sharing lookup-card.ts / content.ts / settings-form.ts /
   side-panel / docs/index.html (C3+C11).
4. Check A9's badge vs A10's speaker button — both insert near lookup-card's meta row.
5. B13 plan opens with a STOP condition: re-ground against A3's REAL merged diff before executing.

## Resume protocol (next session)

1. Read `.okra/runs/spec-all-cards-2026-07-17/SHAMAN-STATE.md` first; verify against this
   snapshot + `git log` on branch `docs/RoadmapSpecsPlans`.
2. Finish authoring: plans for A5 A6 A7 A13 A14 (specs exist — self-review spec, then author
   plan) + full pair for A2. Use AUTHOR-PROMPT-TEMPLATE.md + DISPATCH-NOTES.md blocks.
3. Verify the 11 unverified pairs + formal A11 re-verify, via VERIFY-PROMPT-TEMPLATE.md.
4. Resolve the reconciliation ledger (RECONCILE.md) by patching the affected pairs.
5. Then: index file mapping card → spec/plan → verify status, gates, PR
   `[RoadmapSpecsPlans]`, **regular merge** (no squash), update ROADMAP if desired.

## Ops learnings (bind future sessions)

- Dispatch agents ONE per tool-message; batched spawns hit a spawn lock.
- On "fork failed: Device not configured" (pty exhaustion): STOP spawning, REUSE idle agents
  via SendMessage (works — context intact, cheaper too).
- Agents that die on a usage limit usually left whole files on disk (Write is atomic);
  re-inventory the disk before re-dispatching anything.
- ~40 heavyweight agents in ~30 min exhausted the owner's session budget — future waves should
  be smaller (owner to set the batch size) or run on a cheaper model for authoring drafts.
