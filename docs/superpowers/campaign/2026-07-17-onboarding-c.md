# SHAMAN STATE — campaign "Onboarding overhaul — Category C" (started 2026-07-17)

> **Resume entry point.** A fresh session reads THIS FILE FIRST, then verifies every claim
> against live reality (gh pr view / git log / worktree list / CI) — the file is data, the
> world is authority. Continue from "Next action". If this local file is missing, reconstruct
> from docs/ROADMAP.md §4 Category C + §8 Decision Log (2026-07-16 entries) + open PRs.

## Campaign status: ▶ RUNNING

- Owner directives in force (chronological):
  1. 2026-07-16: add 10 onboarding ideas (flaky first-run funnel), full spec + plan per idea,
     "so that I can dispatch multiple subagents to implement". Delivered as Category C
     (PR #109, merged cda8dd3b).
  2. 2026-07-16: leverage the GitHub Pages landing page (https://hieplam.github.io/ai-dict/,
     source docs/index.html) — C3 revised to v2 (landing-page try-it), C11 added, CLAUDE.md
     documents the page. (Recovery PR #111 — see in-flight.)
  3. 2026-07-17: owner said "continue" → execute the campaign.
  4. Standing (inherited from owner rulings 2026-07-16): regular merge commits ONLY (no
     squash); evidence = written "Testing performed" PR section (no media); Shaman authors
     How (specs/plans already authored); Warchief = SONNET pure executor, zero design
     authority, NEEDS_DIRECTION on any plan-vs-reality mismatch beyond trivial drift.

## Sequence (roadmap §4 Category C intro)

C10 → C1 → C2 → C5 → C6 → C7 → C8 → C3 → C4 → C9 → C11. One Warchief per card, verified
SHIPPED before next dispatch. C3/C4 must not start Task-2+ until C2 is merged. C3 and C11
both touch docs/index.html — never run concurrently. C11 has NO spec/plan yet (author before
its dispatch).

## Per-card status

| Card                          | Status                                                                                                                                                                                                  | Ref                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| C10 deterministic funnel e2e  | ✅ SHIPPED & 4-point verify-shipped PASS — PR #113, regular merge f80ab629; full suite 111 passed/0 failed under exported-key repro; audit: F1 Critical fixed+re-verified, F2 Minor → DEBT (see report) | report: workers/warchief-c10/report.md                            |
| C1 open onboarding on install | 🔄 DISPATCHED (warchief-c1, Sonnet)                                                                                                                                                                     | spec/plan 2026-07-16-c1-\*; report: workers/warchief-c1/report.md |
| C2, C5, C6, C7, C8            | ⬜ not started — spec+plan on master                                                                                                                                                                    | docs/superpowers/{specs,plans}/2026-07-16-c\*.md                  |
| C3                            | ⬜ not started — spec+plan v2 ON MASTER (PR #111 merged 52e1892)                                                                                                                                        | needs C2 merged                                                   |
| C4                            | ⬜ not started — needs C2 merged                                                                                                                                                                        |                                                                   |
| C9                            | ⬜ not started                                                                                                                                                                                          |                                                                   |
| C11                           | ⬜ not started — NO spec/plan yet; card on master                                                                                                                                                       | author spec+plan first                                            |

## In-flight / open items

- **PR #111 CLOSED**: merged (regular) 52e1892, 2026-07-17; all 17 checks green; content
  verified on master (CLAUDE.md landing section + C11 card + C3 v2); worktree + local/remote
  branch deleted.
- **warchief-c10**: dispatched 2026-07-17, intake acknowledged; heartbeat at
  workers/warchief-c10/report.md.

## Standing walls (all ACTIVE, owner-only retirement)

squash_merge_count==0 · master_red_ci_count==0 · standing_constraint_violation_count==0
(§3: S1 key isolation / S4 sanitize / no-bg-LLM / tokens-only / ports) ·
landing_page_never_touches_key==true (S1 extension of directive 2) ·
e2e_never_fetches_live_site==true · unescalated_owner_decision_count==0 ·
anti_goal_bypass_or_dishonesty_count==0.

## Learnings bank (binds every plan/dispatch; inherited from run-the-roadmap + this campaign)

1. Wire-arm + router-case = ONE plan task (exhaustive switch coupling).
2. Every spec clause must map to a plan step.
3. Async-reply listeners in composition roots need staleness guards from day one.
4. GEMINI_API_KEY in the owner's shell bakes env-key builds that silently disable onboarding —
   every e2e build in this campaign clears it until C10 lands the permanent guard.
5. Playwright filters: exact spec names, never bare substrings.
6. A Warchief idle mid-CI-wait is NOT dead — check real process/CI state before re-dispatch.
7. NEW (2026-07-16): never push follow-up commits to a PR branch without checking the PR's
   merge state first — the owner merges fast; stranded commits require a recovery PR (#111).
8. docs/index.html on master IS the deployed landing page — treat any change to it as a
   production release.

## Debt ledger

- C10/F2 (Minor): `catch {}` in the build-meta read conflates ENOENT with malformed JSON —
  follow-up detail in workers/warchief-c10/report.md. Candidate to fold into any later card
  touching fixtures.ts (C1's e2e task or a standalone chore).

## Pending re-checks

- Post-merge master CI run for f80ab629 unverifiable at ship time (GitHub Actions API 503
  outage, both warchief and Shaman attempts). Master tip is tree-identical to the fully green
  PR #113 head. RE-CHECK `gh run list --branch master` when the API recovers; wall
  master_red_ci_count==0 stays conditionally-held until then.

## Next action

warchief-c1 in flight (dispatched after C10 verify PASS). Card-boundary docs PR (ROADMAP C10
status blockquote + campaign snapshot under docs/superpowers/campaign/) → merge when green.
Then: await warchief-c1 → verify → C2.
