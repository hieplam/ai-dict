# Campaign rulings — "Onboarding overhaul — Category C"

> **What this file is.** The Shaman's binding rulings for this campaign. Its full content is
> embedded in every executor brief. Executors have **zero design authority**: where a ruling
> below covers your situation, follow it exactly and do not re-litigate it. Where nothing here
> covers an open What/Why question, return `NEEDS_DIRECTION` — do not guess.
>
> Only the Shaman-authority orchestrator or the owner appends here. Append-only; each entry is
> dated and names the card it binds.

---

## R1 · 2026-07-17 · C1 · The `onInstalled` → options-tab mechanism

**The question that was escalated.** C1's Tasks 1+2 are committed on `feature/C1OpenOnInstall`
(`646dec3`, `302c74e`). Task 3's e2e is genuinely RED: `chrome.runtime.openOptionsPage()`, called
synchronously from the `onInstalled` listener at cold `--load-extension` launch, resolves with no
`chrome.runtime.lastError` but **creates no tab**. The same call demonstrably works in the same
harness when triggered later by a user-gesture click (`onboarding.spec.ts`, still green).
Two hypotheses were raised and neither was resolved: **(a)** a real Chrome quirk that could also
hit real users on a cold browser start, or **(b)** a Playwright-harness-only artifact.

**Ruling: build the resilient mechanism. Do NOT accept a documented e2e-only limitation.**

The (a)-vs-(b) question does **not** need to be resolved first, because the same action wins under
both hypotheses — that is why this is decidable now:

- If (a) is true, the plan's literal mechanism misses C1's own measurable goal ("100% of new
  installs see Welcome"), so resilience is mandatory.
- If (b) is true, resilience costs a few lines and makes the card provable by e2e — which
  Category C's measured goal explicitly requires ("each closure proven by a fresh-profile e2e
  run"). C10 was built to be exactly that proof harness, and C1 is the first card it must prove.

An accepted limitation is refused precisely because it would exempt the category's foundation
card from the category's own proof gate.

**Mechanism, in preference order:**

1. **Preferred:** in the `onInstalled` listener, replace `chrome.runtime.openOptionsPage()` with
   `chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })`. `chrome.tabs.create`
   requires **no** permission (the `tabs` permission governs reading tab URLs/titles, which this
   does not do), and on a fresh install there is by definition no existing options tab, so
   `openOptionsPage()`'s only real advantage — reusing an open options tab — is moot here.
2. **If that also yields no tab at cold launch** (the quirk is broader than one API): add a
   **bounded** retry — a small fixed number of attempts, never an unbounded or repeating loop.
3. **If the tab still cannot be produced** after 1 and 2: return `NEEDS_DIRECTION` with the
   evidence. Do **not** silently downgrade to an accepted limitation.

**Do NOT use `chrome.tabs.query` to detect whether the tab appeared** — querying by URL requires
the `tabs` permission, and a new manifest permission is an **owner-only** escalation
(`new-manifest-permission`; ROADMAP §6 E6). No new permission may be added under this ruling.

**The scope fence is unchanged and still binds** (this ruling is a mechanism swap, not a fence
cut): fires **only** on `reason === 'install'`, never on `'update'`; opens **exactly one tab,
once** — no re-prompting loop; skipped entirely when the build bakes an env key; **no new
manifest permission**. C1's "deliberately minimal" framing forbids adding _features_; it does not
forbid making the one specified behavior actually work.

**Task 1 stays as-is.** `shouldOpenOnboardingOnInstall` (`packages/app/src/domain/onboarding-policy.ts`)
is pure, unit-tested, and correct — the diagnosis confirmed it evaluates `true`. Keep the decision
logic in the domain and the `chrome.*` calls in `sw.ts` (`rule-domain-purity`): the swap above is
confined to the `sw.ts` side.

**Resume mechanics for C1.** Branch `feature/C1OpenOnInstall` and worktree
`.claude/worktrees/c1-open-on-install` are preserved and pushed; adopt them rather than
re-implementing (Tasks 1+2 are done, gated, and independently verified). The untracked RED
`packages/extension-chrome/e2e/c1-open-on-install.spec.ts` in that worktree is a **diagnostic
reference only — do not salvage it**: `git reset --hard && git clean -fd` in the worktree, then
redo Task 3 fresh against this ruling.

---

## R2 · 2026-07-17 · campaign-wide · Standing constraints carried into this campaign

These are inherited rulings, restated because every executor brief must carry them:

1. **Regular merge commits only — squash-merge is prohibited** (owner, 2026-07-16). A merged card
   PR's merge commit has exactly 2 parents.
2. **Evidence is written, not media** (owner, 2026-07-16). Every PR body carries a **"Testing
   performed"** section — suites run, test counts, e2e scenarios exercised, gates passed. Do not
   capture screenshots or video.
3. **The Shaman authors How** (owner, 2026-07-16). Specs and plans are pre-written and committed
   on master. Executors run them; any plan-vs-reality mismatch beyond trivial mechanical drift is
   `NEEDS_DIRECTION`, not a unilateral redesign.
4. **`GEMINI_API_KEY` in the builder's shell bakes an env-key build that silently disables
   onboarding.** Use `bun run build:chrome:e2e` (which clears it) for every e2e build — this is
   C10's shipped guard and it supersedes any plan text still saying
   `env -u GEMINI_API_KEY bun run build:chrome`.
5. **Playwright spec filters use exact spec names**, never bare substrings.
6. **`docs/index.html` on master IS the deployed landing page** — treat any change to it as a
   production release. None of the cards in this campaign's sequence should need to touch it.
7. Standing constraints from ROADMAP §3 bind unchanged: S1 key isolation · S4 sanitize model
   output (including streamed/partial) · no background LLM calls · design tokens only · ports
   architecture with a dependency-free domain.

---

## R3 · 2026-07-17 · C1 · The `onboarding.spec.ts` regression that R1's fix exposed

**The escalation (auto-answer round 1 of a maximum 2).** R1's `chrome.tabs.create` swap works and
C1's own new e2e is green — but it now leaves a genuine `options.html` tab open from install. The
no-key card's "Open Settings" CTA calls `chrome.runtime.openOptionsPage()`, whose real Chrome
behavior is to **focus/reuse an already-open same-URL tab** rather than create a new one. So
`onboarding.spec.ts`'s third test waits for a `'page'` event that never fires and times out
deterministically. Two options were put to me: (a) update the test's assertion, or (b) give the
CTA its own tab-creation mechanism.

**Ruling: (a) — update the test. Focusing an existing options tab IS the correct outcome. Do NOT
build a separate tab-creation mechanism for the CTA.**

Why:

- Focus-and-reuse is `openOptionsPage()`'s documented Chrome semantics, and it is the better
  product behavior: one settings tab, not two.
- **Duplicate settings tabs are actively harmful in _this_ product.** A16 shipped the sticky save
  bar and its "Unsaved changes" cue specifically because silent settings data loss is a real,
  already-shipped-against failure mode here (ROADMAP A16: "the user edits a field, navigates away,
  and never realizes it was never saved"). Two settings tabs means edit in one, save the other,
  lose the work. Option (b) would manufacture that exact hazard deliberately.
- Option (b) also mutates the **shared** router `openOptions` callback, changing behavior for
  every caller — a far wider blast radius than C1's own fence, incurred purely to keep one test's
  assertion literal. The assertion encodes the _old broken mechanism's_ incidental side effect
  (a new tab appeared only because `openOptionsPage()` had silently failed at install), not a
  product promise.
- **No product promise changes**, so this is not an owner escalation: the CTA still takes the user
  to the options page. Nothing promises "in a _new_ tab".

**MANDATORY GUARD — the replacement assertion MUST stay falsifiable.** The old
`waitForEvent('page')` had real power: it failed if the CTA did nothing. Do **NOT** replace it
with "an `options.html` tab exists" — that is now **tautological** (install already opened one),
so it would pass even if the button were completely broken. Silently gutting a live regression
test while appearing to fix it is the one outcome this ruling forbids.

Satisfy it in this preference order:

1. **Assert the transition the click causes:** immediately before the click the `options.html` tab
   is NOT the active tab; after the click it IS the active/focused tab. Additionally assert
   **exactly one** `options.html` tab exists afterwards (proves reuse, not duplication).
2. **If tab activation cannot be observed reliably** in this `--headless=new` harness: in the
   test's arrange step explicitly close the install-created options tab, then keep the original
   `waitForEvent('page')` assertion unchanged (proving the create path still works).
3. **Whichever you use, PROVE falsifiability:** temporarily break the CTA, show the test RED,
   restore it, show it GREEN. Record both runs in the report. A test that cannot be demonstrated
   to fail is not evidence.

**Scope under this ruling:** `packages/extension-chrome/e2e/onboarding.spec.ts` is **IN** scope for
C1. The router's `openOptions` callback and R1's `sw.ts` swap are **NOT** to be changed.

**The plan's §5 claim "no existing test's assertions change" is SUPERSEDED** — it rested on a
mechanism (`openOptionsPage()` at install) that never actually worked, per R1. Say so plainly in
the PR's "Testing performed" section rather than quietly editing the test.

---

## R4 · 2026-07-17 · campaign-wide · The 2026-07-17 rate-limit stall (context, not a ruling)

The first runner pass stalled for a reason unrelated to any card's merits: the account's
**five-hour session usage limit** (HTTP 429, overage disabled at org level). C5, C7 and C8 each
died after a single turn having done nothing; C2 stalled mid-implementation after 3 real commits.
This is recorded so no executor mistakes those cards for failed work and starts over: **C2's
commits on `feature/C2VerifiedActivation` are valid and must be continued, not rebuilt.** The
limit reset at 09:10 local.

---

## R5 · 2026-07-17 · campaign-wide · NEVER background the e2e/gate run (livelock — binding on every card)

**Observed twice, cost ~2 usage windows.** An executor session that launches the e2e suite as a
**background** task and then ends its turn to "wait for the notification" **kills itself**: ending
the turn ends the session, the runner scores it `session_incomplete` (exit 3), and the backgrounded
e2e process dies with its parent. The next pass resumes into the identical trap. This is a
livelock, not a slow test — no amount of waiting resolves it.

**Ruling — binding on every card in this campaign:**

1. **Run every gate in the FOREGROUND**, with an explicit generous timeout. Never `&`, never a
   background task, never "I'll wait for the notification", never `ScheduleWakeup` (that tool is
   for `/loop` pacing and does nothing here).
2. **Budget the timeout generously — but the Bash tool's MAXIMUM is `600000` ms (10 min).**
   Pass `timeout: 600000` explicitly on every gate/e2e Bash call. The default is only 120000 ms
   (2 min), which the ~5m30s e2e suite blows through — **that default is WHY sessions reach for
   the background in the first place.** 600000 ms comfortably covers the suite. A foreground
   command that takes 6 minutes is completely normal and correct here — do not "optimize" it into
   the background.
   (Correction 2026-07-17: an earlier revision of this ruling said 900000 ms. That EXCEEDS the
   tool's 600000 ms cap and would be rejected/clamped — use 600000.)
3. **If a single command genuinely cannot fit the timeout**, split the run **by spec file**
   (exact spec names — learnings #5, never bare substrings) and run each in the foreground.
   Splitting is always preferred over backgrounding.
4. **Never poll a background job** you started; if you have already backgrounded one by mistake,
   kill it and re-run in the foreground rather than ending your turn to wait.

Rationale: the runner's only signal of progress is the session completing its turn. A session that
ends its turn to wait is indistinguishable from a dead one, and the runner is correct to treat it
as incomplete. Foreground-with-a-long-timeout is the only shape that survives.
