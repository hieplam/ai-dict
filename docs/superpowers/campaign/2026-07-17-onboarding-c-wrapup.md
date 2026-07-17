# Campaign wrap-up — "Onboarding overhaul — Category C" (2026-07-17)

**Outcome: 0 of 6 cards shipped. No work lost — 4 branches pushed, 12 commits preserved.**
The features were written; the delivery mechanism (the campaign runner) broke. Stopped by owner
order mid-run.

> **Fixing the runner? Read [`2026-07-17-runner-incident-HANDOFF.md`](./2026-07-17-runner-incident-HANDOFF.md)** —
> the full incident: 14 session logs, root cause, and the concrete fix list. This file is only the
> inventory of what exists now.

---

## Branches — everything that survived

Nothing below is merged. Nothing has a PR. Do not assume any is complete.

| Card                              | Branch                                                                                                 | Head                                                           | Commits | State                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| **C1** Open onboarding on install | [`feature/C1OpenOnInstall`](https://github.com/hieplam/ai-dict/tree/feature/C1OpenOnInstall)           | [`7a86670`](https://github.com/hieplam/ai-dict/commit/7a86670) | 4       | **Believed complete** — worktree clean, gates passed locally, died at the PR step. Closest to shippable. |
| **C2** Verified activation        | [`feature/C2VerifiedActivation`](https://github.com/hieplam/ai-dict/tree/feature/C2VerifiedActivation) | [`036418a`](https://github.com/hieplam/ai-dict/commit/036418a) | 3       | Implementation + e2e written; **never gated, never audited**.                                            |
| **C5** Key paste hygiene          | [`feature/C5KeyPasteHygiene`](https://github.com/hieplam/ai-dict/tree/feature/C5KeyPasteHygiene)       | [`2410cf6`](https://github.com/hieplam/ai-dict/commit/2410cf6) | 4       | Gates **passed** (typecheck · 728 unit tests · lint · format). Died at the audit step.                   |
| **C7** Finish-setup badge         | [`feature/C7FinishSetupBadge`](https://github.com/hieplam/ai-dict/tree/feature/C7FinishSetupBadge)     | [`3612305`](https://github.com/hieplam/ai-dict/commit/3612305) | 1       | **WIP — DO NOT MERGE.** Task 1 only (`badgeStateFor` + 2 tests). No wiring, no e2e.                      |
| **C6** Invalid-key recovery       | —                                                                                                      | —                                                              | 0       | Never started (was gated behind C2).                                                                     |
| **C8** Gesture demo               | —                                                                                                      | —                                                              | 0       | Never started.                                                                                           |

Compare each against the base: `git log --oneline origin/master..<branch>`

**Before landing any of them:** C1/C2/C5 were branched from `c6cbb01`, which is **behind**
`origin/master` (`8ca4b88` — PR #116 landed after they were cut). They need master merged in
first.

Local worktrees still on disk and matching these branches:

```
.claude/worktrees/c1-open-on-install       feature/C1OpenOnInstall
.claude/worktrees/c2-verified-activation   feature/C2VerifiedActivation
.claude/worktrees/c5-key-paste-hygiene     feature/C5KeyPasteHygiene
.claude/worktrees/c7-finish-setup-badge    feature/C7FinishSetupBadge
```

## Already shipped before this run (context)

- **C10** Deterministic funnel e2e — PR [#113](https://github.com/hieplam/ai-dict/pull/113),
  regular merge `f80ab629`. The category's proof harness. Shipped by **hand-dispatch**, not the runner.
- **PR [#115](https://github.com/hieplam/ai-dict/pull/115)** — this campaign's state + rulings
  files, regular merge `c6cbb01`.

## Why it produced nothing (one paragraph)

The runner starts each worker as a **one-shot session that ends the moment the model stops calling
tools**. Six workers backgrounded a long job (the ~5m33s e2e suite, or a skinner audit) and then
said some version of _"I'll wait for it to finish"_ — which **was** their final message, so they
died on the spot and the background job died with them. Seven more workers were killed by the
account's **five-hour usage cap** (429, overage disabled). One was killed deliberately when the
owner called it. The features themselves were sound: C5 passed every gate before dying at the
audit step. **Full analysis + fix list: the HANDOFF file.**

## Two live problems this run uncovered

1. **`master` is RED.** `origin/master` (`8ca4b88`) fails CI `format-check` because release-please's
   `8d9365d` ("chore(master): release 1.9.0") rewrote `packages/extension-chrome/src/manifest.json`
   in non-prettier JSON. Same breakage as `1293dd3` (#93) — it recurs every release. It also blocks
   the pre-commit hook on **any** branch cut from current master. **Fix before re-running anything.**
2. **The runner needs fixing before reuse.** See the HANDOFF's §7 fix list.

## Decisions made during the run (valid, do not re-litigate)

Full text in `docs/tribe/campaigns/onboarding-category-c/answers.md`:

- **R1** — `openOptionsPage()` silently creates no tab when called from `onInstalled` at cold
  launch; use `chrome.tabs.create` (needs no new permission). **Verified working.**
- **R3** — R1's fix made "Open Settings" reuse the existing options tab, breaking a pre-existing
  test. Ruled the reuse is correct (duplicate settings tabs risk the silent data loss A16 exists to
  prevent); the test was updated, keeping it able to actually fail.
- **R5** — anti-livelock rule. **Did not work** (prose is a weak guarantee, and its first revision
  had a wrong number). See HANDOFF §4.

## Campaign state at stop

- Runner **stopped**: `STOP` file placed, PID 63657 killed, `.runner.lock` removed, orphaned SDK
  process cleaned. **Remove `docs/tribe/campaigns/onboarding-category-c/STOP` before any re-run.**
- Live Shaman state (local only, `.okra/` is gitignored):
  `.okra/runs/onboarding-c-2026-07-17/SHAMAN-STATE.md`
- Owner scope for this run was **C1 + 5 cards (C2, C5, C6, C7, C8)**. C3, C4, C9, C11 were never in
  scope; **C11 still has no spec/plan**.
