# Campaign rulings — "onboarding-top3" (C5 · C8 · C3)

> **What this file is.** The Shaman's binding rulings for this campaign. Its full content is
> embedded in every executor brief. Executors have **zero design authority**: where a ruling
> below covers your situation, follow it exactly and do not re-litigate it. Where nothing here
> covers an open What/Why question, return `NEEDS_DIRECTION` — do not guess.
>
> Only the Shaman-authority orchestrator or the owner appends here. Append-only; each entry is
> dated and names the card it binds.
>
> **Card selection (2026-07-25, owner directive "3 onboarding ideas, highest score").** Category C
> unshipped cards ranked by ROADMAP score: C3 `5.0`, C8 `4.0`, then a four-way tie at `3.0`
> (C5 · C6 · C7 · C11). The 3.0 slot went to **C5** on the roadmap's own stated sequencing
> (`C10 → C1 → C2 → C5 → C6 → C7 → C8 → C3 → C4 → C9`). Shipped already: C10 (#113), C1 (#144),
> C2 (#148). **C7 remains `staged` in the `least-effort-5` campaign** — it was not cancelled, it
> simply lost the tie-break; that campaign's state file still owns it.
>
> **Run order is `C5 → C8 → C3`**, matching the roadmap's sequencing. No card here declares a
> `dependsOn`: C3's only real dependency (C2, verified activation) is already shipped, and C5/C8
> are mutually independent. Order is sequencing, not blocking.
>
> **Provenance.** R1–R5 are carried forward verbatim in substance from the `least-effort-5`
> campaign (`docs/tribe/campaigns/least-effort-5/answers.md` R0, R2, R4, R5, R6/R7). They were
> paid for in real debugging on C1/C2 and bind unchanged here. R6–R7 are new.

---

## R1 · 2026-07-25 · campaign-wide · Build FRESH from the committed plans; work in a worktree

Carried forward from `least-effort-5` R0, and it still binds.

1. **Do not adopt, rebase, or cherry-pick any leftover branch.** Stale branches from the aborted
   2026-07-17 campaign exist on the remote (e.g. `feature/C5KeyPasteHygiene`) and were cut from
   `c6cbb01`, far behind today's master. Implement each card **fresh from its committed spec +
   plan**, on a branch cut from current `origin/master`. Reading an old branch for orientation
   (`git show`, `git log -p`) is free; merging or rebasing one is forbidden.
2. **Every card works in a git worktree under `.claude/worktrees/<card-slug>`** (owner ruling; also
   this repo's own CLAUDE.md convention). Never implement directly in the main checkout. Remove the
   worktree once the card's PR is merged.

---

## R2 · 2026-07-25 · campaign-wide · Standing constraints

Inherited rulings, restated because every executor brief must carry them:

1. **Regular merge commits only — squash-merge is prohibited** (owner, 2026-07-16). A merged card
   PR's merge commit has exactly 2 parents.
2. **Evidence is written, not media** (owner, 2026-07-16). Every PR body carries a **"Testing
   performed"** section — suites run, test counts, e2e scenarios exercised, gates passed. Do not
   capture screenshots or video.
3. **The Shaman authors How.** Specs and plans are pre-written and committed on master. Executors
   run them; any plan-vs-reality mismatch beyond trivial mechanical drift is `NEEDS_DIRECTION`,
   not a unilateral redesign.
4. **`GEMINI_API_KEY` in the builder's shell bakes an env-key build that silently disables
   onboarding.** Use `bun run build:chrome:e2e` (which clears it) for every e2e build — this is
   C10's shipped guard and it supersedes any plan text still saying
   `env -u GEMINI_API_KEY bun run build:chrome`.
5. **Playwright spec filters use exact spec names**, never bare substrings.
6. **`docs/index.html` on master IS the deployed landing page** — treat any change to it as a
   production release. **C5 and C8 must not touch it. C3 is the one card in this campaign that
   legitimately does — see R6, which governs how.**
7. Standing constraints from ROADMAP §3 bind unchanged: S1 key isolation · S4 sanitize model output
   (including streamed/partial) · no background LLM calls · design tokens only · ports architecture
   with a dependency-free domain.
8. **Run `bun run lint` and `bun run format:check` before every commit** (CLAUDE.md; the
   `.githooks/pre-commit` hook and CI both gate this).

---

## R3 · 2026-07-25 · campaign-wide · Never background anything

The 2026-07-17 campaign lost 6 of 14 workers to one failure: a session backgrounded the ~5m30s e2e
suite, ended its turn to "wait for the notification", and **that ended the session** — the runner
scored it `session_incomplete` and the backgrounded process died with its parent. It is now
enforced at the permission layer (`todd-skills` PR #49): a `PreToolUse` hook denies `Bash` with
`run_in_background: true`, and denies `Agent`/`Task` unless they pass `run_in_background: false`.
**A denial is the wall working — not a bug, and not something to route around.**

1. **Run every gate in the FOREGROUND** with an explicit generous timeout. Never `&`, never a
   background task, never "I'll wait for the notification", never `ScheduleWakeup`.
2. **Pass `timeout: 600000` explicitly** on every gate/e2e Bash call — the tool maximum (10 min).
   The 120000 ms default is blown through by the ~5m30s e2e suite, and that default is why sessions
   reach for the background in the first place. A foreground command that takes 6 minutes is normal
   and correct — do not "optimize" it into the background.
3. **If a single command genuinely cannot fit**, split the run **by exact spec file name** (never
   bare substrings) and run each part in the foreground.
4. **Never poll a background job.** If you somehow have one, kill it and re-run in the foreground.

---

## R4 · 2026-07-25 · campaign-wide · The format gate and the machine-written state files

`.claude/state/` and `docs/tribe/campaigns/` are in `.prettierignore` (PR #142, merge `87df879`)
because the campaign runner rewrites those files mid-run and formatting them is a moving target.

**Consequence for executors:** do not "fix formatting" in those two trees, and do not remove those
`.prettierignore` entries. If `format:check` fails on a file you did not touch, that is a
`NEEDS_DIRECTION`, not a licence to reformat the repo.

---

## R5 · 2026-07-25 · campaign-wide · The `verify_failed_twice` bookkeeping artifact (expect it)

**This will happen on every card; it is not a real failure.** The runner writes `pr` at
PR-creation time but leaves `branch`/`baseSha` null, so its own D3 verify cannot complete and
*every* card escalates this way at the finish line. It cost C1 and C2 a full escalation round each
(`least-effort-5` R6/R7).

**Ruling.** A `verify_failed_twice` escalation whose context is **only** "`card.branch` /
`card.baseSha` is not set" is this same bookkeeping artifact. Handle it as:

1. Re-verify the card independently with the **`verify-shipped` skill** (by name — not by calling
   its script path).
2. If that returns PASS, the card **is** shipped: reconcile the state record with the real
   `branch` / `baseSha` / `mergeSha` read from `gh`/`git`, and move on.
3. **Do NOT re-run the card** with `--include-escalated`. Its branch is merged and its worktree is
   gone; re-running risks a duplicate PR.

A `verify_failed_twice` naming **any other** failing check is a real failure and does **not** fall
under this ruling.

**Known runner defect to watch (seen on C2):** a pass may leave the repo's **main checkout**
switched to a stray `campaign-state/<card>` branch with an uncommitted tree. Restore it to `master`
by hand; do not commit from it.

---

## R6 · 2026-07-25 · C3 · Editing `docs/index.html` is a production deploy — the fence

C3 is the one card here that edits the **public landing page**, and merging to `master` **is**
deploying it (GitHub Pages serves `/docs` from `master`). R2.6's blanket "don't touch it" is
**lifted for C3 only**, under this fence. This is not a fence cut: ROADMAP §4 C3 already delegates
"the try-it section's passage + anchor (`docs/index.html`)" to the lead, and the 2026-07-16 roadmap
revision ratified the landing-page mechanism itself.

1. **Additive only.** Add the try-it section (and its anchor). Do not restructure, retheme, or
   "tidy" the surrounding page. Every existing anchor (`#why`, `#compare`, `#guide`, `#start`,
   `#faq`) keeps working.
2. **S1 is absolute.** The page must NEVER collect, receive, render, or reference the API key.
   It is a practice surface only — key entry stays inside the extension's own pages.
3. **Bilingual (EN/VI) parity.** The page ships both languages behind its toggle; a new section
   that exists in only one language is incomplete, not a follow-up.
4. **Tokens only.** The page runs the same Paperlight `--ad-*`/`--adp-*` tokens as the extension —
   no hard-coded hex/oklch, no theme names, no per-component `prefers-color-scheme` branch.
5. **The e2e suite must never fetch the live site.** The funnel spec uses a **local fixture**
   standing in for the page (the harness's `gotoFixture` pattern). A spec that hits
   `https://hieplam.github.io/...` is a defect, not a passing test.
6. **The page must render perfectly with no extension installed** — the try-it section degrades to
   ordinary prose, never a broken or empty block.

If C3's implementation would require anything beyond an additive section under this fence, that is
`NEEDS_DIRECTION` — not a judgement call for the executor.

---

## R7 · 2026-07-25 · C5 · The prefix table is a HINT surface, never a block

ROADMAP §4 C5 delegates "hint copy, prefix table" to the lead. Pre-ruled so this does not escalate:

1. **Never hard-block a save on a format heuristic.** Providers change key formats; a heuristic that
   blocks is a heuristic that will one day lock a paying user out of their own key. Hints inform;
   the user may always proceed. The real gate is C2's shipped `connection.test` round-trip, which
   tests the key against the provider rather than against our guess about its shape.
2. **Prefix table v1** (hints only): `AIza…` → Gemini · `sk-ant-…` → Anthropic · `sk-…` → OpenAI.
   Order matters — `sk-ant-` must be tested **before** `sk-`, or every Anthropic key reads as
   OpenAI.
3. **Normalisation on paste is safe and expected**: strip surrounding whitespace, newlines, and
   smart/straight quote pairs. This is the silent-failure class the card exists to kill.
4. **S1 binds hardest here.** The key must never appear in a log line, an error message, a wire
   message, or a test fixture — not even truncated. Assert on *which hint fired*, never on the key.

---

## R8 · 2026-07-25 · C8 · The demo is pure UI — zero API calls, and it must work keyless

ROADMAP §4 C8 delegates "demo copy/animation" to the lead. Pre-ruled:

1. **0 API calls, unconditionally.** The gesture demo is an animation, not a lookup. It must run
   before any key exists and while offline — that is the whole point of putting it on the welcome
   screen.
2. **Honor `prefers-reduced-motion`.** Under reduced motion the demo shows its end state (word
   selected, Define pill visible) with no animation loop — it still teaches the gesture.
3. **Tokens and inline SVG only** — no video, no GIF, no external asset, no new dependency.
   `c3-117 ui-components` under `ref-web-components-shadow-dom` governs this surface.
4. The on-welcome demo **stays on the welcome screen**; it must work offline and before any tab
   switch. Linking onward to the landing page's demo is optional and additive.

---

## R9 · 2026-07-25 · campaign-wide · A mass `eslint` type-resolution failure is a FLAKE — re-run it

**Observed while authoring this campaign (2026-07-25, clean `master`, no local changes):** one
`bun run lint` run reported **`✖ 1610 problems (1610 errors, 0 warnings)`** and exited 1. Two
consecutive re-runs on the identical tree exited **0** with no output. Nothing in the repo changed
between them.

**How to recognise it.** The errors arrive *en masse* and are all type-awareness rules —
`@typescript-eslint/no-unsafe-assignment` ("Unsafe assignment of an **error typed** value"),
`@typescript-eslint/no-unsafe-call` ("Unsafe call of a type that **could not be resolved**"). That
signature means the **TypeScript project service failed to load**, so every type degraded to
`error`/`any` and every type-aware rule fired at once. It is a toolchain failure, not a code defect.

**Ruling.**

1. **Never "fix" a mass type-resolution failure.** Re-run `bun run lint` first. If it passes, the
   first run was the flake and there is nothing to fix.
2. If it reproduces **three times consecutively** on an unmodified tree, that is a real toolchain
   break — return `NEEDS_DIRECTION` with the output. Do not start editing source to satisfy it.
3. A **small, localised** set of lint errors in files you actually touched is real. This ruling
   covers only the all-at-once, whole-repo, type-resolution signature above.
4. **Measure the exit code correctly.** `bun run lint | tail -6; echo $?` reports **`tail`'s** exit
   status, not the lint's — it will print `0` for a failing run. Run the gate bare
   (`bun run lint; echo $?`), or use `${PIPESTATUS[0]}`.
