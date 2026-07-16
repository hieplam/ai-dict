# Campaign Runner Implementation Plan

> **For the implementing session:** TDD per task (failing test → implement → gates → commit).
> Design decisions live in `docs/superpowers/specs/2026-07-16-campaign-runner-design.md` —
> do not re-open them. The WHY (measured context costs, lessons, rejected alternatives) lives
> in `docs/superpowers/campaign/2026-07-16-campaign-runner-context.md` — read it first if you
> are tempted to change the architecture. The runner is repo tooling (Node-side TypeScript run by bun), NOT part
> of `@ai-dict/app` — the core dependency rule and browser constraints don't apply, but
> lint/format gates do.

**Goal:** `bun scripts/campaign-runner/run.ts` executes staged roadmap cards sequentially —
one fresh Sonnet Agent-SDK session per card, script-verified SHIPPED, state committed to
master — resumable after any crash/stop, escalating to the human instead of deciding.

**Commit convention:** `feat: campaign runner — <task summary>`; no Co-Authored-By.

## Global constraints

- Loop logic is pure TypeScript — every function that touches the world (`gh`, `git`, SDK)
  goes through an injected `exec`/`spawnSession` seam so unit tests mock it (repo test-first
  rule).
- No LLM calls from the script itself. The only model usage is inside spawned sessions.
- Config pinned in one module: model alias `"sonnet"`, `permissionMode: "bypassPermissions"`,
  3h abort, maxTurns cap, repo root.
- State schema versioned (`"v": 1`); reader rejects unknown major versions.

### Task 1: Scaffold + dependency

Files: `scripts/campaign-runner/{run.ts,loop.ts,state.ts,verify.ts,github.ts,session.ts,brief.ts,types.ts}`
(empty exports), `package.json` (add `@anthropic-ai/claude-agent-sdk` devDependency + script
`"campaign": "bun scripts/campaign-runner/run.ts"`), vitest include for `scripts/**/*.test.ts`.
Gate: `bun install`, typecheck, lint, format. Commit (1/7).

### Task 2: `state.ts` — schema, load, seed

- Types per spec §D2 (zod schema — zod already in the repo; parse + version check).
- `loadState(readFile)` / `serializeState(state)` round-trip; unknown fields preserved.
- `nextCard(state)`: first card in `sequence` not `shipped`, skipping `escalated` unless
  `--include-escalated`; returns `PLANNING_NEEDED` marker when the next card lacks spec/plan
  paths that exist on disk.
- Seed file `docs/superpowers/campaign/campaign-state.json` for the live campaign: B5-era
  cards `shipped` (with real PR/sha values), B3 `staged` (real spec/plan paths), B4→A11
  entries with `spec: null, plan: null` (i.e. `PLANNING_NEEDED` until Stage A lands them).
- Tests: parse/serialize, nextCard ordering, planning-needed detection, version rejection.
  Commit (2/7).

### Task 3: `verify.ts` — the D3 seven-point replay as code

`verifyShipped(card, io): Promise<VerifyResult>` where `io.exec` is injected. Checks per spec
§D3 (merged, 2 parents, ancestor, checks green incl. D6 flake classification, worktree/branch
gone, types.ts guard honoring a `allowsSchemaChange` flag from the card's plan front-matter).
Returns a structured result naming every failed point (feeds the escalation file).
Tests: mocked `exec` matrix — happy path, squash detected, red check, sonar-504 signature
classification (docs-only vs code diff), types.ts violation. Commit (3/7).

### Task 4: `github.ts` — deterministic docs-PR helper

`commitStateAndMerge(files, title, io)`: branch `campaign-state/<card>` → commit → push → PR
(body includes "Testing performed: docs-only state update") → poll checks with D6 retry
policy → `gh pr merge --merge` → cleanup branch → ff-sync local master. Bounded waits,
structured failure (never throws raw). Tests with mocked exec: green path, retry-then-green,
docs-only sonar exception, non-advisory red → returns `escalate`. Commit (4/7).

### Task 5: `brief.ts` + `session.ts`

- `executorBrief(card, state, answers)` — template modeled verbatim on the B5 executor brief
  that shipped (executor mode, plan path on master, realistic goal from state, walls,
  conventions, "Testing performed" evidence policy, regular-merge order, worker-report path,
  `SHIPPED <pr> <sha>` / `NEEDS_DIRECTION:` terminal contract) + embedded
  `docs/superpowers/campaign/answers.md` content. Snapshot test.
- `runSession({brief, sessionId, resume?}, io)`: wraps SDK `query()` with the pinned options
  (spec §D1), streams messages to `logs/<card>-<sessionId>.log`, returns
  `{ outcome: "shipped"|"needs_direction"|"error"|"timeout", finalText, pr?, sha? }` parsed
  from the result message. `io.spawnSession` seam so tests never hit the SDK.
  Tests: result parsing (SHIPPED line, NEEDS_DIRECTION, malformed → error), timeout path.
  Commit (5/7).

### Task 6: `loop.ts` + `run.ts` — the loop, resume matrix, escalation

- `deriveCardPhase(card, io)`: implements the spec §D4 reality table (gh pr state, branch
  existence, worktree list, escalation file, transcript availability via SDK
  `listSessions`).
- Main loop: STOP-file check → nextCard → derivePhase → act (verify-only | resume | fresh |
  exit) → on shipped: verify (Task 3) → state update+merge (Task 4) → next. On
  needs_direction / double verify-fail / PLANNING_NEEDED: write
  `docs/superpowers/campaign/escalations/<card>.md`, mark card `escalated`, commit state,
  exit code 2. `--dry-run` prints the derived plan without spawning anything; `--cards`
  filter; `--max-cards N`.
- Tests: loop over mocked io — full happy path B3→B4, crash-resume from each phase row,
  STOP file, escalation flow, dry-run output. Commit (6/7).

### Task 7: Docs + smoke

- `scripts/campaign-runner/README.md` (how to run, resume semantics, escalation/answers
  workflow, STOP file); repo `CLAUDE.md` §resume-protocol gains one line pointing at the
  runner; campaign snapshot updated.
- Smoke: `bun run campaign --dry-run` against the real seeded state (expects: next = B3,
  phase = fresh). Then the first REAL run: `bun run campaign --cards B3 --max-cards 1` —
  B3 ships through the runner end-to-end (this is the acceptance test; a human watches the
  first run).
- Final gate: full `bun run test`, lint, format, typecheck. PR with "Testing performed"
  section; ALL checks green; regular merge. Commit (7/7).

## Acceptance (the runner's own realistic goal)

1. `--dry-run` correctly derives phases from live GitHub state with zero side effects.
2. B3 ships end-to-end through the runner with no human input besides starting it.
3. Kill -9 the runner at any point during (2)'s re-run rehearsal → restart resumes without
   duplicate PRs, duplicate sessions, or lost state.
4. A forced `NEEDS_DIRECTION` (temporarily corrupt a plan step) produces an escalation file
   and a clean exit — and an answers.md entry + re-run completes the card.
5. The loop process itself consumed 0 LLM tokens (only spawned sessions did).
