# Campaign snapshot — learning-spine-5 (2026-08-06 → 2026-08-07)

Owner directive: "pick 5 ideas and use campaign orchestration runner to implement. if the
reviewer find any unwritten convention, you decide it, only raise to me if you can not design."

Card selection resumed the owner-ratified 2026-07-16 sequence at its first unshipped entries
(B5/B8/A9 and Category C had shipped since): **B3 → B4 → A6 → A10 → A15**. Specs/plans were the
already-merged 2026-07-16/17 authoring wave (`planning.mode: shaman`, adopted). Executor model:
opus. Merge policy: regular merge only, all checks green (or a documented R8 exception, below).

## Outcome — 5/5 shipped, every card independently verified

| Card | Idea                      | PR                                                  | Merge sha              | verify-shipped |
| ---- | ------------------------- | --------------------------------------------------- | ---------------------- | -------------- |
| B3   | Re-encounter highlighting | [#173](https://github.com/hieplam/ai-dict/pull/173) | `4ec27777` (2 parents) | PASS 3/3       |
| B4   | Hover-recall              | [#174](https://github.com/hieplam/ai-dict/pull/174) | `0547e3a5` (2 parents) | PASS 3/3       |
| A6   | Smart card placement      | [#175](https://github.com/hieplam/ai-dict/pull/175) | `037b98c0` (2 parents) | PASS 3/3       |
| A10  | TTS pronunciation         | [#177](https://github.com/hieplam/ai-dict/pull/177) | `6e5493c8` (2 parents) | PASS 3/3       |
| A15  | Trigger latency budget    | [#178](https://github.com/hieplam/ai-dict/pull/178) | `335af5b6` (2 parents) | PASS 3/3       |

## The defining incident: a GitHub Actions capacity outage (~15:43 → ~23:30 UTC 2026-08-06)

Hosted runners stopped being acquired mid-campaign (`install` jobs cancelled with 0 steps,
annotation "The job was not acquired by Runner of type hosted"; later, new pushes produced no
CI run at all). Shaman rulings issued (full text in the campaign home's `answers.md`):

- **R8 — outage merge protocol:** an outage may change _where_ proof runs, never waive it.
  Merge is authorized only after **full local gate parity on the exact PR head SHA** (every
  CI-registry gate: lint incl. 6 hard-rule scanners, format, typecheck, unit + wire-contract
  suites, per-package coverage, both builds, full Chrome e2e), documented in the PR body as an
  "Infra-outage exception — local gate parity" section with outage evidence — plus a mandatory
  post-outage closure: master CI green. B3 (#173), B4 (#174) and A6 (#175) merged under it.
- **R10/R13 — schemaGuard adjudications:** B3's `types.ts` delta is one additive settings flag
  (`PublicSettings.highlightSavedWords`, legacy read `?? true`); E1 shapes untouched. Later
  cards tripped the same guard purely because their recorded `baseSha` predated B3's merge
  while their own PR diffs touched `types.ts` zero times — bookkeeping, reconciled.
- **R11 — pre-existing master nightly reds** (`secret-scan` gitleaks step; `dep-audit` bun
  audit, nightly-blocking; failing since 2026-08-05, green 08-04) are out of campaign scope —
  a separate hygiene defect for the owner.
- **R12 — A6's world-safe positioning deviation affirmed:** the plan's cross-world
  `positionNear()` method call cannot cross MV3's ISOLATED/MAIN world boundary; measuring via
  the element's open shadow root + native inline styles is the correct in-authority fix.

**R8 closure:** GitHub recovered ~23:30 UTC; master CI run on `335af5b` (contains all five
merges) — result recorded in the PR that lands this snapshot.

## Runner gaps found (fix-list for the tribe plugin, not this repo)

1. **D4 blind spot:** `card.branch` is only ever filled from an existing PR, so a pre-PR kill
   leaves branch/worktree/session traces invisible and the matrix respawns `fresh` (collision
   risk). Worked around by hand-reconciling `branch` into campaign-state.json at each kill.
2. **Resume ≠ ruling delivery:** a resumed session never re-reads `answers.md` (only fresh
   briefs paste it), so an escalated-then-resumed card re-asks answered questions. Worked
   around by nulling `sessionId` to force the F8 fresh-with-digest path.
3. **schemaGuard uses a stale base:** D3 diffs `baseSha → master` instead of the card's own PR
   diff, so every post-B3 card false-tripped the guard.

## Operational log

14 runner launches; 1 genuine quota exit (code 3, all four concurrent executor sessions died at
16:26 UTC), 1 escalations exit (code 2), the rest external kills of the background task. A
15-minute cron watch loop (survives usage-limit pauses, resumes on quota refresh) drove every
recovery: verify world → reconcile state → relaunch. Auto-answer rounds used: B3 2/2 (second
round needed only because of runner gap #2), A6 1/2, A10/A15 bookkeeping-only.
