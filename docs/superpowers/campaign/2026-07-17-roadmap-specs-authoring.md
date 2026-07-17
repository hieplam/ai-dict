# Campaign snapshot — Roadmap spec/plan authoring (2026-07-17) · PAUSED (owner handoff)

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
