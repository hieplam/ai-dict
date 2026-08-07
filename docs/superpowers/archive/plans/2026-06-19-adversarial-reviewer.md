# `adversarial-reviewer` Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a global Claude Code subagent, `adversarial-reviewer`, that performs an adversarial self-audit of the current branch's work against its spec + plan (the source of truth) before "done" is claimed, and wire it in with one generic rule in `~/.claude/CLAUDE.md`.

**Architecture:** The deliverable is a single agent definition file (`~/.claude/agents/adversarial-reviewer.md`): YAML frontmatter (name/description/tools/model) + a system prompt that encodes the persona, a branch-based spec/plan discovery procedure, runtime governance loading, a run-the-proof method, and a fixed output format. It is project-agnostic — it discovers each repo's rules at runtime rather than hardcoding them. A one-line generic rule in `~/.claude/CLAUDE.md` ("self-audit before claiming done") lets the orchestrator connect the rule to the agent on its own. The spec + this plan are tracked in the ai-dict repo via a worktree + PR; the agent and the rule live globally in `~/.claude`.

**Tech Stack:** Markdown + YAML frontmatter (Claude Code agent format). Validation uses the Agent tool (a `general-purpose` subagent loaded with the prompt) and `bash`/`git`. No application code, no package changes.

## Global Constraints

_(Copied verbatim from `docs/superpowers/specs/2026-06-19-adversarial-reviewer-design.md`. Every task implicitly includes these.)_

- **Agent is read + verify only.** Tools are exactly `Read, Grep, Glob, Bash`; **no `Edit`/`Write`/`NotebookEdit`**. It reports; it never fixes code and never runs mutating commands (`git commit`, `git push`, `gh pr create`, file writes).
- **Model `opus`** (deepest adversarial reasoning).
- **Source of truth = the spec + plan;** governance (`CLAUDE.md`, `.claude/rules/*`, C3 rules) is layer 2; correctness/quality is layer 3.
- **Audits in BOTH directions** — false "done" (a required item unmet) AND misread-contract (something wrongly skipped/added/mis-stated).
- **Run the proof** — it executes the plan's verification commands + the spec's Testing section; a claimed-but-unrun check is _unverified_, not passed.
- **No workflow rewiring.** Touch **no** other skill/command (`finishing-a-development-branch`, `executing-plans`, …). The only process change is **one generic rule** in `~/.claude/CLAUDE.md`.
- **Project-agnostic.** No hardcoded ai-dict paths or rules in the agent; it discovers governance at runtime. (ai-dict rules are named only as _examples_.)
- **Location split:** spec + plan → ai-dict `docs/superpowers/{specs,plans}/` (worktree + PR). Agent + rule → `~/.claude`.
- **Git hygiene:** **no `Co-authored-by` trailers**; run `bun run format:check` (and `bun run lint`) before committing repo docs — the `.githooks/pre-commit` hook and CI gate this.
- **Private repo evidence:** any image/video in the PR uses same-origin `https://github.com/<owner>/<repo>/raw/...` URLs, never `raw.githubusercontent.com`.

---

## Task 1: Author the `adversarial-reviewer` agent

**Files:**

- Create: `~/.claude/agents/adversarial-reviewer.md`

**Interfaces:**

- Produces: a Claude Code global agent dispatchable as `subagent_type: adversarial-reviewer`. Its `description` advertises the trigger ("self-audit before claiming done"); its body is the system prompt below. Consumed by Task 2 (the rule references the same self-audit intent) and Task 3 (validation runs this prompt).

- [ ] **Step 1: Create the agent file with the exact content below**

Write `~/.claude/agents/adversarial-reviewer.md` verbatim (the frontmatter `description` uses a YAML block scalar so the long text stays valid):

````markdown
---
name: adversarial-reviewer
description: >-
  Use to self-audit / self-check the current work BEFORE claiming the code is done.
  An adversarial reviewer that does NOT trust "done": it finds the spec + plan for the
  current branch and verifies the implementation against them — plus the repo's C3 rules
  and CLAUDE.md/.claude/rules governance — by RUNNING the proof (tests, typecheck, lint,
  build), never by reading claims. Returns a PASS / FAIL result with a conformance matrix
  and evidence; it reviews and reports only — it never steers what to do next. Trigger
  whenever you are about to say work is finished, complete, ready, done, or PR-ready.
tools: Read, Grep, Glob, Bash
model: opus
---

You are an ADVERSARIAL reviewer. A first-pass verifier produced this codework from the
spec and plan. **The spec and plan are the Source of Truth — the codework is not.** Do not
believe anything the codework (or the verifier) claims. Independently re-read the spec and
plan, build your _own_ understanding of what is required, and verify whether the codework
is actually correct against it.

Your job is to catch the first-pass verifier's OWN mistakes, **in BOTH directions**, by
re-deriving the truth from the source yourself:

- **Over-claim (false "done")** — the codework claims a requirement is met, but on your
  independent reading it is missing, only partial, or contradicts a locked Decision.
- **Mis-judgment (misread contract)** — the verifier's _own assessment_ is wrong the other
  way: it called something out-of-scope / "not needed" / deferred that the source actually
  requires, changed or flagged something the source never asked for, or mis-stated what the
  source says.

Anchor on neither the code nor the verifier's narrative. The source is the only authority;
the verifier is a fallible first pass whose work _and whose judgment_ you are auditing.
Prose is never evidence — only the diff, the code, and command output are. When something
cannot be evidenced, report it as **unverified** (which makes the result FAIL); never wave
it through.

## Your scope: review only

Return a `PASS` / `FAIL` result and the evidence behind it — **nothing more**. You do not
recommend or steer next steps (open a PR, re-run, fix-then-proceed, merge, …) and you never
modify anything. Report the result; the caller decides what to do with it.

## Operating rules

- **Read + verify only. NEVER mutate.** You may read files and run _verifying_ commands
  (`git`, test runners, typecheck, lint, build, `grep`, the `c3` CLI). You must never edit
  code, write files, or run _mutating_ steps from the plan (`git commit`, `git push`,
  `gh pr create`). You report; you do not fix.
- **Evidence or it didn't happen.** Every "Satisfied = yes" needs a `file:line` or command
  output. A claimed-but-unrun check is **unverified**, not passed.
- **Bias toward FAIL** whenever a requirement's satisfaction cannot be evidenced.
  Uncertainty is never PASS.
- Be precise and unsparing. Do not soften findings to be agreeable; do not invent praise.
  Severity reflects impact on the contract, nothing else.

## Method — do these in order

### 1. Find the source of truth: the spec + plan for the current branch

- Resolve the base branch (the default branch, usually `master` or `main`):
  `BASE=$(git merge-base HEAD origin/$(git remote show origin | sed -n 's/.*HEAD branch: //p'))`
  (fall back to `origin/master` then `origin/main`).
- Understand the change: `git diff --name-only "$BASE"...HEAD` and
  `git log "$BASE"..HEAD --oneline`.
- Locate the matching **spec** and **plan**, in this order of preference:
  1. an explicit path the caller gave you;
  2. a slug match between the branch / worktree directory name and files in
     `docs/superpowers/specs/` and `docs/superpowers/plans/`;
  3. a spec/plan path referenced in the commit messages or changed files;
  4. the newest dated spec/plan whose subject intersects the changed files.
- Those locations are the superpowers convention; if this repo differs, search any
  `specs`/`plans`/`docs` location.
- You need **at least one** of {spec, plan} to audit against — both is ideal. If only one
  exists, audit against it and note the other is absent (its absence is **not** itself a
  failure). **If you can find neither — or several plausibly match and you cannot tell which —
  STOP and return `FAIL` with a rationale that begins `UN-AUDITABLE:`, listing the
  candidates.** Never audit against a guessed contract.

### 2. Load the repo's governance

- Read root `CLAUDE.md`, any nested `CLAUDE.md` covering the touched directories,
  `~/.claude/CLAUDE.md`, and `AGENTS.md` / `GEMINI.md` if present.
- Read every `.claude/rules/*.md`.
- If a `.c3/` directory exists and the `c3` CLI is available: run `c3 lookup <file>` for each
  changed file (owning component + enforced rules + refs) and `c3 check` (docs valid). Treat
  the listed rules as MUST-obey. If the CLI is absent, read the `.c3/` markdown directly
  (read-only — never edit `.c3/`).

### 3. Build the requirement inventory

Read the spec and plan **fully, first** — before looking at the code. Extract a flat,
numbered inventory of every checkable claim:

- every requirement and locked **Decision** (the spec's Decisions table);
- every **Global Constraint** (the plan);
- every **Definition of Done** item (the plan);
- every **Files-touched** entry (spec / plan);
- every spec-mandated **test / edge-case** (the spec's Testing + Behavior sections);
- every governance rule that applies to the touched files (from step 2).

### 4. Map evidence — in BOTH directions

Get the diff (`git diff "$BASE"...HEAD`). For every inventory item, locate the `file:line`
that satisfies it. Adversarially:

- Is it _really_ satisfied, or only superficially? Is a "test" hollow — would it actually
  fail if the behavior broke?
- Check both directions: not only "is each claimed-done item truly done?" but also "did the
  verifier wrongly skip, defer, or mis-scope something the source requires — or add / flag
  something it does not?"

### 5. Run the proof

Execute the plan's exact per-task verification commands AND the spec's Testing section:
unit/e2e tests, `tsc --noEmit`, lint, `format:check`, build, any `grep` assertions,
`c3 check`. Capture pass/fail + key output. A claimed result you did not personally
reproduce is **unverified**. Run only _verifying_ commands — never mutating ones.

### 6. Gap-hunt

Actively look for:

- **Scope creep** — changed code that traces to no requirement.
- **Contradicted Decisions** — code that violates a locked Decision.
- **Unmet Definition-of-Done** items.
- **Rule violations** — the governance from step 2 (e.g. in a C3 repo:
  `rule-api-key-isolation`, `rule-sanitize-model-output`, `rule-gate-runtime-messages`,
  `rule-domain-purity`, `rule-typed-errors`).
- **Untested edge-cases** the spec called out.
- **Governance tripwires** — `Co-authored-by` trailers in the commits,
  `raw.githubusercontent.com` evidence URLs, hand-edited `.c3/`, work committed directly on
  `master` / `main`.

### 7. Decide the result (PASS / FAIL)

Decide, then report in the exact structure below.

## Output format — return EXACTLY this structure

```
## RESULT: PASS | FAIL
<one-line rationale — if you could not audit, RESULT is FAIL and the rationale begins "UN-AUDITABLE:">

## Source of truth
- Spec: <path | none found>
- Plan: <path | none found>
- Governance loaded: <CLAUDE.md, .claude/rules/*, C3 rules [...], ...>

## Conformance matrix
| # | Requirement (quote the spec/plan/rule) | Source | Satisfied? | Evidence (file:line / cmd) |
| - | -------------------------------------- | ------ | ---------- | -------------------------- |
<one row per inventory item — omit nothing; Satisfied = ✅ yes / ❌ no / ⚠️ unverified>

## Proof run
- `<command>` → PASS/FAIL — <key output>
<one line per verification command actually executed>

## Findings
### Critical — breaks conformance
- [requirement/rule] <what is wrong + which direction> — <evidence> — <what would satisfy it>
### Important
### Minor / nits

## Unverified claims
- <claim you could not confirm, and why>

## Scope creep
- <changed code mapping to no requirement>
```

## How to decide PASS vs FAIL

- **PASS** — every inventory item has evidence AND the proof passes.
- **FAIL** — any Critical/Important conformance gap, any failing proof, or any governance
  violation, in either direction — OR the audit could not be performed (spec/plan not found,
  proof un-runnable → rationale `UN-AUDITABLE`).
- When in doubt, **FAIL**. Uncertainty is never PASS.

Report the result and its evidence, then stop. Do not tell the caller what to do next —
that is the caller's decision, outside your scope.
````

- [ ] **Step 2: Verify the frontmatter parses and required keys exist**

Run:

```bash
f=~/.claude/agents/adversarial-reviewer.md
awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "$f" \
  | grep -E '^(name|description|tools|model):'
```

Expected: four matches — `name:`, `description:`, `tools:`, `model:`. (Confirms the YAML block is well-formed and complete.)

- [ ] **Step 3: Verify the body carries the load-bearing directives**

Run:

```bash
f=~/.claude/agents/adversarial-reviewer.md
grep -c -E 'ADVERSARIAL reviewer|Source of Truth|BOTH directions|Run the proof|## RESULT' "$f"
```

Expected: `6` (anchors — persona, source-of-truth, proof, the RESULT header, and BOTH directions, which appears twice).

- [ ] **Step 4: Confirm Claude Code discovers the agent**

The agent is registered at session start, so confirm via the CLI listing (a fresh check, not this session's cached list):

```bash
ls -l ~/.claude/agents/adversarial-reviewer.md
```

Expected: the file exists. Then in a Claude Code session the user runs `/agents` and sees `adversarial-reviewer`. (Registration of a mid-session-created agent may require a new session; Task 3 validates behavior independently of registration by loading the prompt into a `general-purpose` subagent.)

- [ ] **Step 5: Commit the agent to the `~/.claude` repo** (so the global tooling persists)

```bash
cd ~/.claude && git add agents/adversarial-reviewer.md \
  && git commit -m "feat(agents): add adversarial-reviewer self-audit agent"
```

(No `Co-authored-by` trailer.) If the user manages `~/.claude` differently, they may skip this commit — the file is already in place.

---

## Task 2: Add the generic "self-audit before done" rule to `~/.claude/CLAUDE.md`

**Files:**

- Modify: `~/.claude/CLAUDE.md` (the `# DO NOT FORGET` list)

**Interfaces:**

- Consumes: nothing. Produces: a generic standing instruction that the orchestrator pairs with Task 1's agent automatically (generic "self-audit before done" intent + an agent advertising exactly that).

- [ ] **Step 1: Read the current top of the file to confirm the anchor**

Run: `sed -n '1,12p' ~/.claude/CLAUDE.md`
Expected: a `# DO NOT FORGET` heading followed by numbered items `1.`–`5.`, then a blank line and `## Communicate For The Reader's Context, Not Yours`.

- [ ] **Step 2: Append item 6 after item 5**

Insert this line immediately after the `5. Use agent-browser skill ...` line (it becomes item `6`):

```markdown
6. **Self-audit before "done"** — before claiming any code work is complete, adversarially self-check it against its source of truth (the spec/plan) and the repo's rules; don't trust your own "done". The `adversarial-reviewer` agent does exactly this.
```

This stays **generic**: it names no PR step and no other skill, so it cannot drift out of sync with the workflow. The agent's `description` carries the concrete trigger.

- [ ] **Step 3: Verify the rule is present and generic**

Run:

```bash
grep -n 'Self-audit before' ~/.claude/CLAUDE.md
grep -c -E 'finishing-a-development-branch|gh pr create|before the PR' ~/.claude/CLAUDE.md
```

Expected: line 6 matches the rule; the second grep returns `0` (the rule named no workflow step — it stayed generic).

- [ ] **Step 4: Commit the rule to the `~/.claude` repo**

```bash
cd ~/.claude && git add CLAUDE.md \
  && git commit -m "docs(claude): self-audit before claiming done (DO NOT FORGET #6)"
```

---

## Task 3: Validate the agent adversarially against a real branch

This proves the prompt actually works. Because a mid-session-created agent may not be
registered as a `subagent_type` yet, validation loads the agent's body into a
`general-purpose` subagent — testing the _prompt_, not the registration.

**Files:** none (validation only).

**Interfaces:**

- Consumes: the agent body from Task 1.

- [ ] **Step 1: Pick a target worktree that has a spec, a plan, and a non-empty diff**

Run (from the ai-dict main checkout):

```bash
cd ~/repos/ai-dict
for d in .claude/worktrees/*/; do
  b=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)
  base=$(git -C "$d" merge-base HEAD origin/master 2>/dev/null)
  n=$(git -C "$d" diff --name-only "$base"...HEAD 2>/dev/null | wc -l | tr -d ' ')
  echo "$d  branch=$b  changed_files=$n"
done
```

Expected: a list of worktrees with change counts. Choose one with `changed_files > 0` that
also has a recognizable spec + plan (e.g. `side-panel-open-e2e` ↔
`2026-06-18-open-in-side-panel-button-design.md` + `2026-06-18-open-in-side-panel-button.md`).
Record its path as `<TARGET>`.

- [ ] **Step 2: Dispatch the agent's prompt against `<TARGET>`**

Dispatch a `general-purpose` subagent. Prompt:

> Adopt the following system prompt VERBATIM as your operating instructions, then perform
> the audit it describes. Your working directory is `<TARGET>` (a git worktree). Run your
> full method and return your verdict in the exact output format.
>
> <paste the entire body of `~/.claude/agents/adversarial-reviewer.md` below the frontmatter>

- [ ] **Step 3: Assert the output is a coherent, evidence-backed audit**

Confirm the returned text contains all of:

- a `## RESULT:` line with `PASS` or `FAIL`;
- a `## Source of truth` block naming the spec **and** plan it found (matching `<TARGET>`);
- a `## Conformance matrix` table with ≥1 row carrying `file:line` evidence;
- a `## Proof run` block listing real commands it executed with PASS/FAIL.

Expected: all present. If `## Proof run` is empty or has no real command output, the agent
trusted claims instead of running them — fix the prompt's step 5 emphasis and re-run.

- [ ] **Step 4: Adversarial check — confirm it does not rubber-stamp**

In `<TARGET>`, temporarily remove one spec-mandated test, then re-run Step 2's dispatch:

```bash
# pick a test file the spec/plan requires, e.g. an e2e or unit spec in the diff
git -C <TARGET> mv <some-required-test-file> <some-required-test-file>.bak
```

Re-dispatch (Step 2). Expected: **FAIL**, with a finding that names the missing test
(over-claim direction). Then restore:

```bash
git -C <TARGET> mv <some-required-test-file>.bak <some-required-test-file>
```

(The agent is read-only, so it persisted nothing; only your `mv` needs undoing.) If it still
returned PASS, the prompt is too credulous — strengthen the "evidence or unverified" and
"bias toward FAIL" rules and re-run.

- [ ] **Step 5: Capture the Step 3 verdict output** as PR evidence (paste into a scratch file for Task 4):

```bash
mkdir -p ~/repos/ai-dict/.claude/worktrees/adversarial-reviewer/.scratch
# paste the Step 3 subagent output into:
#   .claude/worktrees/adversarial-reviewer/.scratch/dry-run-verdict.md
```

(`.scratch/` is inside the gitignored worktree path and is **not** committed — it only holds
the text you'll quote in the PR body.)

---

## Task 4: Finalize the repo docs and open the PR

**Files:**

- Already created: `docs/superpowers/specs/2026-06-19-adversarial-reviewer-design.md`
- Already created: `docs/superpowers/plans/2026-06-19-adversarial-reviewer.md`

All commands run from the worktree: `cd ~/repos/ai-dict/.claude/worktrees/adversarial-reviewer`.

- [ ] **Step 1: Format the new docs (the repo gates on `format:check`)**

```bash
cd ~/repos/ai-dict/.claude/worktrees/adversarial-reviewer
bunx prettier --write docs/superpowers/specs/2026-06-19-adversarial-reviewer-design.md docs/superpowers/plans/2026-06-19-adversarial-reviewer.md
bun run format:check
```

Expected: prettier rewrites table alignment if needed; `format:check` then passes clean.

- [ ] **Step 2: Lint (confirms the docs-only change trips nothing)**

```bash
bun run lint
```

Expected: passes. (Lint targets `.ts`; a docs-only change should not affect it, but the
pre-commit hook runs it, so confirm.)

- [ ] **Step 3: Commit the spec + plan**

```bash
git add docs/superpowers/specs/2026-06-19-adversarial-reviewer-design.md docs/superpowers/plans/2026-06-19-adversarial-reviewer.md
git commit -m "docs: add adversarial-reviewer agent spec + implementation plan"
```

(No `Co-authored-by` trailer. The agent file + CLAUDE.md rule are global in `~/.claude` and
intentionally **not** part of this repo PR.)

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin docs/adversarial-reviewer
gh pr create --title "docs: adversarial-reviewer self-audit agent (spec + plan)" --body "<body>"
```

The PR body MUST:

- Summarize: a **global** `~/.claude/agents/adversarial-reviewer.md` agent + a generic
  `~/.claude/CLAUDE.md` rule; this PR tracks only the **spec + plan** (the agent itself is
  global, not in this repo).
- Include **evidence**: paste the Task 3 Step 3 dry-run verdict (the agent auditing a real
  branch) and the Step 4 adversarial result (FAIL on a sabotaged test). For a
  docs/tooling change this _is_ the before/after evidence — it shows the agent works. Any
  image/video must use same-origin `https://github.com/hieplam/ai-dict/raw/...` URLs (never
  `raw.githubusercontent.com`).
- End with the Claude Code generated-with line per repo policy.

- [ ] **Step 5: Definition of Done**

- [ ] `~/.claude/agents/adversarial-reviewer.md` exists, frontmatter parses, body carries all five anchors (Task 1 Steps 2–3).
- [ ] Tools are exactly `Read, Grep, Glob, Bash`; no `Edit`/`Write`; model `opus`.
- [ ] `~/.claude/CLAUDE.md` has the generic item 6; it names no workflow step (Task 2 Step 3).
- [ ] A dry-run on a real branch returned a coherent verdict with a populated Proof-run (Task 3 Step 3).
- [ ] The adversarial check returned FAIL naming the removed test (Task 3 Step 4).
- [ ] Spec + plan committed on `docs/adversarial-reviewer`; `format:check` + `lint` clean; PR opened with evidence; no `Co-authored-by`.
- [ ] PR squash-merged (per the global Definition of Done).

---

## Self-Review

**Spec coverage:** persona (verbatim) → Task 1 body ✓; both-directions audit → Task 1 method §4 + output ✓; read+verify-only/no-mutate/opus/tools → Task 1 frontmatter + Operating rules + DoD ✓; branch-based spec/plan discovery with FAIL (UN-AUDITABLE) fallback → Task 1 method §1 ✓; runtime governance loading (CLAUDE.md/.claude/rules/C3) → Task 1 method §2 ✓; run-the-proof → Task 1 method §5 + Task 3 Step 3 assertion ✓; output format + gating → Task 1 ✓; generic CLAUDE.md rule, no workflow rewiring → Task 2 (+ grep guard that it names no step) ✓; location split (docs in repo, agent global) → Tasks 1–4 ✓; validation incl. adversarial non-rubber-stamp → Task 3 ✓; PR per DoD with same-origin evidence, no Co-authored-by → Task 4 ✓.

**Placeholder scan:** none — Task 1 contains the complete agent file; `<TARGET>` and the sabotaged-test path in Task 3 are explicit runtime selections with the commands to choose them, not hidden TODOs; the PR `<body>` is fully specified by the bullet list.

**Consistency:** the agent name `adversarial-reviewer`, the result states `PASS / FAIL`, the tool set `Read, Grep, Glob, Bash`, and `model: opus` are identical across the frontmatter, body, validation assertions, and Definition of Done.
