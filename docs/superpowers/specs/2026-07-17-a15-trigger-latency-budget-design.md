# A15 — Trigger latency budget

Roadmap card: `docs/ROADMAP.md` §4 A15 (Impact 3 · Effort S · Score 3.0). Depends on: — (independent).
Scope fence (from the card, held exactly): **"Budget + test on the existing trigger; no behavior
change."** Lead-decidable items per the card: exact budget numbers, test placement.

## 1. Problem (grounded in code)

Today the "Define" bubble (the floating trigger button that appears after a text selection) has no
written speed target and no test guarding it:

- The selection → trigger pipeline is `DomSelectionSource.onSelection` (registers on `mouseup` and
  `touchend`, `packages/app/src/app/dom-selection-source.ts:41-50`) → the domain workflow's
  `deps.selection.onSelection((e) => { deps.trigger.show(e.anchor, () => {...}) })`
  (`packages/app/src/domain/workflow.ts:123-139`, the callback body is synchronous — there is no
  `await` between the selection event and the `trigger.show()` call) → the Chrome adapter's
  `ChromeFloatingTrigger.show()` (`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts:29-42`),
  which creates (or reuses) a `<lookup-trigger>` element, appends it to `this.host` (`:35`,
  `document.body` by default per `content.ts:20`), and sets `position:fixed` + `left`/`top` inline
  styles (`:39-41`) to anchor it under the selection.
- `content.ts` wires the real pipeline at `packages/extension-chrome/src/content.ts:73-75`:
  `selection: new DomSelectionSource(document), trigger, ...` — this is the exact, unmodified path
  A15 instruments.
- No file in this repo calls `performance.mark`/`performance.measure`, and no e2e spec asserts
  timing today (confirmed: `grep -rn "performance\.\(mark\|now\|measure\)" packages/` outside test
  files returns zero hits). No file uses the native `selectionend` DOM event either (`grep -rn
selectionend packages/` returns zero hits) — the actual trigger mechanism the codebase uses is
  `mouseup`/`touchend` (`dom-selection-source.ts:46`), not the browser's `Selection.selectionend`
  event, which this project never wires up.
- The result: on a heavy host page (deep DOM, expensive `mouseup` listeners elsewhere, layout
  thrashing already in flight from the page itself), the bubble's appearance has no enforced
  ceiling and nothing in CI would catch a regression that made it noticeably slower, or a change
  that accidentally introduced synchronous layout thrashing into the show path.

## 2. What does "50ms after selectionend" mean in this codebase? (grounding the card's own language)

The roadmap card's language — "button visible < 50ms after selectionend" — uses `selectionend`
loosely (the moment the user's selection gesture ends), not literally (the DOM `selectionend`
event, which §1 confirms this codebase never uses). Pinned equivalence, so the budget has a single,
unambiguous, code-grounded meaning for every future reader of this spec and its test:

- **"Selection ends"** = the `mouseup`/`touchend` handler `DomSelectionSource.onSelection` installs
  firing with a non-null read (`dom-selection-source.ts:42-45`) — i.e. the exact moment the browser
  dispatches the event this codebase actually listens for.
- **"Button visible"** = the point immediately after `ChromeFloatingTrigger.show()` finishes writing
  the trigger's `position`/`left`/`top` styles (`chrome-floating-trigger.ts:39-41`) and the browser
  has scheduled a paint reflecting them — operationalized as "the next animation frame after
  `show()`'s synchronous work completes" (§3 explains why a single `requestAnimationFrame` tick is
  the chosen proxy, not the raw synchronous return of `show()`).

**Rejected: defining the budget in terms of the literal `selectionend`/`Selection` API events.**
Would require wiring a DOM API this codebase deliberately does not use (the existing
`mouseup`/`touchend` listeners already capture "selection gesture ended" reliably across mouse and
touch — the product's actual behavior). Redefining the trigger event to match the card's loose
wording would be an unrelated, unrequested behavior change, which the card's own fence forbids.

## 3. Instrumentation: where to add marks (cheap, permanent, and where "visible" actually happens)

Two `performance.mark()` calls, one per side of the pipeline, cited exactly:

- **`SELECTION_FIRED_MARK = 'ai-dict:selection-fired'`**, exported from
  `packages/app/src/app/dom-selection-source.ts`. Recorded inside `onSelection`'s handler
  (`:42-45`), immediately before `cb(e)` — i.e. only on a real, non-null selection (a collapsed or
  whitespace-only selection never fires it, so the mark timeline is never polluted by every
  incidental page click). This point is the earliest synchronous JS observation of "the browser
  told us the selection gesture ended."
- **`TRIGGER_SHOWN_MARK = 'ai-dict:trigger-shown'`**, exported from
  `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`. Recorded at the end of
  `show()` (after `:41`), wrapped in a single `requestAnimationFrame(() => performance.mark(...))`.

**Why `requestAnimationFrame`, not a synchronous mark right after `:41`.** `show()`'s own JS work
(DOM append + inline style writes) finishes in well under a millisecond — marking synchronously
there would measure "how fast is `show()`'s own JS," not "how fast does the button actually become
visible." A single `rAF` callback fires immediately before the browser's next paint, which is the
closest JS-observable proxy to "the browser is about to paint this frame, including the trigger" —
without needing a heavier double-`rAF` or the non-standard `requestPostAnimationFrame`. This is
diagnostic-only: it does not change when the styles are written (`:39-41` are unchanged, still
fully synchronous), so the button's actual on-screen appearance timing is untouched — only the
_measurement_ of it is deferred by one frame. This satisfies the card's "no behavior change" fence.

**Why these two files and not, e.g., a mark inside `workflow.ts`.** `workflow.ts`'s selection
callback (`:123-139`) is a pure pass-through with zero work of its own between the selection event
and calling `trigger.show()` — marking on either side of that call would measure the same instant
plus JS-engine noise, adding a third mark for no additional signal. Two marks, one per real unit of
work (detect → render), is the minimal instrumentation that answers the budget question.

**Cross-world visibility, verified.** `content.ts` (where both classes run) executes in Chrome
MV3's isolated content-script world (`manifest.json`'s `content.js` entry — no `world` key, which
defaults to `ISOLATED` — `packages/extension-chrome/src/manifest.json:46-54`; the sibling entry at
`:36-45` is the separate `content-elements.js` script, explicitly declared `"world": "MAIN"`),
while e2e assertions run via Playwright's
`page.evaluate()`, which executes in the page's **main** world. The `Performance`
timeline is a per-document, not per-JS-realm, browser object — confirmed empirically against this
exact repo's build (`bun run build:chrome:e2e`, marks added temporarily to both files, loaded via
the same `chromium.launchPersistentContext` pattern `e2e/fixtures.ts` uses): a `performance.mark()`
call made from the isolated-world content script was visible to, and measurable via
`performance.measure()` from, a `page.evaluate()` call in the main world, across 6 consecutive
selection cycles, with `ai-dict:selection-fired` → `ai-dict:trigger-shown` durations of
**4.8–7.2ms**. This confirms the plan's e2e measurement approach works before any plan task is
written, not just in theory.

## 4. The budget numbers (pinned)

- **Product budget (documentation only, never runtime-enforced): 50ms**, exactly the number the
  roadmap card states. No runtime warning, telemetry, or console log is added for a slow frame —
  the card's fence is "budget + test," not a new runtime behavior; a `docs/ROADMAP.md`-visible
  written budget plus a CI test are the entire deliverable.
- **CI assertion ceiling per trial: 150ms** (3× the product budget). Rationale, calibrated against
  real measurements on this repo's exact e2e harness (bundled Chromium, `--headless=new`, the same
  launch path `e2e/fixtures.ts` uses):
  - A throwaway probe driving the real built extension (`bun run build:chrome:e2e`, temporary marks
    added and reverted before this spec was written — no source changes ship from this
    measurement) recorded `mouseup`-dispatch-to-`<lookup-trigger>`-DOM-attached elapsed times of
    **2.3–5.6ms** across 7 of 8 trials, with a single cold-start outlier of **28.5ms** (first
    interaction after navigation, JIT/extension warm-up). The mark-to-mark (`rAF`-inclusive)
    measurement in §3 above showed 4.8–7.2ms.
  - This is a synchronous, non-network, non-async code path (DOM append + inline style write +
    one `rAF` tick) — there is no I/O for CI scheduling jitter to compound against. A regression
    big enough to matter (e.g. an accidentally reintroduced `await`, a synchronous layout loop, or
    genuine host-page contention) will overshoot 150ms by a wide margin, not graze it; 150ms gives
    roughly 20–30× headroom over steady-state and ~5× headroom over the observed cold-start
    outlier, so CI flake risk from this margin is very low while the gate still means something.
  - **Rejected: asserting only the mean/median of N trials.** A regression that is slow on some
    but not all interactions (e.g. one that adds work conditionally) could hide inside an averaged
    pass. §5 pins per-trial assertions instead.
  - **Rejected: matching the 50ms product budget exactly in CI.** Headless CI has no display
    vsync guarantee behind `rAF`, and this repo's own e2e suite already documents variance
    concerns (`playwright.config.ts:12-16`: serialized workers specifically because parallel runs
    on one machine cause timing-sensitive waits to flake). A CI gate equal to the product target
    would trade a real budget question ("did we regress?") for a machine-throughput question ("is
    the CI runner fast today?").

## 5. Flake control: trial count and per-trial assertion (pinned)

- **5 trials per test run**, each a fresh collapse → re-select → measure cycle (mirroring the
  existing "dismiss then re-select" pattern already proven reliable in
  `packages/extension-chrome/e2e/selection.spec.ts:37-58`).
  `performance.clearMarks()`/`clearMeasures()` runs before each trial so
  `performance.getEntriesByName()` never returns a stale mark from a prior trial.
- **Each trial's duration is asserted individually against the 150ms ceiling — not just the
  mean.** All 5 raw durations are attached to the Playwright test report via `testInfo.attach()`
  (collected before any assertion runs, so a failing trial still leaves the full sample visible in
  the report) — visible for future budget-tightening without being a hard gate on its own.
- **Rejected: a single trial.** One sample cannot distinguish "genuinely regressed" from "this one
  interaction happened to coincide with a GC pause"; 5 trials with an individually-asserted 3×
  margin is materially more robust than either a single sample or an averaged one, at negligible
  extra runtime (each trial is a few milliseconds of interaction plus test-harness overhead).
- **Retries.** `playwright.config.ts:17` already sets `retries: process.env.CI ? 1 : 0` — inherited
  unchanged; this plan does not touch that file. Combined with the 3× per-trial margin, a
  genuinely-flaky one-off failure gets one automatic re-run before failing the build.

## 6. "Zero forced reflow": what it means and how it is measured (pinned)

**What "forced reflow" means here.** A forced synchronous reflow (a.k.a. layout thrashing) happens
when script writes a DOM/style property and then, in the same task, reads a layout-dependent
property (e.g. `offsetWidth`, `getBoundingClientRect()`) before the browser has had a chance to
batch the pending style/layout work — forcing an extra, unbatched layout pass. The card's fence is
that the trigger's show path introduces **none** of this on the host page.

**Rejected approach: sniffing Chromium's DevTools "[Violation] Forced reflow" console warning.**
This was the first design considered — Chromium is known to log a console violation for slow
handlers/forced layout — but it was **empirically disproven** for this project's exact harness
before being pinned: a throwaway Playwright script (bundled Chromium, `--headless=new`, `page.on
('console', ...)`) that intentionally forced 400 synchronous reflows (`style.width` write +
`offsetWidth` read, looped) produced **zero** console messages of any kind. Whatever gates that
violation-reporting channel in Chromium, it is not on by default in this project's headless launch
configuration — so this signal would have silently never failed the test, defeating the point of a
regression guard.

**Pinned approach: Chrome DevTools Protocol `Performance.getMetrics()`**, specifically the
`LayoutCount` and `RecalcStyleCount` counters, sampled immediately before and immediately after the
selection interaction via `context.newCDPSession(page)` (Playwright's documented raw-CDP escape
hatch; this is the first spec in this repo to use it — no other e2e file does today, confirmed by
`grep -rn "newCDPSession" packages/extension-chrome/e2e`). These counters are continuously
maintained by the renderer (querying them does not itself perform a layout — confirmed by the same
throwaway script: repeated `getMetrics()` calls with no intervening page work produced a **0**
delta every time), and they climb by exactly one **per layout/style-recalc pass**, forced or not —
so an unbatched, thrashing loop inflates them far faster than one legitimate layout per DOM change.
Empirically calibrated on this exact harness:

| Scenario                                                                           | `LayoutCount` delta                  |
| ---------------------------------------------------------------------------------- | ------------------------------------ |
| One benign style write, no read-back (synthetic)                                   | 1                                    |
| The **real** selection → trigger-show interaction (6 trials, real built extension) | 0 (5 trials), 1 (1 cold-start trial) |
| Synthetic 50-iteration write+read-back loop (deliberate forced reflow)             | 50                                   |

The real interaction's signal (0–1) and a genuine thrash (50 for a 50-iteration loop, i.e. exactly
1:1) sit far apart — a guard band well above the observed real-path ceiling and far below any
realistic thrash floor cleanly separates "normal" from "regressed" without being sensitive to
minor, benign browser-version-to-browser-version layout-count drift.

- **Guard (the real interaction): `LayoutCount` delta ≤ 2 and `RecalcStyleCount` delta ≤ 2 per
  trial** — one full trial (§5's cycle) above the observed real-world ceiling of 1, comfortably
  below a real thrash.
- **Calibration floor (self-check, §7): a synthetic 30-iteration forced-reflow loop on the same
  fixture page must produce a `LayoutCount` delta ≥ 20** — proves the detection mechanism itself
  still works on whatever Chromium build CI is running, every run, rather than trusting a
  potentially-silently-broken zero-violations pass (exactly the failure mode that sank the
  console-sniffing approach above).

## 7. Test placement (pinned)

One new e2e file: `packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts` (matches the
existing per-card dedicated-spec convention — `b7-repeat-nudge.spec.ts`,
`a16-evidence.spec.ts` — rather than appending to the general-purpose `selection.spec.ts`, since
these assertions are CI-timing/CDP-metric specific and benefit from being independently
skippable/quarantinable without touching the core selection-behavior regression suite).

- **Test 1 — calibration (self-check, runs first):** synthetic 30-iteration forced-reflow loop on
  the fixture page; asserts `LayoutCount` delta ≥ 20 (§6). No extension interaction — proves the
  CDP signal is alive on this Chromium build before the real-path test below is trusted.
- **Test 2 — the real assertion:** 5 trials (§5) of collapse → `selectWord` → measure. Each trial
  asserts (a) `ai-dict:selection-fired` → `ai-dict:trigger-shown` duration `< 150ms` (§4) and (b)
  `LayoutCount`/`RecalcStyleCount` delta `≤ 2` (§6). All 5 raw durations attached to the report.

No provider mock is needed (`mockGemini` etc.) — the trigger shows on selection alone, before any
click/lookup; the budget is entirely pre-click. This keeps the spec independent of network
mocking entirely.

## 8. The change

### 8.1 `packages/app/src/app/dom-selection-source.ts`

- Add `export const SELECTION_FIRED_MARK = 'ai-dict:selection-fired';` near the top of the file
  (after the `TERMINATORS` constant).
- In `onSelection`'s handler (`:42-45`), mark immediately before `cb(e)`:

```ts
const handler = (): void => {
  const e = this.read();
  if (e) {
    performance.mark(SELECTION_FIRED_MARK);
    cb(e);
  }
};
```

No other line in this file changes. `extractSentence`, `defaultReader`, and the constructor are
untouched.

### 8.2 `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`

- Add `export const TRIGGER_SHOWN_MARK = 'ai-dict:trigger-shown';` near the top of the file (after
  the `DISMISS_EVENTS` constant).
- In `show()`, immediately after the existing style writes (`:39-41`), add one line:

```ts
this.el.style.position = 'fixed';
this.el.style.left = `${anchor.x}px`;
this.el.style.top = `${anchor.y + anchor.h}px`;
requestAnimationFrame(() => performance.mark(TRIGGER_SHOWN_MARK));
```

Fires unconditionally on every `show()` call (both the "create" and "reuse existing element"
paths), matching the existing method's own unconditional style-write lines directly above it. No
other line in this file changes — `hide()`, `activate()`, the `theme` accessors, and the
outside-press dismissal are untouched.

### 8.3 `packages/app/src/index.ts` (barrel)

No new export line needed: `export * from './app/dom-selection-source';` already re-exports
everything from that module (confirmed present in the barrel today), so `SELECTION_FIRED_MARK`
automatically becomes reachable as `import { SELECTION_FIRED_MARK } from '@ai-dict/app'` the moment
§8.1 lands. Recorded here explicitly because it's the one thing an implementer might reflexively
add and shouldn't.

### 8.4 No change to `packages/app/src/domain/workflow.ts`, `packages/extension-chrome/src/content.ts`, `packages/app/src/ui/lookup-trigger.ts`, or any manifest file

The selection → show pipeline's control flow, the `<lookup-trigger>` element's own markup/CSS, and
the extension's permissions are all unchanged — this card is pure instrumentation plus a new e2e
spec.

## 9. Scope fence held

- **"Budget + test on the existing trigger; no behavior change."** §8.1/§8.2 add two
  `performance.mark()` calls (one wrapped in an already-harmless `requestAnimationFrame`); neither
  changes what the user sees, when the trigger is styled/positioned, or any control-flow branch.
  `performance.mark()` is a no-op side channel — it does not throw, does not block, and has no
  observable effect besides appending to the (already browser-managed) performance timeline.
- **No new manifest permission.** `performance` and `requestAnimationFrame` are standard `Window`
  APIs already available to the isolated-world content script; nothing here touches
  `manifest.json`.
- **No new wire message.** This card never crosses `chrome.runtime` — the marks are read directly
  off the page's `Performance` timeline by the e2e harness (§6's cross-world-visibility finding).
- **S1/S4/constraint 4 — not applicable.** No API key, no model output, no LLM call is anywhere
  near this card's surface.
- **Design tokens — not applicable.** No UI markup or CSS changes (the `<lookup-trigger>` element's
  own styling in `packages/app/src/ui/lookup-trigger.ts` is untouched, §8.4).

## 10. Testing strategy

1. **Unit — `packages/app/test/app/dom-selection-source.test.ts`**: extend the existing
   `describe('DomSelectionSource (event wiring)', ...)` block — a new test asserts
   `performance.mark` is called with `SELECTION_FIRED_MARK` exactly once when the injected reader
   yields a `SelectionEvent`, and not called at all when the reader yields `null` (mirroring the
   file's existing "null reader → no emit" assertion style at `:31-33`).
2. **Unit — `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`**: extend the
   existing `describe('ChromeFloatingTrigger ...', ...)` block — a new test calls `show()`, awaits
   one `requestAnimationFrame` tick, and asserts `performance.getEntriesByName(TRIGGER_SHOWN_MARK)`
   has a fresh entry; a second assertion confirms calling `show()` twice (the existing
   "reuses a single trigger element" scenario, `:34-41` today) produces the mark twice (once per
   call), not once.
3. **e2e — new `packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts`** (§7): the
   calibration self-check plus the 5-trial real-path assertion (latency + forced-reflow guard).
4. **Regression guard — `packages/extension-chrome/e2e/selection.spec.ts`** is unmodified but must
   stay green (run in the plan's final gate): it already exercises `selectWord`/re-select cycles
   through the exact code this card instruments, so any control-flow break would show there first.

## 11. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — suites run, test counts,
e2e scenarios exercised (calibration + 5-trial budget/reflow guard), and gates passed (lint, format
check, typecheck, unit, e2e), matching exactly what §10 enumerates. No `pr-assets/*` branch is
created for this card.

## 12. Risk / rollback

- **Risk: very low.** The only production-code change is two `performance.mark()` call sites, one
  wrapped in `requestAnimationFrame` — both are inert side effects with no return value consumed
  anywhere else in the codebase and no control-flow impact (confirmed by §3's live-build
  measurement: the instrumented build's actual selection → trigger behavior was indistinguishable
  from today's, only now timestamped). The e2e spec is entirely new and additive; it cannot
  regress any existing suite by construction (a new file, no shared fixtures/mocks are modified).
- **Flake risk:** mitigated by §4/§5's calibrated 3× margin, 5-trial per-sample assertion, and the
  existing CI retry (`playwright.config.ts:17`, unchanged). If the new spec proves flaky in
  practice despite this, the fix is tightening/loosening the pinned constants in a follow-up PR,
  not reverting the instrumentation.
- **No data migration, no storage shape change, no wire/router change.**
- **Rollback:** revert the single PR. `performance.mark`/`requestAnimationFrame` calls disappear;
  the trigger's actual show behavior (unaffected by this card to begin with) is untouched either
  way.

## 13. Files touched (summary)

| File                                                                     | Change                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/app/src/app/dom-selection-source.ts`                           | + `SELECTION_FIRED_MARK` export + one mark call in `onSelection`'s handler |
| `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`      | + `TRIGGER_SHOWN_MARK` export + one `rAF`-deferred mark call in `show()`   |
| `packages/app/test/app/dom-selection-source.test.ts`                     | + unit test (§10.1)                                                        |
| `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts` | + unit test (§10.2)                                                        |
| `packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts`       | new — calibration + budget/reflow e2e (§10.3)                              |

No change to `packages/app/src/domain/workflow.ts`, `packages/extension-chrome/src/content.ts`,
`packages/app/src/ui/lookup-trigger.ts`, `packages/app/src/index.ts` (barrel already covers the new
export, §8.3), `packages/extension-chrome/e2e/selection.spec.ts`, `docs/ROADMAP.md` (this spec §4/§6
_is_ the card's written budget — the roadmap card's own text already named the target numbers;
ROADMAP.md's per-card "✅ Shipped" status annotation, following the A4/A8/A16 precedent, is a
post-merge campaign bookkeeping step owned by the Shaman/Warchief verification flow, not this
implementation plan), or any manifest file.

## 14. Concurrency

Per `CONTRACTS.md` §5, this card's touched files intersect the declared
**content-script/trigger** hot-file group (`A5 A6 A13 A14 A15 B3 B4`):

- `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts` — also a likely surface for
  **A6** (smart card placement — may read/adjust anchor/positioning logic near the trigger) and
  **A14** (double-click trigger — likely changes how/when `show()`/`hide()` are invoked).
  Orchestrator: serialize A15 against A6 and A14 on this file specifically; A15's own diff here is
  additive (one new export + one new line at the end of `show()`), so a rebase after either lands
  should be mechanical, but do not run both card's Hunters against this file concurrently.
- `packages/app/src/app/dom-selection-source.ts` — the selection-detection module; **A14**
  (double-click trigger) is the other card most likely to touch this file (it changes what counts
  as "a selection worth showing the trigger for"). Serialize similarly.
- `packages/extension-chrome/e2e/selection.spec.ts` — not modified by this card, but read as the
  regression baseline (§10.4); any card that changes selection/trigger behavior should keep it
  green, which this card's own final gate also re-confirms.
- No overlap with the lookup-card UI, settings-form, side panel, prompt-builder, `docs/index.html`,
  or wire+router hot-file groups — this card touches neither.
