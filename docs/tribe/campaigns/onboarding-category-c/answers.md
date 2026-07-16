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
