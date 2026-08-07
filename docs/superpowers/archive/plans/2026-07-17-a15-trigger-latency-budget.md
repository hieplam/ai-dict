# A15 Trigger Latency Budget Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** the selection → trigger-show pipeline gets two cheap, permanent `performance.mark()`
instrumentation points, a new e2e spec asserting (a) the pipeline stays under a CI-calibrated
latency ceiling across 5 selection cycles and (b) it causes no forced-reflow layout thrashing, plus
a self-check calibration test proving the forced-reflow detection mechanism itself works on
whatever Chromium build CI runs. No production behavior changes — the trigger shows exactly when
and where it does today.

**Architecture:** two files gain one export + one mark call each —
`packages/app/src/app/dom-selection-source.ts` (`c3-1`, portable core) marks the moment a real
selection is detected, and `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`
(`c3-2`, Chrome adapter) marks the moment the trigger's styles are written, deferred one animation
frame so the mark approximates "about to paint" rather than "JS finished running." A third,
zero-dependency file, `packages/extension-chrome/src/adapters/trigger-marks.ts`, holds the second
mark's string constant on its own — `chrome-floating-trigger.ts` calls
`registerContentElements()` (a browser-only `customElements.define` call) at module load, which
crashes if imported from Node, so the e2e spec (which runs in the Playwright **Node** test
process, not a browser) cannot import the mark name from that file directly. Full design
rationale, including the two rejected approaches for the latency-margin and forced-reflow
questions and every empirical measurement backing the pinned numbers:
`docs/superpowers/specs/2026-07-17-a15-trigger-latency-budget-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright + raw CDP (`Performance` domain)
(e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **No behavior change.** The trigger's actual show/hide timing, styling, and positioning
  (`chrome-floating-trigger.ts`'s existing `show()` body) are untouched line-for-line except for
  one new line appended at the very end. `performance.mark()` is a side-effect-only diagnostic
  call — it never throws, blocks, or is read by any production code path.
- **No new manifest permission, no wire message, no UI/markup change.** This card's entire surface
  is instrumentation + a new e2e spec.
- **Marks are cheap and permanent** — not removed after this card ships, not gated behind a debug
  flag. `SELECTION_FIRED_MARK` fires only on a real (non-null) selection, never on every incidental
  page click, so the performance timeline is never meaningfully polluted.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` and
  `cd packages/extension-chrome && bun run typecheck` green.
- The e2e build must clear any ambient `GEMINI_API_KEY`
  (`GEMINI_API_KEY= bun run build:chrome:e2e`) before every e2e run in this plan.
- Commit subject convention for every task in this plan:
  `[A15TriggerLatencyBudget] feat: <task summary> (A15)`.
- Branch: `feature/A15TriggerLatencyBudget`, started fresh under `.claude/worktrees/`.

---

### Task 1: `dom-selection-source.ts` — `SELECTION_FIRED_MARK`

**Files:**

- Modify: `packages/app/src/app/dom-selection-source.ts`
- Modify: `packages/app/test/app/dom-selection-source.test.ts`

**Interfaces:**

```ts
export const SELECTION_FIRED_MARK = 'ai-dict:selection-fired';
```

- [ ] **Step 1: Write the failing test.** In `packages/app/test/app/dom-selection-source.test.ts`,
      change the import at the top of the file:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  extractSentence,
  DomSelectionSource,
  SELECTION_FIRED_MARK,
} from '../../src/app/dom-selection-source';
import type { SelectionEvent } from '../../src';
```

Then, inside the existing `describe('DomSelectionSource (event wiring)', ...)` block, add a new
test right after the existing `'also fires on touchend events'` test (before the block's closing
`});`):

```ts
it('marks SELECTION_FIRED_MARK exactly once per real selection, and not on a null read (A15)', () => {
  performance.clearMarks(SELECTION_FIRED_MARK);
  const read = vi.fn<() => SelectionEvent | null>(() => ev);
  const src = new DomSelectionSource(document, read);
  const cb = vi.fn();
  const teardown = src.onSelection(cb);
  document.dispatchEvent(new Event('mouseup'));
  expect(performance.getEntriesByName(SELECTION_FIRED_MARK)).toHaveLength(1);
  read.mockReturnValueOnce(null);
  document.dispatchEvent(new Event('mouseup'));
  expect(performance.getEntriesByName(SELECTION_FIRED_MARK)).toHaveLength(1); // null reader → no new mark
  teardown();
});
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: failure — `SELECTION_FIRED_MARK` is not exported from `../../src/app/dom-selection-source`
(a `TypeError`/module-resolution failure, since the new test file import itself cannot resolve).

- [ ] **Step 2: Implement.** In `packages/app/src/app/dom-selection-source.ts`, add the exported
      constant right after the existing `TERMINATORS` constant, and mark inside `onSelection`'s
      handler immediately before `cb(e)`:

> **Before applying, re-read the current file.** If A14/A6 (or any sibling) already landed here,
> insert only the marked new lines around their code rather than pasting this block verbatim; if
> the file no longer matches the block's assumptions, STOP and re-ground.

```ts
import type { SelectionSource, SelectionEvent, AnchorRect } from '../index';

const TERMINATORS = ['.', '!', '?'];

// A15: cheap, permanent instrumentation mark — the earliest synchronous JS observation of "the
// browser told us the selection gesture ended." See docs/superpowers/specs/
// 2026-07-17-a15-trigger-latency-budget-design.md §3.
export const SELECTION_FIRED_MARK = 'ai-dict:selection-fired';

export function extractSentence(full: string, selStart: number, selEnd: number): string {
  const before = full.slice(0, selStart);
  const start = Math.max(...TERMINATORS.map((t) => before.lastIndexOf(t))) + 1;
  const after = full.slice(selEnd);
  const ends = TERMINATORS.map((t) => after.indexOf(t)).filter((i) => i >= 0);
  const end = ends.length ? selEnd + Math.min(...ends) + 1 : full.length;
  return full.slice(start, end).trim();
}

// Default DOM reader: window selection → SelectionEvent. Thin + covered by e2e; unit tests inject a fake.
function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
  };
}

type DocEvents = Pick<Document, 'addEventListener' | 'removeEventListener'>;

export class DomSelectionSource implements SelectionSource {
  constructor(
    private readonly doc: DocEvents,
    private readonly read: () => SelectionEvent | null = defaultReader,
  ) {}

  onSelection(cb: (e: SelectionEvent) => void): () => void {
    const handler = (): void => {
      const e = this.read();
      if (e) {
        performance.mark(SELECTION_FIRED_MARK);
        cb(e);
      }
    };
    for (const t of ['mouseup', 'touchend'] as const) this.doc.addEventListener(t, handler);
    return () => {
      for (const t of ['mouseup', 'touchend'] as const) this.doc.removeEventListener(t, handler);
    };
  }
}
```

Run: `cd packages/app && bunx vitest run test/app/dom-selection-source.test.ts`
Expected: all tests pass (existing 7 + the new one = 8 in this file's combined describes).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/dom-selection-source.ts packages/app/test/app/dom-selection-source.test.ts
git commit -m "[A15TriggerLatencyBudget] feat: mark SELECTION_FIRED_MARK on real selections (A15)"
```

---

### Task 2: `trigger-marks.ts` + `chrome-floating-trigger.ts` — `TRIGGER_SHOWN_MARK`

**Files:**

- Create: `packages/extension-chrome/src/adapters/trigger-marks.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`

**Interfaces:**

```ts
export const TRIGGER_SHOWN_MARK = 'ai-dict:trigger-shown';
```

`chrome-floating-trigger.ts` re-exports the same name, so existing/future importers of that module
don't need to know the constant physically lives in a sibling file.

- [ ] **Step 1: Create the zero-dependency marks module.** Create
      `packages/extension-chrome/src/adapters/trigger-marks.ts`:

```ts
// A15: split into its own zero-dependency module so e2e specs (which run in Node, not a browser)
// can import the mark name without pulling in chrome-floating-trigger.ts's top-level
// registerContentElements() call (browser-only — defines custom elements via `customElements`).
export const TRIGGER_SHOWN_MARK = 'ai-dict:trigger-shown';
```

- [ ] **Step 2: Write the failing test.** In
      `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`, update the top of
      the file:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ChromeFloatingTrigger, TRIGGER_SHOWN_MARK } from './chrome-floating-trigger';
import { registerContentElements } from '@ai-dict/app';
registerContentElements();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
```

Then add a new test at the end of the `describe('ChromeFloatingTrigger (TriggerUI via
<lookup-trigger>)', ...)` block, right after the existing `'activate() is a safe no-op when
nothing is shown'` test (before the block's closing `});`):

```ts
it('marks TRIGGER_SHOWN_MARK on the next animation frame after show(), once per call (A15)', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const trigger = new ChromeFloatingTrigger(host);

  // Earlier tests in this file also call show(), each scheduling its own rAF-deferred mark on
  // the one shared, module-global performance/rAF timeline happy-dom exposes; none of those
  // tests ever await a frame, so their marks stay pending until something does. Draining once
  // here — before taking the baseline count — flushes that cross-test debt so the two
  // assertions below can check an exact delta instead of a flaky absolute count.
  await nextFrame();
  const before = performance.getEntriesByName(TRIGGER_SHOWN_MARK).length;

  trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
  await nextFrame();
  expect(performance.getEntriesByName(TRIGGER_SHOWN_MARK)).toHaveLength(before + 1);

  trigger.show({ x: 9, y: 9, w: 1, h: 1 }, vi.fn()); // reuse path — still marks again
  await nextFrame();
  expect(performance.getEntriesByName(TRIGGER_SHOWN_MARK)).toHaveLength(before + 2);
});
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: failure — `TRIGGER_SHOWN_MARK` is not exported from `./chrome-floating-trigger`.

> **Why the leading `await nextFrame()` before the baseline snapshot is required, not optional:**
> confirmed empirically while authoring this plan — omitting it and asserting an absolute count
> (e.g. `toHaveLength(1)`) fails with `expected length 1, got 11`, because every earlier test in
> this file that calls `show()` schedules its own pending `requestAnimationFrame` callback on the
> same shared timeline, and none of those tests ever await a frame themselves. The very first
> `await nextFrame()` anywhere in the file is what flushes all of that queued debt at once. Draining
> it before taking the baseline, then asserting an exact **delta** for this test's own two `show()`
> calls, is the fix — do not "simplify" this back to an absolute-count assertion.

- [ ] **Step 3: Implement.** In `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`,
      add the import/re-export at the top and the mark call at the end of `show()`:

> **Before applying, re-read the current file.** If A14/A6 (or any sibling) already landed here,
> insert only the marked new lines around their code rather than pasting this block verbatim; if
> the file no longer matches the block's assumptions, STOP and re-ground.

```ts
import { registerContentElements, type TriggerUI, type AnchorRect, type Theme } from '@ai-dict/app';
import { TRIGGER_SHOWN_MARK } from './trigger-marks';
export { TRIGGER_SHOWN_MARK } from './trigger-marks';
registerContentElements();

const DISMISS_EVENTS = ['mousedown', 'touchstart'] as const;

export class ChromeFloatingTrigger implements TriggerUI {
  private el: HTMLElement | null = null;
  private _theme: Theme = 'sepia';
  private onClick: (() => void) | null = null;
  private readonly handler = (): void => this.onClick?.();
  // Dismiss the bubble when the user starts an interaction anywhere but on it.
  // composedPath() pierces the shadow DOM, so a press on the "Define" button
  // counts as "inside" and lets the click through to fire the lookup.
  private readonly onOutsidePress = (e: Event): void => {
    if (this.el && !e.composedPath().includes(this.el)) this.hide();
  };

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Stored theme preference, stamped as an attribute on the bubble (set by content.ts). */
  set theme(t: Theme) {
    this._theme = t;
    this.el?.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.setAttribute('data-ad-theme', this._theme);
      this.el.addEventListener('lookup-click', this.handler);
      this.host.append(this.el);
      // Capture phase so pages that stopPropagation can't trap the dismissal.
      for (const t of DISMISS_EVENTS) document.addEventListener(t, this.onOutsidePress, true);
    }
    this.el.style.position = 'fixed';
    this.el.style.left = `${anchor.x}px`;
    this.el.style.top = `${anchor.y + anchor.h}px`;
    requestAnimationFrame(() => performance.mark(TRIGGER_SHOWN_MARK));
  }

  /**
   * Keyboard-shortcut path (A4 define-selection): fire the same click the mouse would, on
   * whatever trigger bubble is currently showing. Returns false (no-op) if nothing is
   * selected/shown — matches "define what I just selected": nothing selected, nothing to do.
   */
  activate(): boolean {
    const btn = this.el?.shadowRoot?.querySelector('button');
    if (btn instanceof HTMLButtonElement && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  hide(): void {
    this.el?.removeEventListener('lookup-click', this.handler);
    this.el?.remove();
    this.el = null;
    this.onClick = null;
    for (const t of DISMISS_EVENTS) document.removeEventListener(t, this.onOutsidePress, true);
  }
}
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: all tests pass (existing 8 + the new one = 9).

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/adapters/trigger-marks.ts packages/extension-chrome/src/adapters/chrome-floating-trigger.ts packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts
git commit -m "[A15TriggerLatencyBudget] feat: mark TRIGGER_SHOWN_MARK one rAF tick after show() (A15)"
```

---

### Task 3: e2e — calibration + 5-trial latency/forced-reflow budget spec

**Files:**

- Create: `packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts`

This task has no separate "red" step in the usual unit-TDD sense — e2e specs are proven by running
them against the real built extension, which requires the marks from Tasks 1–2 to already exist
(this task is a pure addition; there's nothing to fail against beforehand). Write the file, build,
and run it directly; if either mark is missing this fails immediately with a `waitForFunction`
timeout, which is an adequate "red" signal on its own.

- [ ] **Step 1: Create the spec.** Create
      `packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord } from './helpers';
// Deep-imported (not from '@ai-dict/app' / '../src/adapters/chrome-floating-trigger') on purpose:
// both of those entry points run registerContentElements() at module load, which calls
// `customElements.define` — a browser-only API. This e2e file runs in Node (the Playwright test
// process), so importing either barrel would crash at import time with "HTMLElement is not
// defined." dom-selection-source.ts and trigger-marks.ts have zero such side effects (verified: a
// dry run of this exact spec against the built extension is what caught the crash and produced
// this fix — see the design spec §3).
import { SELECTION_FIRED_MARK } from '../../app/src/app/dom-selection-source';
import { TRIGGER_SHOWN_MARK } from '../src/adapters/trigger-marks';
import type { CDPSession } from '@playwright/test';

// A15: the CI ceiling deliberately sits above the 50ms product budget (design spec §4) to absorb
// headless-CI timing noise without masking a real regression.
const CI_LATENCY_CEILING_MS = 150;
const TRIALS = 5;
// A15 design spec §6: guard band for the real interaction — well below a genuine forced-reflow
// thrash (30+ per the calibration test below) and just above the observed real-path ceiling (1).
const LAYOUT_GUARD = 2;

interface CdpMetrics {
  LayoutCount: number;
  RecalcStyleCount: number;
}

async function metrics(session: CDPSession): Promise<CdpMetrics> {
  const { metrics: raw } = (await session.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const map = Object.fromEntries(raw.map((m) => [m.name, m.value]));
  return { LayoutCount: map.LayoutCount ?? 0, RecalcStyleCount: map.RecalcStyleCount ?? 0 };
}

test.describe('A15 trigger latency budget', () => {
  test('calibration: the LayoutCount signal detects a synthetic forced-reflow loop on this Chromium build', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(500);

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    const before = await metrics(session);
    await page.evaluate(() => {
      const p = document.getElementById('t') as HTMLElement;
      for (let i = 0; i < 30; i++) {
        p.style.marginLeft = `${i}px`;
        void p.offsetWidth; // deliberately forces a synchronous layout every iteration
      }
    });
    const after = await metrics(session);
    expect(after.LayoutCount - before.LayoutCount).toBeGreaterThanOrEqual(20);
  });

  test('trigger latency stays under the CI budget and shows zero forced reflow, across 5 selection cycles', async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(500);

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');

    const samples: { durationMs: number; layoutDelta: number; recalcDelta: number }[] = [];

    for (let i = 0; i < TRIALS; i++) {
      // Collapse before re-selecting, mirroring selection.spec.ts's proven "dismiss then
      // re-select" pattern (packages/extension-chrome/e2e/selection.spec.ts:37-58).
      await page.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.evaluate(
        ({ sel, shown }) => {
          performance.clearMarks(sel);
          performance.clearMarks(shown);
          performance.clearMeasures();
        },
        { sel: SELECTION_FIRED_MARK, shown: TRIGGER_SHOWN_MARK },
      );

      const before = await metrics(session);
      await selectWord(page, 't', 'bank');
      await page.waitForFunction(
        (name) => performance.getEntriesByName(name).length > 0,
        TRIGGER_SHOWN_MARK,
        { timeout: 3_000 },
      );
      const after = await metrics(session);

      const durationMs = await page.evaluate(
        ({ sel, shown }) => {
          performance.measure('ai-dict:trigger-latency', sel, shown);
          return performance.getEntriesByName('ai-dict:trigger-latency').at(-1)!.duration;
        },
        { sel: SELECTION_FIRED_MARK, shown: TRIGGER_SHOWN_MARK },
      );

      samples.push({
        durationMs,
        layoutDelta: after.LayoutCount - before.LayoutCount,
        recalcDelta: after.RecalcStyleCount - before.RecalcStyleCount,
      });
    }

    await testInfo.attach('a15-samples.json', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });

    for (const [i, s] of samples.entries()) {
      expect(s.durationMs, `trial ${i} latency`).toBeLessThan(CI_LATENCY_CEILING_MS);
      expect(s.layoutDelta, `trial ${i} LayoutCount delta`).toBeLessThanOrEqual(LAYOUT_GUARD);
      expect(s.recalcDelta, `trial ${i} RecalcStyleCount delta`).toBeLessThanOrEqual(LAYOUT_GUARD);
    }
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test a15-trigger-latency-budget
```

Expected: `2 passed` — the calibration test (LayoutCount delta ≥ 20 for the synthetic loop) and the
5-trial real-path test (every trial's latency < 150ms and layout/recalc deltas ≤ 2). This exact
command was run against this exact file during plan authoring and passed in ~2.1–2.3s per test; if
it fails here, do not loosen the constants without first re-reading the design spec §4/§6 — a
failure means either a real regression or an environment difference from the one the numbers were
calibrated against, not that the test is wrong.

- [ ] **Step 2: Regression check.** Confirm the pre-existing selection suite is unaffected:

```
cd packages/extension-chrome && bunx playwright test selection
```

Expected: all 3 tests in `selection.spec.ts` still pass.

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome:e2e
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/a15-trigger-latency-budget.spec.ts
git commit -m "[A15TriggerLatencyBudget] feat: e2e latency budget + forced-reflow guard for the trigger (A15)"
```

---

## Final gate (run once, after Task 3, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../safari && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test a15-trigger-latency-budget selection
```

Expected: typecheck clean on all three packages; the full Vitest suite green (692 tests — 690
existing + the 2 added in Tasks 1–2); lint/format clean; the e2e build succeeds with the env key
cleared; both the new spec (2 tests) and `selection.spec.ts` (3 tests, regression guard) pass — 5
total in this final invocation.

## PR

Regular merge (no squash). Title: `[A15TriggerLatencyBudget] Trigger latency budget`. Include a
**"Testing performed"** section per this worktree's evidence policy (design spec §11) instead of
screenshots/video:

- Unit: `bun run test` — 692 passed (690 existing + 2 new: `SELECTION_FIRED_MARK` emission,
  `TRIGGER_SHOWN_MARK` emission).
- e2e: `a15-trigger-latency-budget.spec.ts` — 2 passed (calibration self-check; 5-trial
  latency/forced-reflow budget, all samples attached to the report). `selection.spec.ts` — 3
  passed (regression guard).
- Gates: `bun run lint`, `bun run format:check`, `bun run typecheck` (all 3 packages),
  `GEMINI_API_KEY= bun run build:chrome:e2e` — all green.

## JIRA ticket

- n/a — this repo is not Jira-tracked (see PR #117's own precedent).
