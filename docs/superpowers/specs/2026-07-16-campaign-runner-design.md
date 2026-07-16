# Campaign Runner — deterministic card loop on the Claude Agent SDK (design)

Owner directive (2026-07-16): move the campaign's outer loop out of a long-lived LLM session
into a deterministic script. Authored by the Shaman; the owner implements this in a following
session.

## 1. Problem

The campaign currently runs with the Shaman (a large-model session) as the loop: it dispatches
one executor Warchief per card, waits, verifies, updates state, repeats. That session's context
is append-only — B5 alone consumed ~40% of a 1M window — so the loop dies of context exhaustion
long before 25 cards finish, and every card pays rent on all previous cards' history.

The loop itself is deterministic work (pick next card → run executor → verify → record). It
needs zero intelligence and therefore should cost zero tokens.

## 2. Architecture — two stages, hard boundary

```
STAGE A — PLANNING (human + Fable, interactive, BEFORE the runner)
  Shaman session authors specs + plans for a batch of N cards
  → docs PR → master (docs/superpowers/{specs,plans}/...)
  Owner rulings (E-items, policy) happen here, recorded in ROADMAP §8.

STAGE B — EXECUTION (Claude Agent SDK script, headless, 0 tokens for the loop)
  bun scripts/campaign-runner/run.ts
  loop: next staged card → ONE fresh Sonnet executor session → script-verified
        SHIPPED → state updated on master → next card
  Any gap/question → write escalation file, EXIT. Human answers, re-runs.
```

The runner NEVER designs, never answers What/Why/How questions, never relaxes a wall. It is
the Warchief-dispatcher and the verifier, as code.

## 3. Key mechanics (decided)

### D1 — One fresh SDK session per card

`query({ prompt: executorBrief(card), options })` from `@anthropic-ai/claude-agent-sdk`
(TypeScript, bun — matches the repo). Options per session:

- `model: "sonnet"` (executor tier — owner protocol), `cwd: <repo root>`
- `permissionMode: "bypassPermissions"` (owner-ruled: headless loop must never hang on a
  prompt; contained by: private repo, worktree isolation, no secrets in repo, script-side
  verification of every outcome)
- `settingSources`: default (all) — loads the repo CLAUDE.md, rules, and the
  warchief/hunter/skinner agent definitions, so the session IS today's executor Warchief and
  still spawns Hunters/Skinners via its Task tool
- `sessionId: <uuid written to state BEFORE spawn>` (crash-safe resume handle)
- `maxTurns` cap + `abortController` wall-clock timeout (default 3 h/session)

Sessions are not "deleted" — a finished session is simply never resumed; its transcript stays
on disk as the audit log (and as the resume handle if the process crashed mid-card).

### D2 — Machine-readable state on master, verified against reality

`docs/superpowers/campaign/campaign-state.json` (committed; the human snapshot .md stays
alongside):

```json
{
  "campaign": "run-the-roadmap-2026-07-16",
  "mergePolicy": "merge",
  "sequence": [
    "B3",
    "B4",
    "B8",
    "A6",
    "A9",
    "A10",
    "A15",
    "B6",
    "B9",
    "A1",
    "A3",
    "B13",
    "A2",
    "A5",
    "A13",
    "A14",
    "A7",
    "A12",
    "B14",
    "B11",
    "B10",
    "B12",
    "B15",
    "A11"
  ],
  "cards": {
    "B3": {
      "status": "staged",
      "spec": "docs/superpowers/specs/2026-07-16-b3-...md",
      "plan": "docs/superpowers/plans/2026-07-16-b3-...md",
      "branch": "feat/b3-re-encounter-highlighting",
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": "..."
    }
  }
}
```

Statuses: `staged` (spec+plan on master) → `running` → `shipped` | `escalated`. Iron rule
(same as the human resume protocol): **the file is data, gh/git is authority** — on every
start the runner re-derives each card's true phase from GitHub before acting.

### D3 — Done is script-verified, never agent-claimed

The executor's final `SHIPPED <pr> <sha>` line is a signal only. The runner accepts a card as
shipped when ALL of these deterministic checks pass (no-cascade as code):

1. `gh api pulls/<pr>` → `merged == true`
2. merge commit has **2 parents** (regular merge — owner re-ratified; squash/rebase = fail)
3. merge sha is an ancestor of `origin/master`
4. every PR check concluded `success` (subject to the codified flake rule, D6)
5. the card's worktree is gone and its remote branch deleted
6. schema guard: `git diff <base>..origin/master -- packages/app/src/domain/types.ts` is
   empty unless the card's plan explicitly declares a types.ts change (E1 protection)

### D4 — Resume matrix (crash/stop at ANY point; script is stateless)

On every start, per current card, derived from reality:

| Observed reality                    | Action                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR merged, state not yet `shipped`  | verify (D3) + record only — no session                                                                                                                    |
| PR open                             | resume the recorded session (`resume: sessionId`) with a "continue from CI wait/merge" prompt; if the transcript is gone, spawn fresh with a state digest |
| branch/worktree exist, no PR        | resume session if possible; else REVERT_AND_REDO (delete worktree + branch, fresh session) — the doctrine B5's executor proved                            |
| no trace                            | fresh session                                                                                                                                             |
| escalation file exists for the card | EXIT: "answer pending"                                                                                                                                    |

`.campaign/STOP` file → runner finishes the in-flight verify step and exits cleanly (owner's
soft-stop).

### D5 — Escalation: the loop stops, the human decides

Triggers: executor returns `NEEDS_DIRECTION`, D3 verification fails twice for a card, a plan
file is missing for the next card (`PLANNING_NEEDED`), or an owner-only item (E5/E6, PDF
go/no-go, A12 advertising) surfaces. The runner writes
`docs/superpowers/campaign/escalations/<card>.md` (question + context + options), sets the
card `escalated`, commits state, and exits with a distinct code. The human (a Shaman session)
answers by appending a ruling to `docs/superpowers/campaign/answers.md` (committed); every
executor brief embeds that file, and re-running the script resumes.

### D6 — State commits and the flake rule, codified

After each card the runner updates state via its own docs PR (branch → commit → push → PR →
wait checks → `gh pr merge --merge`). CI-check policy, encoding this campaign's rulings:
retry a failed check up to 3 times (10-min spacing); if after retries the ONLY failure is an
advisory third-party check failing at bootstrap (the SonarCloud-504 signature) **and** the
diff is docs-only → merge with the exception recorded in the PR body; any other red → treat
as escalation (D5). Code PRs (the executor's own) never auto-waive — that path always
escalates, matching the owner's B5 ruling.

### D7 — Observability without tokens

The runner streams each session's SDK messages to `logs/<card>-<sessionId>.log`, prints
one-line phase transitions to stdout, and relies on the existing worker-report convention
inside the session (the brief keeps requiring report-file heartbeats). No LLM summarization
anywhere in the loop.

## 4. What this replaces / keeps

- Replaces: the Shaman-as-loop (dispatch, wait, mechanical verify, state bookkeeping).
- Keeps: Stage-A planning by human+Fable; the executor Warchief exactly as proven on B5
  (TDD Hunters, dual-skinner audit, PR conventions, "Testing performed" evidence policy);
  ROADMAP §8 as the decision record; walls unchanged (no-squash, master-green, §3
  constraints, owner-only E-items).
- Non-goal: the runner never writes specs/plans, never merges with a red substantive check,
  never answers escalations, never runs two cards concurrently (v1 is strictly sequential).

## 5. Cost model

Loop: 0 tokens. Per card: one Sonnet executor session (plus its internal Hunter/Skinner
subagent usage, as today). Stage-A planning cost is unchanged but now runs in disposable
interactive sessions instead of accumulating in one.

## 6. Risks

- **bypassPermissions**: the session can run anything the shell can. Mitigations: private
  repo, no secrets on disk, worktree isolation, script verification, STOP file, wall-clock
  abort. Accepted by owner ruling.
- **SDK drift**: `query()` options are pinned in one module (`session.ts`) so an SDK upgrade
  touches one file.
- **State/reality divergence**: mitigated structurally by D2's verify-first rule.
