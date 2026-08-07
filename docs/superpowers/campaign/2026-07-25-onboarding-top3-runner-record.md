# Campaign runner record — onboarding-top3

> Collapsed from `docs/tribe/campaigns/onboarding-top3/` (2026-08-07 docs audit): the runner's
> machine-written run dir is retired; this file preserves its durable outcome —
> the campaign report, the Shaman's binding rulings (answers), and escalations.

---

# Campaign report: onboarding-top3

- Run started: 2026-07-25T03:14:24.773Z
- Run ended: 2026-07-25T04:29:21.786Z
- Exit code: 0 (done)

Stats: 8 shipped, 0 escalated, 0 blocked, 0 not reached.

## Cards

### C5 — shipped
- PR: 152
- Merge sha: c7f57506bc22718c8d44674c5f1957b22fdbb72d

### C6 — shipped
- PR: 154
- Merge sha: 734b5967beb588181dcb16d99a7088a706b3f0f3

### C7 — shipped
- PR: 155
- Merge sha: cb239879bc223102ccf3d972b877c1d87313bf08

### C8 — shipped
- PR: 156
- Merge sha: 2934ffadabf398d511aedf01ae9fc1fd628967fe

### C3 — shipped
- PR: 157
- Merge sha: fe89127e2dc33b7ded0c222233672d1e37409936

### C4 — shipped
- PR: 160
- Merge sha: 44eeb580d17d78d4dc271d32de1216cd35669b54

### C9 — shipped
- PR: 158
- Merge sha: 036cee81a02764ef44fc56e40e2108d2e49b7162

### C11 — shipped
- PR: 159
- Merge sha: 38480de4243cb0eafccd42cbad896e643047a184

## Pending (needs the owner)

(none)

---

# Campaign rulings — "onboarding-top3" (all 8 Category C cards)

> **What this file is.** The Shaman's binding rulings for this campaign. Its full content is
> embedded in every executor brief. Executors have **zero design authority**: where a ruling
> below covers your situation, follow it exactly and do not re-litigate it. Where nothing here
> covers an open What/Why question, return `NEEDS_DIRECTION` — do not guess.
>
> Only the Shaman-authority orchestrator or the owner appends here. Append-only; each entry is
> dated and names the card it binds.
>
> **SCOPE — read this before the rulings.** This campaign started as 3 cards (C5 · C8 · C3) and was
> **extended by owner directive on 2026-07-25 to all 8 unshipped Category C cards**. R10 below
> records that extension and is authoritative; several rulings written during the 3-card phase say
> "this campaign" meaning the original three, and R10/R11 extend them explicitly where that matters.
>
> **Run order — `C5 → C6 → C7 → C8 → C3 → C4 → C9 → C11`** (the roadmap's own Category C
> sequencing). **C3 must precede C4 and C11**: all three edit `docs/index.html`, and merging that to
> `master` deploys the public landing page. No card declares a `dependsOn` — every real dependency
> is already shipped (C1 #144, C2 #148, C10 #113) or satisfied by this order.
>
> **The category's measured goal is now in scope:** audited funnel dead-ends **7 → 0**, each closure
> proven by the C10 e2e harness.
>
> **C7 is owned by THIS campaign** as of R10. The `least-effort-5` state file still lists it as
> `staged` — that record is stale bookkeeping; never dispatch C7 from there.
>
> **Provenance.** R1–R5 are carried forward verbatim in substance from the `least-effort-5`
> campaign (`docs/tribe/campaigns/least-effort-5/answers.md` R0, R2, R4, R5, R6/R7). They were
> paid for in real debugging on C1/C2 and bind unchanged here. R6–R16 are new.

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

## R9 · 2026-07-25 · campaign-wide · `bun install` in EVERY worktree before running any gate

**Read this before your first `bun run lint`. It will otherwise cost you a wasted escalation.**

**What you will see.** In a freshly created worktree, `bun run lint` reports
**`✖ 1610 problems (1610 errors, 0 warnings)`** and exits 1 — in a tree where you have changed
nothing, or changed only markdown. The errors are all type-awareness rules:
`@typescript-eslint/no-unsafe-assignment` ("Unsafe assignment of an **error typed** value"),
`no-unsafe-call` / `no-unsafe-member-access` ("...of a type that **could not be resolved**").

**The cause — not a flake, and not your code.** `git worktree add` checks out tracked files only.
`node_modules` is gitignored, so **a new worktree has none.** Without it, typed-eslint cannot
resolve a single type, every type degrades to `error`, and every type-aware rule fires at once.
The count is large and constant precisely because it is whole-repo, not localised.

**Measured proof (2026-07-25, worktree `campaign-8cards`, markdown-only changes):**

| Where | `node_modules` | `bun run lint` |
| --- | --- | --- |
| worktree, before install | ABSENT | **exit 1** — 1610 problems, reproduced 3× consecutively |
| main checkout, same moment | PRESENT | **exit 0** |
| worktree, after `bun install` | PRESENT | **exit 0** |

**Ruling.**

1. **Run `bun install` as the first command in every new worktree**, before any gate, build, or
   e2e run. R1 makes every card work in a worktree, so this applies to **every card**.
2. **Never "fix" these errors.** Do not touch source, do not relax an eslint rule, do not edit
   tsconfig. Install the dependencies and re-run.
3. **Re-running without installing will NOT clear it** — it reproduces indefinitely. Repeat-until-
   green is the wrong response here; installing is the only one.
4. Only if `bun run lint` still fails **after a successful `bun install`** is the failure real.
   A small, localised set of errors in files you actually touched is real and yours to fix.
5. **Measure the exit code correctly.** `bun run lint | tail -6; echo $?` reports **`tail`'s** exit
   status, not the lint's — it prints `0` for a failing run. Run the gate bare
   (`bun run lint; echo $?`), or use `${PIPESTATUS[0]}`. This trap is how the root cause was
   initially misdiagnosed as a flake.
---

## R10 · 2026-07-25 · campaign-wide · Campaign extended to all 8 Category C cards

**Owner directive (2026-07-25):** add the 5 highest-value remaining ideas to the running campaign,
making 8. The owner chose **"finish Category C"** over a strict cross-roadmap score ranking, so the
campaign now carries **every unshipped Category C card** and the category's own measured goal comes
into scope: **audited funnel dead-ends 7 → 0**, each closure proven by the C10 e2e harness
(shipped, PR #113).

**Full sequence — `C5 → C6 → C7 → C8 → C3 → C4 → C9 → C11`.** This is the roadmap's own stated
Category C sequencing (ROADMAP §4 C-preamble), not a new ordering. Two orderings inside it are
load-bearing and must not be rearranged:

1. **C3 before C4 and C11.** All three touch `docs/index.html`. C3 creates the try-it section;
   C4 adds per-provider key instructions to `#start`; C11 makes the checklist install-aware. Each
   later card builds on the earlier one's page state. Running them out of order means conflicting
   edits to a **deployed production page**.
2. **C2 (shipped) before C4.** C4's provider picker requires C2's verified-activation round-trip to
   test the *chosen* provider, not a hard-wired Gemini one.

No card declares `dependsOn`: every real dependency is either already shipped (C1, C2, C10) or
satisfied by sequence order. **C7 is now owned by THIS campaign** — remove it from any mental model
of `least-effort-5`, whose state file still lists it as `staged`. Do not run it from there.

---

## R11 · 2026-07-25 · C4 + C11 · R6's `docs/index.html` fence extends to these two cards

R6 lifted R2.6's "never touch `docs/index.html`" for C3. **C4 and C11 edit that same deployed page**
and are governed by the **identical fence** — re-read R6 in full and apply every clause. Restated
because merging to `master` **is** deploying:

- **C4** adds per-provider key instructions to the `#start` section. ROADMAP §4 C4's landing-page
  note is binding: *"the page and the welcome screen must never disagree about how to get a key."*
  The `#start` update ships **in the same PR** as the welcome-screen picker, never as a follow-up.
- **C11** adapts the `#start` checklist to install state. The page **must render perfectly with no
  extension installed** — with no marker present it is exactly today's static page. This is not a
  nice-to-have: most visitors arrive without the extension.

All of R6 still binds for both: additive only · **S1 absolute** (the page never collects, receives,
renders, or references the API key) · EN/VI parity · `--ad-*`/`--adp-*` tokens only · e2e never
fetches the live site (local fixture via `gotoFixture`).

---

## R12 · 2026-07-25 · C11 · The install marker's contents are a PRIVACY fence — the list is closed

ROADMAP §4 C11 delegates "marker shape, checklist UX" to the lead, but fences the *contents*
explicitly, and adds: *"if anyone proposes exposing more state to the page, THAT is a privacy
escalation per §1."* That makes this the highest-risk card in the campaign. Pre-ruled:

1. **The marker carries exactly two things: install state, and extension version.** Optionally one
   boolean `setup finished`. **That list is closed.** Never settings, never the key or any
   derivative of it (not a prefix, not a length, not a hash, not "which provider"), never saved
   words, never usage or lookup history, never anything user-specific.
2. **Anything beyond that list is `privacy-surface-change` — an owner-only escalation.** Do not
   rule on it, do not add "just one more useful field". Return `NEEDS_DIRECTION`.
3. **Stamped ONLY on the landing origin.** The content script runs under `<all_urls>`; the marker
   must be gated to the landing page's own origin and must never appear on any other site. A marker
   leaking onto third-party pages is a privacy incident, not a bug.
4. **The marker is write-only from extension to page.** The page never sends anything back, and the
   extension never reads page state through it. One direction, non-sensitive, non-identifying.
5. No new manifest permission — `<all_urls>` already covers this. A new permission is owner-only.

---

## R13 · 2026-07-25 · C6 · Deep-link via a stored flag; no new error taxonomy

ROADMAP §4 C6 delegates "deep-link mechanism (hash param vs. stored flag)". Pre-ruled to avoid an
escalation on a mechanism choice:

1. **Prefer a stored flag** (`chrome.storage` / the existing KV prefixes) over a URL hash param.
   A hash on the options page URL is user-visible, survives bookmarking, and can re-trigger fix-key
   mode on an unrelated later visit. A flag is read once and cleared. If the plan already specifies
   a hash param, **follow the plan** — it is committed How and R2.3 binds.
2. **Reuse the existing `connection.test` path and the existing error mapper.** C6 adds no new wire
   message and no new error taxonomy — its scope fence says so explicitly.
3. **The auto-retest after edit is user-triggered** in the sense that constraint 4 requires: it runs
   because the user edited and submitted a key, never on page load, never on a timer.
4. The card's copy may link the landing FAQ (`#faq`) for long-form "why was my key rejected"
   explanations; the card itself stays terse.

---

## R14 · 2026-07-25 · C7 · The badge is a no-key indicator only

ROADMAP §4 C7 delegates "badge glyph/color (tokens)". Pre-ruled:

1. **v1 is a no-key indicator and nothing else.** Not a general notification channel, not an error
   surface, not a count. It appears while no usable key exists and clears the moment activation
   succeeds.
2. **Env-key builds never show it** — those builds have a working key by construction (C10's
   `build:chrome:e2e` clears it, so e2e still exercises the badge).
3. `chrome.action.setBadgeText` / `setBadgeBackgroundColor` need **no new permission**. If an
   implementation seems to need one, that is `NEEDS_DIRECTION`, not a manifest edit.
4. Colour comes from the design tokens; badge text stays a single short glyph. Do not introduce a
   hard-coded hex — R2.7 and the token law bind here as everywhere.

---

## R15 · 2026-07-25 · C9 · Read-only checks, one explicit test, no background work

ROADMAP §4 C9 delegates "check list v1". Pre-ruled:

1. **Check list v1 is exactly three rows:** (a) key present, per provider; (b) active provider
   responds — the one explicit, user-clicked `connection.test`, with its token cost disclosed;
   (c) keyboard shortcuts assigned, via `chrome.commands.getAll`.
2. **Every check is read-only except the connection test**, and the whole panel **runs only on an
   explicit click** — nothing on page load, nothing on a timer, nothing in the background. This is
   standing constraint "every LLM call user-triggered", and it is not negotiable for a
   "health check" framing.
3. **No new permissions.** The `commands` API is already granted by the `commands` manifest key.
4. Each row carries one concrete fix or deep link; failing rows may link the landing FAQ. Rows stay
   one line — this is a diagnostic panel, not a documentation page.
5. C9 is the **lowest-scored card in the campaign (1.5)**. Hold its scope tight: if it starts
   growing beyond the three rows above, that is scope creep, not thoroughness.

---

## R16 · 2026-07-25 · campaign-wide · Known-flaky e2e specs — diagnose against master before "fixing"

**Observed on this campaign's own docs-only PR #153** (markdown + JSON only, zero product code):
`e2e-chrome` failed, then **passed on a plain re-run of the same commit**. Two specs flaked:

| Spec | Symptom |
| --- | --- |
| `e2e/c2-verified-activation.spec.ts:80` — "double-click … fires exactly one connection.test call" | `locator.click: Target page, context or browser has been closed` / `Element is not visible` |
| `e2e/cooldown.spec.ts:17` — "rapid second Define within 2s is blocked" | expected the slow-down copy, got `"Looking up the meaning…"` — the first lookup had not settled |

Both are **timing/infrastructure races**, not assertions about your change.

**Ruling — the diagnosis order, before you touch a single test:**

1. **Check whether `master` is green at your base sha** (`gh run list --branch master`). If master
   is green and your branch only adds files master doesn't have, an e2e failure is almost
   certainly a flake — that is exactly how PR #153 was diagnosed.
2. **Re-run the failed job once** (`gh run rerun <id> --failed`). If it passes, it was a flake.
   Record that in the PR body's "Testing performed" — do not hide it.
3. **Never "stabilise" a flaky spec by weakening it** — no removed assertion, no `test.skip`, no
   loosened matcher, no bumped timeout to paper over a race. That converts a flaky test into a
   blind one, and these two specs guard real C2 behaviour (exactly-one `connection.test` call) and
   real cooldown behaviour (no extra Gemini call).
4. **If the SAME spec fails twice on the same commit, it is real** — especially if it touches the
   surface your card changed. C5/C6/C7/C4/C9 all touch the key/activation path that
   `c2-verified-activation.spec.ts` guards, so a genuine regression there is plausible and must
   not be waved off as flake. Fix the cause, or return `NEEDS_DIRECTION` with the evidence.
5. A flake in a spec **unrelated** to your card is never a reason to hold the card. A repeated
   failure in a spec **related** to your card always is.
