# Campaign rulings — "least-effort-5" (C1 · C2 · C5 · C7 · C8)

> **What this file is.** The Shaman's binding rulings for this campaign. Its full content is
> embedded in every executor brief. Executors have **zero design authority**: where a ruling
> below covers your situation, follow it exactly and do not re-litigate it. Where nothing here
> covers an open What/Why question, return `NEEDS_DIRECTION` — do not guess.
>
> Only the Shaman-authority orchestrator or the owner appends here. Append-only; each entry is
> dated and names the card it binds.
>
> **Provenance.** R1–R4 below are carried forward from the aborted 2026-07-17
> `onboarding-category-c` campaign (`docs/tribe/campaigns/onboarding-category-c/answers.md`).
> That campaign shipped nothing, but its *findings* were paid for in real debugging time and
> several are still true. They are restated here — amended where this campaign's owner ruling
> supersedes them — so no executor rediscovers them at cost.

---

## R0 · 2026-07-24 · campaign-wide · Build FRESH from the committed plans; work in a worktree

**Owner ruling, this campaign.** Four of these five cards have unmerged branches left over from
the 2026-07-17 campaign (`feature/C1OpenOnInstall`, `feature/C2VerifiedActivation`,
`feature/C5KeyPasteHygiene`, `feature/C7FinishSetupBadge`). They were cut from `c6cbb01`, which
is well behind today's master.

1. **Do not adopt, rebase, or cherry-pick those branches.** Implement each card fresh from its
   committed spec + plan, on a branch cut from current `origin/master`. The old branches stay on
   the remote as reference only; nothing is deleted.
   - This **supersedes** the "Resume mechanics for C1" paragraph in the old R1, which told the
     executor to adopt `feature/C1OpenOnInstall`. That instruction is void.
   - The old branches may still be **read** for orientation (`git show`, `git log -p`). Reading
     them is free; merging them is forbidden.
2. **Every card works in a git worktree under `.claude/worktrees/<card-slug>`** (owner ruling;
   also the repo's own CLAUDE.md convention). Never implement directly in the main checkout.
   Remove the worktree once the card's PR is merged.

---

## R1 · 2026-07-17 · C1 · The `onInstalled` → options-tab mechanism (carried forward)

**The finding, paid for in real debugging.** `chrome.runtime.openOptionsPage()`, called
synchronously from the `onInstalled` listener at cold `--load-extension` launch, resolves with no
`chrome.runtime.lastError` but **creates no tab**. The same call demonstrably works in the same
harness when triggered later by a user-gesture click. Whether this is a real Chrome quirk or a
Playwright-harness artifact was never resolved — and does not need to be, because the same action
wins under both readings.

**Ruling: build the resilient mechanism. Do NOT accept a documented e2e-only limitation.**

An accepted limitation is refused precisely because it would exempt the category's foundation card
from the category's own proof gate (C10, already shipped, exists to be that gate).

**Mechanism, in preference order:**

1. **Preferred:** in the `onInstalled` listener, use
   `chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })` rather than
   `chrome.runtime.openOptionsPage()`. `chrome.tabs.create` requires **no** permission (the `tabs`
   permission governs reading tab URLs/titles, which this does not do), and on a fresh install
   there is by definition no existing options tab, so `openOptionsPage()`'s only real advantage —
   reusing an open options tab — is moot here.
2. **If that also yields no tab at cold launch:** add a **bounded** retry — a small fixed number of
   attempts, never an unbounded or repeating loop.
3. **If the tab still cannot be produced** after 1 and 2: return `NEEDS_DIRECTION` with the
   evidence. Do **not** silently downgrade to an accepted limitation.

**Do NOT use `chrome.tabs.query` to detect whether the tab appeared** — querying by URL requires
the `tabs` permission, and a new manifest permission is an **owner-only** escalation
(`new-manifest-permission`; ROADMAP §6 E6). No new permission may be added under this ruling.

**The scope fence is unchanged and still binds** (this is a mechanism swap, not a fence cut):
fires **only** on `reason === 'install'`, never on `'update'`; opens **exactly one tab, once** — no
re-prompting loop; skipped entirely when the build bakes an env key; **no new manifest permission**.
C1's "deliberately minimal" framing forbids adding _features_; it does not forbid making the one
specified behavior actually work.

**Keep the decision logic in the domain and the `chrome.*` calls in `sw.ts`**
(`rule-domain-purity`): the swap above is confined to the `sw.ts` side.

---

## R2 · 2026-07-17 · campaign-wide · Standing constraints (carried forward)

Inherited rulings, restated because every executor brief must carry them:

1. **Regular merge commits only — squash-merge is prohibited** (owner, 2026-07-16). A merged card
   PR's merge commit has exactly 2 parents.
2. **Evidence is written, not media** (owner, 2026-07-16). Every PR body carries a **"Testing
   performed"** section — suites run, test counts, e2e scenarios exercised, gates passed. Do not
   capture screenshots or video.
3. **The Shaman authors How** (owner, 2026-07-16). Specs and plans are pre-written and committed on
   master. Executors run them; any plan-vs-reality mismatch beyond trivial mechanical drift is
   `NEEDS_DIRECTION`, not a unilateral redesign.
4. **`GEMINI_API_KEY` in the builder's shell bakes an env-key build that silently disables
   onboarding.** Use `bun run build:chrome:e2e` (which clears it) for every e2e build — this is
   C10's shipped guard and it supersedes any plan text still saying
   `env -u GEMINI_API_KEY bun run build:chrome`.
5. **Playwright spec filters use exact spec names**, never bare substrings.
6. **`docs/index.html` on master IS the deployed landing page** — treat any change to it as a
   production release. None of the cards in this campaign's sequence should need to touch it.
7. Standing constraints from ROADMAP §3 bind unchanged: S1 key isolation · S4 sanitize model output
   (including streamed/partial) · no background LLM calls · design tokens only · ports architecture
   with a dependency-free domain.

---

## R3 · 2026-07-17 · C1 · The `onboarding.spec.ts` regression R1's fix exposes (carried forward)

R1's `chrome.tabs.create` swap leaves a genuine `options.html` tab open from install. The no-key
card's "Open Settings" CTA calls `chrome.runtime.openOptionsPage()`, whose real Chrome behavior is
to **focus/reuse an already-open same-URL tab** rather than create a new one. So
`onboarding.spec.ts`'s third test waits for a `'page'` event that never fires, and times out
deterministically.

**Ruling: update the test. Focusing an existing options tab IS the correct outcome. Do NOT build a
separate tab-creation mechanism for the CTA.**

- Focus-and-reuse is `openOptionsPage()`'s documented Chrome semantics, and it is the better
  product behavior: one settings tab, not two.
- **Duplicate settings tabs are actively harmful in _this_ product.** A16 shipped the sticky save
  bar and its "Unsaved changes" cue specifically because silent settings data loss is a real,
  already-shipped-against failure mode here. Two settings tabs means edit in one, save the other,
  lose the work.
- Giving the CTA its own tab-creation mechanism would mutate the **shared** router `openOptions`
  callback, changing behavior for every caller — a far wider blast radius than C1's fence.
- **No product promise changes**, so this is not an owner escalation: the CTA still takes the user
  to the options page. Nothing promises "in a _new_ tab".

**MANDATORY GUARD — the replacement assertion MUST stay falsifiable.** The old
`waitForEvent('page')` had real power: it failed if the CTA did nothing. Do **NOT** replace it with
"an `options.html` tab exists" — that is now **tautological** (install already opened one), so it
would pass even if the button were completely broken. Silently gutting a live regression test while
appearing to fix it is the one outcome this ruling forbids.

Satisfy it in this preference order:

1. **Assert the transition the click causes:** immediately before the click the `options.html` tab
   is NOT the active tab; after the click it IS the active/focused tab. Additionally assert
   **exactly one** `options.html` tab exists afterwards (proves reuse, not duplication).
2. **If tab activation cannot be observed reliably** in this `--headless=new` harness: in the test's
   arrange step explicitly close the install-created options tab, then keep the original
   `waitForEvent('page')` assertion unchanged (proving the create path still works).
3. **Whichever you use, PROVE falsifiability:** temporarily break the CTA, show the test RED,
   restore it, show it GREEN. Record both runs in the report. A test that cannot be demonstrated to
   fail is not evidence.

**Scope under this ruling:** `packages/extension-chrome/e2e/onboarding.spec.ts` is **IN** scope for
C1. The router's `openOptions` callback and R1's `sw.ts` swap are **NOT** to be changed.

**Any plan text claiming "no existing test's assertions change" is SUPERSEDED** — it rested on a
mechanism (`openOptionsPage()` at install) that never actually worked, per R1. Say so plainly in the
PR's "Testing performed" section rather than quietly editing the test.

---

## R4 · 2026-07-24 · campaign-wide · Never background anything (now enforced, not just ruled)

The 2026-07-17 campaign lost 6 of 14 workers to one failure: a session backgrounded the ~5m30s e2e
suite, ended its turn to "wait for the notification", and **that ended the session** — the runner
scored it `session_incomplete` and the backgrounded process died with its parent. Prose forbidding
this was in force at the time and failed six times.

**It is now enforced at the permission layer** (`todd-skills` PR #49, merged `148d36e`): a
`PreToolUse` hook denies `Bash` with `run_in_background: true`, and denies `Agent`/`Task` unless
they explicitly pass `run_in_background: false`. A denial is the wall working — not a bug, and not
something to route around.

The rule itself is unchanged and still binds:

1. **Run every gate in the FOREGROUND** with an explicit generous timeout. Never `&`, never a
   background task, never "I'll wait for the notification", never `ScheduleWakeup`.
2. **Pass `timeout: 600000` explicitly** on every gate/e2e Bash call — that is the tool's maximum
   (10 min). The default of 120000 ms (2 min) is blown through by the ~5m30s e2e suite, and **that
   default is why sessions reach for the background in the first place.** A foreground command that
   takes 6 minutes is normal and correct — do not "optimize" it into the background.
3. **If a single command genuinely cannot fit**, split the run **by exact spec file name** (never
   bare substrings) and run each part in the foreground.
4. **Never poll a background job.** If you somehow have one, kill it and re-run in the foreground
   rather than ending your turn to wait.

---

## R5 · 2026-07-24 · campaign-wide · Master's format gate and the machine-written state files

`master` was red on `format:check` when this campaign was authored; PR #142 (merge `87df879`) fixed it
and added `.claude/state/` and `docs/tribe/campaigns/` to `.prettierignore`, because the campaign
runner rewrites those files mid-run and formatting them is a moving target.

**Consequence for executors:** do not "fix formatting" in those two trees, and do not remove those
`.prettierignore` entries. If `format:check` fails on a file you did not touch, that is a
`NEEDS_DIRECTION`, not a licence to reformat the repo.
