# Why the Claude Agent SDK — context & lessons behind the campaign runner

> Companion to the design and plan — read together:
>
> - Design: [`docs/superpowers/specs/2026-07-16-campaign-runner-design.md`](../specs/2026-07-16-campaign-runner-design.md)
> - Plan: [`docs/superpowers/plans/2026-07-16-campaign-runner.md`](../plans/2026-07-16-campaign-runner.md)
>
> Written 2026-07-16 by the Shaman, at the owner's request, from the lessons of the session
> that shipped B5 and paused the campaign for workflow tuning.

## 1. The problem we actually hit (measured, not theoretical)

The campaign "Run the roadmap" (25 cards) was orchestrated by a single long-lived
large-model session — the Shaman. It worked: B5 shipped, replay-verified, with a dual-skinner
audit that caught two real bugs. But the session's context window told the real story:

**One card (B5) + campaign setup consumed ~400K tokens of a 1M window (~40%).**

Where it went (from the session's own audit):

| Source                                                                                                                                                                                                                                             | ~Cost  | Why it can't shrink in a chat session                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| Spec/plan authoring moved into the session (owner protocol change: "Shaman authors How") — reading `content.ts`, `wire.ts`, `types.ts`, `router.ts`, the full 1,200-line B5 plan, writing B3's spec+plan                                           | 60–80K | Authoring requires reading source; a chat session keeps every byte forever |
| Mandated skill loads (reverse-tornado-okr injected TWICE — once per invocation path — plus c3) + OKRA ledger ceremony incl. 4 validator retries                                                                                                    | 35–40K | Skill text re-injects per invocation; every retry re-echoes payloads       |
| Harness echo: modified files re-injected in full (ROADMAP ×2, worktree CLAUDE.md ×3, state files), ~10 task-list reminders (27 tasks each), ~15 teammate messages each wrapped in ~200-token boilerplate (mostly empty idle pings during CI waits) | 50–60K | Not controllable from inside the session                                   |
| One-off infra debugging (SonarCloud outage log digs ×5 jobs, macOS `flock` shim)                                                                                                                                                                   | 15–20K | Incident-shaped, but it stays in history forever                           |

The structural defect: **a chat session's context is append-only**. Card N pays rent on
cards 1..N-1 at every single tool call. Cost per card grows linearly; the campaign would hit
the 1M ceiling around card 3, forcing compaction — and compaction loses exactly the things
this campaign cannot lose (owner rulings, schema-lock nuances, wall exceptions).

## 2. The insight: the loop is deterministic, only the work is intelligent

Watching B5 end-to-end showed the outer loop needs zero judgment:

```
pick next card → spawn executor → wait → verify mechanically → record → repeat
```

Every step above is `gh`/`git` commands and state bookkeeping. The Shaman's 7-point SHIPPED
replay (PR merged, 2 parents, ancestor-of-master, checks green, worktree gone, E1 diff = 0)
is literally a shell script wearing a language model. Meanwhile the parts that DO need
intelligence already run in **disposable contexts**:

- the executor Warchief (Sonnet) — proved on B5: 9 TDD tasks + 2 audit fixes, zero design
  improvisation, exactly 2 legitimate escalations;
- planning (human + Fable, interactive) — where all design decisions and owner rulings
  happen, and where they are durably recorded (ROADMAP §8, specs, plans on master).

So the architecture follows: **intelligence in throwaway sessions, memory in files, loop in
code.** The loop's token cost drops from ~150K/card (and growing) to **zero**, and per-card
cost becomes constant instead of cumulative.

## 3. Why the Claude Agent SDK specifically

The SDK is Claude Code packaged as a library — `query(prompt, options)` returns the full
harness (Read/Write/Edit/Bash/Task tools, permissions, session persistence). That maps 1:1
onto what the campaign already proved it needs:

| Campaign need (proved on B5)                                                                                          | SDK primitive                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Fresh, isolated context per card                                                                                      | each `query()` call = a new session                                                                                            |
| Executor on the cheap tier, per owner protocol                                                                        | `options.model` per session                                                                                                    |
| The session must BE the executor Warchief (CLAUDE.md, rules, warchief/hunter/skinner agent defs, Task-tool subagents) | `options.settingSources` loads the repo's filesystem config — the tribe machinery works unchanged                              |
| Headless, never hangs on an approval prompt overnight                                                                 | `options.permissionMode: "bypassPermissions"` (owner-ruled, with script-side verification as the containment)                  |
| Deterministic completion detection (no log-scraping)                                                                  | typed `SDKMessage` stream; `type: "result"` with `subtype: success/error`                                                      |
| Crash-resume mid-card ("idle Warchief is not dead" — twice-proven lesson)                                             | `options.sessionId` (chosen up-front, written to state BEFORE spawn), `resume`, `listSessions()` — transcripts persist on disk |
| Runaway containment                                                                                                   | `maxTurns`, `abortController` wall-clock timeout                                                                               |

Alternatives considered:

- **Headless CLI loop** (`claude -p "<brief>" --model … --permission-mode …` from bash):
  same engine, fewer moving parts — the honest fallback. Rejected as primary because it loses
  typed messages (completion detection becomes stdout parsing), programmatic session
  APIs (`listSessions`/`resume` handles), and abort control. Kept as the documented plan B.
- **Anthropic API + tool runner**: would mean rebuilding file tools, permissions, subagents —
  everything Claude Code already is. Wrong layer.
- **Managed Agents (CMA)**: Anthropic-hosted loop + sandbox. Attractive later, but the
  campaign's whole verification story (worktrees, local gh auth, repo conventions, the
  Playwright harness) lives on this machine today; self-hosting the loop is one small script.
- **Keep the Shaman-as-loop**: measured above — dies of context exhaustion by ~card 3.

## 4. Lessons from this session that the design encodes

Each mechanism in the spec traces to a scar from this session:

1. **"The file is data, the world is authority."** The resume protocol (now the owner's
   global standard in CLAUDE.md) came from surviving one machine crash (previous campaign)
   and one mid-campaign protocol change: state files can lie; `gh`/`git` cannot. → Spec D2/D4:
   the runner re-derives every card's phase from GitHub on every start.
2. **Never trust "done" prose.** B5's SHIPPED was accepted only after an independent 7-point
   mechanical replay. → Spec D3: the replay IS the acceptance, as code; the agent's SHIPPED
   line is merely a signal.
3. **A dirty worktree from a dead agent gets REVERT_AND_REDO, never inspect-and-continue.**
   The B5 executor applied this doctrine after the protocol-change handover, cleanly. → Spec
   D4's resume matrix.
4. **An idle agent mid-CI-wait is not a dead agent.** Cost us many wasted idle pings and one
   near-duplicate dispatch across two campaigns. → the runner doesn't ping at all: it awaits
   the typed result, with a wall-clock abort as the only impatience.
5. **Escalations must stop the line, not improvise.** B5's executor correctly refused to
   waive a red check itself (owner decided); the plan-gap fix was approved before it spread.
   → Spec D5: escalation file + exit; answers live in a committed `answers.md` every brief
   embeds.
6. **CI flakes need a codified policy, not per-incident judgment.** The SonarCloud outage
   (byte-identical 504s across 6+ runs on 3 PRs) consumed two escalation rounds and an owner
   question. → Spec D6 encodes the exact ruling: bounded retries; docs-only + advisory
   bootstrap-failure signature may merge with a recorded exception; code PRs never auto-waive.
7. **Plan quality is the bottleneck — keep planning with the big model + human.** Both B5
   audit findings traced to plan-authoring gaps (a dropped spec clause; the wire+router
   exhaustive-switch coupling). Owner ruling: Stage A (human + Fable) produces ALL specs and
   plans before the runner ever starts; the runner refuses to run a card without them
   (`PLANNING_NEEDED`).
8. **Heartbeat noise is real money.** ~15 teammate messages × boilerplate wrapping, mostly
   empty idle pings. → Spec D7: sessions log to files; the loop prints one line per phase;
   nothing summarizes anything with a model.

## 5. What stays human

The runner deliberately owns nothing the owner reserved: E-item escalations (E5, E6, PDF
go/no-go, A12 advertising), merge-policy changes, schema-lock changes (E1/E2), answering
NEEDS_DIRECTION, and Stage-A planning. The tribe hierarchy survives — it just stops paying
rent: **owner → (Shaman session, Stage A) → runner script → executor sessions → subagents.**
