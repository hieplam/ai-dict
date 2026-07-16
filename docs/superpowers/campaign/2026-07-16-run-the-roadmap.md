# Campaign snapshot — "Run the roadmap" (updated 2026-07-16, post-B5)

> Committed resume snapshot (owner's global resume standard — see `CLAUDE.md` §Long-running
> work). Live state (richer, updated every transition):
> `.okra/runs/run-the-roadmap-2026-07-16/SHAMAN-STATE.md` on the campaign machine. A new
> session reads this snapshot → `docs/ROADMAP.md` §8 Decision Log → live GitHub state, and
> verifies before acting.

## Status: ⏸ PAUSED BY OWNER after B5 — workflow tuning session next. Do NOT dispatch B3 until the owner finishes tuning.

## Directives in force

1. Ship all 25 remaining roadmap cards. Sequence: B5 → B3 → B4 → B8 → A6 → A9 → A10 → A15 →
   B6 → B9 → A1 → A3 → B13 → A2 → A5 → A13 → A14 → A7 → A12 → B14 → B11 → B10 → B12 → B15 →
   A11-spike.
2. Owner rulings: E2 envelope ratified · E3 build-don't-advertise · E4 spike approved ·
   regular merge commits only (no squash) · Shaman authors spec+plan, Warchief = Sonnet pure
   executor · per-card realistic goals ratified · no media evidence (written "Testing
   performed" PR sections).

## Board

| Card               | Status                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A16 A4 A8 B1 B2 B7 | ✅ shipped (earlier campaigns)                                                                                                                                                                                                                                            |
| **B5**             | ✅ SHIPPED — PR #105, merge `c667cf8a` (2 parents), E1 diff 0 lines, master fully green (SonarCloud recovered post-outage; owner waiver was ledgered but master ultimately green)                                                                                         |
| **B3**             | 📦 staged — spec + plan on master (`docs/superpowers/{specs,plans}/2026-07-16-b3-re-encounter-highlighting*`, plan = 6 tasks after evidence-task removal). Dispatch = create worktree from fresh master, Sonnet executor Warchief, brief embeds the plan + realistic goal |
| B4 → A11           | ⬜ specs/plans authored just-in-time per card by the Shaman                                                                                                                                                                                                               |

## Learnings bank (bind future plans)

1. Wire-arm + router-case = ONE plan task (exhaustive switch coupling).
2. Every spec clause must map to a plan step (diff spec vs plan before dispatch).
3. Composition-root listeners reading async replies need a staleness guard
   (`createSaveReplyGuard()` in core — reuse it).
4. Shell `GEMINI_API_KEY` bakes env-key builds that break no-key e2e tests.
5. Playwright filters: exact spec names, never substrings.
6. An idle Warchief mid-CI-wait is not dead — check real process/CI state first.
7. Sonnet executors + Shaman-authored plans: B5 = 9 tasks + 2 audit fixes, 0 design
   improvisations, 2 legitimate escalations (plan gap; CI outage). Protocol works.

## Walls (active)

No squash merges · master never red · ROADMAP §3 constraints (S1/S4/no-background-LLM/
tokens-only/ports) · owner-only items: E5, E6, PDF go/no-go, A12 advertising.
