# A6 Smart Card Placement Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the lookup card (`<bottom-sheet>`/`<lookup-card>`) positions itself as an overlay near
the reader's selection instead of always sitting bottom-anchored and full-width — preferring
directly below the selection, flipping above when the viewport clips it, clamping on both axes so
it never renders off-screen, and never covering the selected sentence's own rect. The card stays
an overlay and never shifts host-page layout. Full design rationale, every rejected alternative,
and the exact rect-math derivation:
`docs/superpowers/specs/2026-07-17-a6-smart-card-placement-design.md` (spec self-reviewed and
corrected in place — three stale citations and one under-justified e2e assertion were fixed before
this plan was written; see that file's §2.5–§2.6, §5.6).

**Architecture:** a new pure function, `computeCardPlacement` (`packages/app/src/domain/
card-placement.ts`, zero imports outward — `rule-domain-purity`), takes the selection's already-
captured `AnchorRect`, the card's own measured box, and the viewport box, and returns `{top, left}`
pixel coordinates. The selection's anchor already exists on `SelectionEvent.anchor`
(`domain/types.ts:1-11`) and is already captured by `dom-selection-source.ts`'s `defaultReader()`
— this card only threads that existing value one hop further (into `ResultRenderer.renderLoading`)
and adds the DOM-measuring caller (`BottomSheet.positionNear`, `packages/app/src/ui/
bottom-sheet.ts`) that calls the pure function and writes the result as inline styles. No new
wire message, no change to `wire.ts`/`router.ts`, no change to what the card renders
(`lookup-card.ts`), how results are fetched, sanitized, cached, or saved.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e, real Chromium).

## Global Constraints

- **Before starting:** `cd /Users/todd.lam/WORK/_TestScripts/ai-dict/.claude/worktrees/
a6-smart-card-placement && bun install` — a fresh worktree has no `@ai-dict/app` workspace
  symlink yet; skipping this makes `bun run test` fail with ~22 "Failed to resolve import
  @ai-dict/app" suite errors that have nothing to do with this card.
- Start in a fresh git worktree at `.claude/worktrees/a6-smart-card-placement` on branch
  `feature/A6SmartCardPlacement`.
- Implementer: dispatch each task below to the `hunter` subagent — never a generic implementer.
- Commit subject convention for every task in this plan:
  `[A6SmartCardPlacement] feat: <imperative summary> (A6)` (matches repo history, e.g.
  `[C10FunnelE2e] feat: deterministic funnel e2e — add build:chrome:e2e env-clearing script
(C10)`). No Co-Authored-By trailer, no attribution footer.
- **Do not touch `packages/app/src/wire.ts` or `packages/app/src/app/router.ts`.** This card adds
  no wire message — every change is either the new pure module, threading an already-captured
  value one hop further through an existing optional parameter, or CSS/positioning code. If a task
  in this plan seems to need a wire/router change, stop; the plan needs re-grounding, not an ad hoc
  schema edit.
- **Do not touch `packages/app/src/ui/lookup-card.ts`, `packages/app/src/app/
markdown-sanitize.ts`, `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`,
  `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`, or
  `packages/extension-safari/src/content.ts`.** Per the design spec §2.7/§3.8–§3.11: the Define
  trigger bubble is out of scope (a pre-existing, accepted gap, not this card's target); the Safari
  shell inherits this fix with zero source changes because it passes the shared
  `InlineBottomSheetRenderer` directly as `deps.renderer`; the side-panel mirror keeps its existing
  one-parameter `renderLoading` signature (TypeScript permits an implementer to declare fewer
  parameters than the interface it implements).
- `bun run lint` + `bun run format:check` green before every commit; per-package
  `bun run typecheck` green after every task that touches that package (`packages/app` for Tasks
  1–4, `packages/extension-chrome` for Tasks 5–6).
- No wire message is added by this card, so the CONTRACTS §2 "wire.ts arm + router.ts case = one
  task" rule does not apply here.
- E2e builds clear the ambient key: `GEMINI_API_KEY= bun run build:chrome` (or
  `build:chrome:e2e`); never rely on shell state.
- E2e must never fetch the live landing page — Task 6 uses only the existing `gotoFixture` local
  fixture, same as every other spec in this suite.
- UI reads only `--ad-*`/`--adp-*` design tokens; no hard-coded colors. `.panel`'s new `width`
  expression reads the existing `--adp-card-width` token (no new token). `CARD_PLACEMENT_MARGIN`
  is a plain JS number (not a CSS property) — domain purity forbids `getComputedStyle`/CSS access
  from `domain/`, so this is a documented, known coupling to `--adp-space-8`'s value (design spec
  §2.5); if the design system's spacing scale ever changes `--adp-space-8`, this constant needs a
  matching manual update, but that is out of scope for this card.
- S1 (`rule-api-key-isolation`): not touched — no code in this card reads, stores, or transmits
  the API key. S4 (`rule-sanitize-model-output`): not touched — `sanitizeMarkdown` and its one call
  site are untouched; positioning happens after content is already sanitized and written to the
  DOM. Constraint 4 (no background LLM calls): not touched — no lookup is triggered by this card.
- **Concurrency (design spec §7):** this card touches `packages/extension-chrome/src/content.ts`
  (CONTRACTS §5's content-script/trigger hot-file bucket — A5, A6, A13, A14, A15, B3, B4 all touch
  this file) plus `packages/app/src/domain/workflow.ts`, `packages/app/src/ports.ts`,
  `packages/app/src/app/inline-bottom-sheet-renderer.ts`, and `packages/app/src/ui/
bottom-sheet.ts` — none of the last four are in a CONTRACTS-pre-listed bucket, but A1 (streamed
  answers) is flagged in the spec as the card most likely to also touch `runLookupWorkflow`'s
  render-call sequence and the shared sheet/renderer; the orchestrator should serialize A1 and A6
  on these files even though A1 is nominally grouped under the "lookup-card UI" bucket instead.
- `.c3/` is CLI-only. This card adds one new file (`card-placement.ts`) inside the existing
  `c3-110 lookup-workflow` domain component and touches UI surface already governed by `c3-117
ui-components`/`ref-web-components-shadow-dom` — it does not introduce a new component or
  container. The final task below runs `c3 sweep` (or `c3 audit` if `sweep` is unavailable) to
  confirm the new file is captured under its existing component rather than hand-editing `.c3/`;
  if the CLI reports a mismatch, stop and report rather than editing `.c3/` directly.

---

### Task 1: Domain — pure `computeCardPlacement` rect-math module

**Files:**

- Create: `packages/app/src/domain/card-placement.ts`
- Create: `packages/app/test/card-placement.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export interface PlacementBox {
  width: number;
  height: number;
}
export interface CardPlacement {
  top: number;
  left: number;
}
export const CARD_PLACEMENT_MARGIN: number; // = 8
export function computeCardPlacement(
  anchor: AnchorRect | null,
  card: PlacementBox,
  viewport: PlacementBox,
  margin?: number,
): CardPlacement;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/card-placement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCardPlacement, CARD_PLACEMENT_MARGIN } from '../src/domain/card-placement';
import type { AnchorRect } from '../src/domain/types';

const VIEWPORT = { width: 800, height: 600 };
const CARD = { width: 400, height: 200 };

describe('computeCardPlacement', () => {
  it('prefers directly below the selection when there is room', () => {
    const anchor: AnchorRect = { x: 100, y: 100, w: 50, h: 20 };
    expect(computeCardPlacement(anchor, CARD, VIEWPORT)).toEqual({
      top: 100 + 20 + CARD_PLACEMENT_MARGIN, // anchor.y + anchor.h + margin = 128
      left: 100,
    });
  });

  it('flips above the selection when there is not enough room below (viewport-clipped)', () => {
    const anchor: AnchorRect = { x: 100, y: 500, w: 50, h: 20 };
    // below: top = 500+20+8=528; 528+200=728 > 600-8=592 -> does not fit
    // above: top = 500-8-200=292; 292 >= 8 -> fits
    expect(computeCardPlacement(anchor, CARD, VIEWPORT)).toEqual({ top: 292, left: 100 });
  });

  it('clamps to the top of the viewport when the card fits neither above nor below', () => {
    const shortViewport = { width: 800, height: 150 }; // shorter than the card
    const anchor: AnchorRect = { x: 100, y: 50, w: 50, h: 20 };
    // below: top=50+20+8=78; 78+200=278 > 150-8=142 -> does not fit
    // above: top=50-8-200=-158; -158 < 8 -> does not fit
    // clamp(78, 8, 150-200-8=-58): max(-58) < min(8) -> resolves to margin (8)
    expect(computeCardPlacement(anchor, CARD, shortViewport)).toEqual({ top: 8, left: 100 });
  });

  it('clamps left up to the margin when the anchor is near/past the left edge', () => {
    const anchor: AnchorRect = { x: -50, y: 100, w: 50, h: 20 };
    expect(computeCardPlacement(anchor, CARD, VIEWPORT).left).toBe(CARD_PLACEMENT_MARGIN);
  });

  it("clamps left down so the card's right edge never passes the viewport's right edge", () => {
    const anchor: AnchorRect = { x: 700, y: 100, w: 50, h: 20 };
    // maxLeft = 800-400-8=392
    expect(computeCardPlacement(anchor, CARD, VIEWPORT).left).toBe(392);
  });

  it('falls back to the bottom-center default when anchor is null', () => {
    // top = clamp(600-200-8=392, 8, 392) = 392; left = clamp((800-400)/2=200, 8, 392) = 200
    expect(computeCardPlacement(null, CARD, VIEWPORT)).toEqual({ top: 392, left: 200 });
  });

  it('keeps the card on-screen (pinned to margin) even when the card is wider than the viewport', () => {
    const wideCard = { width: 900, height: 200 }; // wider than the 800px viewport
    const anchor: AnchorRect = { x: 300, y: 100, w: 50, h: 20 };
    // maxLeft = 800-900-8=-108; clamp(300, 8, -108): max(-108) < min(8) -> resolves to margin (8)
    expect(computeCardPlacement(anchor, wideCard, VIEWPORT).left).toBe(8);
  });

  it('honors a custom margin override', () => {
    const anchor: AnchorRect = { x: 100, y: 100, w: 50, h: 20 };
    // top = anchor.y + anchor.h + margin = 100+20+20=140
    expect(computeCardPlacement(anchor, CARD, VIEWPORT, 20)).toEqual({ top: 140, left: 100 });
  });
});
```

Run: `cd packages/app && bunx vitest run test/card-placement.test.ts`
Expected: failure — `Cannot find module '../src/domain/card-placement'` (the module does not
exist yet).

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/card-placement.ts`:

```ts
import type { AnchorRect } from './types';

/** A plain width/height box — used for both the card's own rendered size and the viewport. */
export interface PlacementBox {
  width: number;
  height: number;
}

export interface CardPlacement {
  top: number;
  left: number;
}

// Mirrors --adp-space-8 (packages/app/src/ui/styles/tokens.ts:49) — a plain number, not a live
// read of the CSS custom property, because domain/ has no DOM access (rule-domain-purity). If
// the design system's spacing scale changes --adp-space-8, update this constant to match.
export const CARD_PLACEMENT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

/**
 * A6: pure rect math that places the lookup card as an overlay that never covers the selected
 * sentence. Prefers directly below the selection (mirrors the Define trigger's own placement,
 * chrome-floating-trigger.ts:39-41); flips above when there is not enough room below
 * (viewport-clipped); clamps both axes so the card never renders off-screen. `anchor === null`
 * (no selection known yet — see the design spec §2.4) falls back to the pre-A6 default:
 * bottom-center. No DOM access — pure numbers in, numbers out (rule-domain-purity).
 */
export function computeCardPlacement(
  anchor: AnchorRect | null,
  card: PlacementBox,
  viewport: PlacementBox,
  margin: number = CARD_PLACEMENT_MARGIN,
): CardPlacement {
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;

  if (anchor === null) {
    return {
      top: clamp(viewport.height - card.height - margin, margin, maxTop),
      left: clamp((viewport.width - card.width) / 2, margin, maxLeft),
    };
  }

  const belowTop = anchor.y + anchor.h + margin;
  const fitsBelow = belowTop + card.height <= viewport.height - margin;
  const aboveTop = anchor.y - margin - card.height;
  const fitsAbove = aboveTop >= margin;

  const top = fitsBelow ? belowTop : fitsAbove ? aboveTop : clamp(belowTop, margin, maxTop);
  const left = clamp(anchor.x, margin, maxLeft);

  return { top, left };
}
```

In `packages/app/src/index.ts`, add one line right after the existing
`export * from './domain/nudge-policy';` (line 10), before `export * from './domain/
error-mapper';` (line 11):

```ts
export * from './domain/card-placement';
```

Run: `cd packages/app && bunx vitest run test/card-placement.test.ts`
Expected: 8 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/card-placement.ts packages/app/test/card-placement.test.ts packages/app/src/index.ts
git commit -m "[A6SmartCardPlacement] feat: add pure card-placement rect-math module (A6)"
```

---

### Task 2: Thread the selection anchor through `ResultRenderer.renderLoading`

**Files:**

- Modify: `packages/app/src/ports.ts`
- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/fakes/index.ts`
- Modify: `packages/app/test/workflow.test.ts`

**Interfaces:**

```ts
// ResultRenderer (widened):
renderLoading(word?: string, anchor?: AnchorRect): void;
```

- [ ] **Step 1: Write the failing test.** First, extend `FakeResultRenderer` in
      `packages/app/test/fakes/index.ts` so it records the anchor it's called with. Add
      `AnchorRect` to the existing import list at the top of the file:

```ts
import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
  Storage,
  SelectionEvent,
  LookupResult,
  LookupError,
  LookupRequest,
  PublicSettings,
  AnchorRect,
} from '../../src';
```

Then replace the `FakeResultRenderer` class body:

```ts
export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastCtx: ResultRenderContext | undefined;
  lastError: LookupError | null = null;
  loadingWord: string | undefined;
  // A6: the anchor renderLoading was called with, so tests can assert workflow.ts forwards it.
  loadingAnchor: AnchorRect | undefined;
  renderLoading(word?: string, anchor?: AnchorRect) {
    this.calls.push('loading');
    this.loadingWord = word;
    this.loadingAnchor = anchor;
  }
  renderResult(r: LookupResult, ctx?: ResultRenderContext) {
    this.calls.push('result');
    this.lastResult = r;
    this.lastCtx = ctx;
  }
  renderError(e: LookupError) {
    this.calls.push('error');
    this.lastError = e;
  }
  close() {
    this.calls.push('close');
  }
}
```

Now, in `packages/app/test/workflow.test.ts`, add one assertion to the existing happy-path test
(the `it('happy path: ...')` block). Insert this line right after the existing
`expect(h.renderer.loadingWord).toBe('bank');` line, before the `expect(h.client.lastReq)...`
block:

```ts
// A6: the selection's anchor rect is threaded into renderLoading too, so the card can
// position itself near the selection from its very first paint.
expect(h.renderer.loadingAnchor).toEqual(sel.anchor);
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: 1 failure (the happy-path test) — `expected undefined to deeply equal { x: 0, y: 0, w:
1, h: 1 }`. The other 17 tests in this file still pass.

- [ ] **Step 2: Implement.** In `packages/app/src/ports.ts`, replace the `ResultRenderer`
      interface:

```ts
export interface ResultRenderer {
  /**
   * Show the loading state. `word` is the reader's selected text, known the
   * instant they click Define — render it immediately as the headword so the
   * card never appears empty while waiting for the model's reply.
   * `anchor` (A6): the selection's viewport rect, when known. Implementations that render as a
   * page overlay (InlineBottomSheetRenderer) use it to place the card near the selection
   * without covering it — see the design spec's §2. Renderers with no on-page position concept
   * (the side-panel mirror) ignore the extra parameter; TypeScript permits an implementer to
   * declare fewer parameters than the interface.
   */
  renderLoading(word?: string, anchor?: AnchorRect): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  close(): void;
}
```

`AnchorRect` is already imported at the top of `ports.ts` — no new import needed.

In `packages/app/src/domain/workflow.ts`, change the single `renderLoading` call site (currently
`deps.renderer.renderLoading(e.text);`):

```ts
deps.renderer.renderLoading(e.text, e.anchor);
```

No other line in `workflow.ts` changes — the `NO_KEY` short-circuit still calls
`deps.renderer.renderError(mapError({ kind: 'no-key' }))` with no anchor involved.

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: 18 passed.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ports.ts packages/app/src/domain/workflow.ts packages/app/test/fakes/index.ts packages/app/test/workflow.test.ts
git commit -m "[A6SmartCardPlacement] feat: thread the selection anchor into ResultRenderer.renderLoading (A6)"
```

---

### Task 3: `BottomSheet.positionNear` — measure and place the panel

**Files:**

- Modify: `packages/app/src/ui/bottom-sheet.ts`
- Modify: `packages/app/test/ui/bottom-sheet.test.ts`

**Interfaces:**

```ts
// New public method on the BottomSheet class:
positionNear(anchor: AnchorRect | null): void;
```

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/ui/bottom-sheet.test.ts`, add
      three imports at the top of the file (after the existing three):

```ts
import type { BottomSheet } from '../../src/ui/bottom-sheet';
import { computeCardPlacement } from '../../src/domain/card-placement';
import type { AnchorRect } from '../../src/domain/types';
```

Change `mountSheet`'s return type and internal cast so tests can call the new method:

```ts
function mountSheet(): BottomSheet {
  const el = document.createElement('bottom-sheet') as BottomSheet;
  el.innerHTML = '<button id="a">a</button><button id="b">b</button>';
  document.body.append(el); // connectedCallback wires ARIA + focus
  return el;
}
```

Then add three new tests, right after the existing `'caps the panel with dynamic viewport
height...'` test and before `'has no axe violations'`:

```ts
it('positionNear(anchor) sets bottom to auto and positions the panel via computeCardPlacement (A6)', () => {
  const el = mountSheet();
  const panel = el.shadowRoot!.querySelector('.panel') as HTMLElement;
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 200,
    top: 0,
    left: 0,
    right: 400,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  const anchor: AnchorRect = { x: 100, y: 100, w: 50, h: 20 };
  el.positionNear(anchor);
  const expected = computeCardPlacement(
    anchor,
    { width: 400, height: 200 },
    { width: 800, height: 600 },
  );
  expect(panel.style.bottom).toBe('auto');
  expect(panel.style.top).toBe(`${expected.top}px`);
  expect(panel.style.left).toBe(`${expected.left}px`);
  vi.unstubAllGlobals();
});

it('positionNear(null) falls back to the bottom-center default without throwing (A6)', () => {
  const el = mountSheet();
  const panel = el.shadowRoot!.querySelector('.panel') as HTMLElement;
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 200,
    top: 0,
    left: 0,
    right: 400,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  expect(() => el.positionNear(null)).not.toThrow();
  const expected = computeCardPlacement(
    null,
    { width: 400, height: 200 },
    { width: 800, height: 600 },
  );
  expect(panel.style.top).toBe(`${expected.top}px`);
  expect(panel.style.left).toBe(`${expected.left}px`);
  vi.unstubAllGlobals();
});

it('positionNear is a no-op before the element has ever connected (A6)', () => {
  const el = document.createElement('bottom-sheet') as BottomSheet;
  expect(() => el.positionNear({ x: 0, y: 0, w: 0, h: 0 })).not.toThrow();
});
```

Run: `cd packages/app && bunx vitest run test/ui/bottom-sheet.test.ts`
Expected: 3 failures — `el.positionNear is not a function` (the method does not exist yet). The
13 pre-existing tests still pass.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/bottom-sheet.ts`, change the CSS constant's
      `.panel` rule (replace the static `left:0;right:0;bottom:0` with an explicit, measurable
      `width`; everything else in the rule is unchanged, character for character):

```ts
const CSS = `:host{${BASE_VARS};position:fixed;inset:0;z-index:var(--adp-z-overlay)}
${THEME_CSS}
.scrim{position:absolute;inset:0;background:var(--ad-scrim)}
.panel{position:absolute;
  width:min(var(--adp-card-width), calc(100% - 28px));
  max-height:88vh;max-height:88dvh;overflow-y:auto;overscroll-behavior:contain;padding:0 14px max(14px, env(safe-area-inset-bottom));
  transition:transform var(--adp-dur-slow) var(--adp-ease)}
::slotted(*){display:block;margin:0 auto}
:host([reduced]) .panel{transition:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;
```

Add two imports at the top of the file:

```ts
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';
import { computeCardPlacement } from '../domain/card-placement';
import type { AnchorRect } from '../domain/types';
```

Add a new public method on the `BottomSheet` class, directly after the existing `dismiss()`
method:

```ts
  /**
   * A6: position the panel as an overlay near `anchor` (the selection's viewport rect) so it
   * never covers the sentence the reader is looking at — see the design spec §2.5 for the
   * heuristic. `anchor === null` falls back to the pre-A6 bottom-center default (§2.4). Pure
   * math lives in computeCardPlacement; this method only measures the live DOM and applies the
   * result. Called by the renderer after every content update, since the panel's own height
   * changes between the loading and result states (§2.2).
   */
  positionNear(anchor: AnchorRect | null): void {
    if (!this.panel) return;
    const rect = this.panel.getBoundingClientRect();
    const { top, left } = computeCardPlacement(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.panel.style.bottom = 'auto';
    this.panel.style.top = `${top}px`;
    this.panel.style.left = `${left}px`;
  }
```

Run: `cd packages/app && bunx vitest run test/ui/bottom-sheet.test.ts`
Expected: 16 passed (13 pre-existing + 3 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/bottom-sheet.ts packages/app/test/ui/bottom-sheet.test.ts
git commit -m "[A6SmartCardPlacement] feat: bottom-sheet positionNear — measure and place the panel (A6)"
```

---

### Task 4: `InlineBottomSheetRenderer` — cache the anchor, reposition on every render

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

```ts
// InlineBottomSheetRenderer.renderLoading (widened, matches the ResultRenderer interface):
renderLoading(word?: string, anchor?: AnchorRect): void;
```

- [ ] **Step 1: Write the failing tests.** In `packages/app/test/app/
  inline-bottom-sheet-renderer.test.ts`, add `AnchorRect` to the existing `'../../src'`
      import and add a new import for `computeCardPlacement`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { InlineBottomSheetRenderer } from '../../src/app/inline-bottom-sheet-renderer';
import { computeCardPlacement } from '../../src/domain/card-placement';
import type { LookupResult, LookupError, AnchorRect } from '../../src';
import type { SafeHtml } from '../../src/ui/index';
```

Add a helper right after the existing `card(host)` helper:

```ts
function sheetPanel(host: HTMLElement): HTMLElement {
  return host.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel') as HTMLElement;
}
```

Add four new tests, right after the existing `'renderLoading(word) shows the selected word as the
headword immediately'` test:

```ts
it('renderLoading(word, anchor) positions the sheet panel per computeCardPlacement (A6)', () => {
  const h = host();
  const anchor: AnchorRect = { x: 40, y: 60, w: 30, h: 10 };
  new InlineBottomSheetRenderer(h).renderLoading('resilient', anchor);
  const panel = sheetPanel(h);
  const box = panel.getBoundingClientRect();
  const expected = computeCardPlacement(
    anchor,
    { width: box.width, height: box.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  expect(panel.style.bottom).toBe('auto');
  expect(panel.style.top).toBe(`${expected.top}px`);
  expect(panel.style.left).toBe(`${expected.left}px`);
});

it('a later renderResult (no anchor arg) reuses the anchor cached by the preceding renderLoading (A6)', () => {
  const h = host();
  const anchor: AnchorRect = { x: 40, y: 60, w: 30, h: 10 };
  const renderer = new InlineBottomSheetRenderer(h);
  renderer.renderLoading('bank', anchor);
  const topAfterLoading = sheetPanel(h).style.top;
  renderer.renderResult(result);
  expect(sheetPanel(h).style.top).toBe(topAfterLoading);
});

it('close() clears the cached anchor — a later renderLoading with no anchor uses the bottom-center default (A6)', () => {
  const h = host();
  const renderer = new InlineBottomSheetRenderer(h);
  renderer.renderLoading('bank', { x: 40, y: 60, w: 30, h: 10 });
  renderer.close();
  renderer.renderLoading('bank2');
  const panel = sheetPanel(h);
  const box = panel.getBoundingClientRect();
  const expected = computeCardPlacement(
    null,
    { width: box.width, height: box.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  expect(panel.style.top).toBe(`${expected.top}px`);
  expect(panel.style.left).toBe(`${expected.left}px`);
});

it('renderLoading() with no anchor at all does not throw (A6)', () => {
  const h = host();
  expect(() => new InlineBottomSheetRenderer(h).renderLoading()).not.toThrow();
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: 4 failures — the panel's `style.top`/`style.left` are never set (`setState` doesn't call
`positionNear` yet), so each assertion sees `''` instead of a pixel value. The 35 pre-existing
tests still pass.

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, replace
      the import block:

```ts
import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  Provider,
  Theme,
  SavedWordStatus,
  AnchorRect,
} from '../index';
import {
  renderCardState,
  type CardState,
  type LookupCard,
  type BottomSheet,
  type SafeHtml,
} from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';
```

Change the `sheet` field's type (it needs the `BottomSheet`-specific `positionNear` method, not
just generic `HTMLElement`) and add a new cached-anchor field, right after the existing fields:

```ts
export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: BottomSheet | null = null;
  private card: LookupCard | null = null;
  private _theme: Theme = 'sepia';
  private onSwitch: ((p: Provider) => void) | undefined;
  private onForceLiteral: (() => void) | undefined;
  private lastState: CardState | null = null;
  // A6: the selection's anchor rect for the currently-open card, captured by renderLoading and
  // reused by every subsequent render of the same card (setState → positionNear) — see the
  // design spec §2.2. null before any render, after close(), or when no anchor was ever known
  // (the NO_KEY short-circuit path, design spec §2.4).
  private lastAnchor: AnchorRect | null = null;
```

In `ensureCard()`, cast the created element to `BottomSheet` (same pattern already used for
`card`):

```ts
  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet') as BottomSheet;
    const card = document.createElement('lookup-card') as LookupCard;
```

(The rest of `ensureCard`'s body — `card.setAttribute`, `if (this.opts.sidePanel)`,
`sheet.setAttribute`, `sheet.append(card)`, the `dismiss`/`close`/`switch-provider`/
`force-literal` listeners, `this.host.append(sheet)`, the field assignments, `return card` — is
unchanged.)

Replace `setState` and `renderLoading`:

```ts
  private setState(state: CardState): void {
    this.lastState = state;
    const card = this.ensureCard();
    card.replaceChildren(...renderCardState(state));
    this.sheet?.positionNear(this.lastAnchor);
  }

  renderLoading(word?: string, anchor?: AnchorRect): void {
    this.lastAnchor = anchor ?? null;
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }
```

Replace `close()`:

```ts
  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
    this.lastAnchor = null;
  }
```

`renderResult`, `renderError`, `appendToCard`, `setSaved`, `setStatus`, `dismissNudge`, and the
`theme` getter/setter are unchanged — they all still funnel through `setState`, which now always
repositions using whatever anchor is currently cached.

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: 39 passed (35 pre-existing + 4 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A6SmartCardPlacement] feat: reposition the card on every render, cache anchor across state changes (A6)"
```

---

### Task 5: `content.ts` — forward the anchor through the Chrome composite renderer

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` in this repo — it is a composition root, covered
by e2e only (same precedent as B5's `content.ts`/`side-panel.ts` edits, and C2's `options.ts`
Task 2). This task's correctness is proven by Task 6's e2e; still run the typecheck/lint gate
below at the end so a regression in existing behavior (save/status/nudge listeners, etc. — all in
the same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/content.ts`, inside the
      `renderer` object literal passed to `runLookupWorkflow` (the object starting at
      `renderer: {`), replace the `renderLoading` method:

```ts
    renderLoading(word, anchor) {
      lastFocus = word === undefined ? { state: 'loading' } : { state: 'loading', word };
      lastSavePayload = undefined;
      lastSaved = false;
      lastStatus = undefined;
      saveReplyGuard.next();
      inline.renderLoading(word, anchor);
      mirror.renderLoading(word);
    },
```

(was `renderLoading(word) { ...; inline.renderLoading(word); mirror.renderLoading(word); }`.)
`anchor`'s type is inferred contextually from the object literal's target type
(`WorkflowDeps['renderer']: ResultRenderer`) exactly like `word`'s type already is — no new
import needed. `mirror.renderLoading(word)` stays a single-argument call (the side-panel mirror
doesn't take/need an anchor — see the design spec §2.1 and Global Constraints above). No other
line in `content.ts` changes.

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors).

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/content.ts
git commit -m "[A6SmartCardPlacement] feat: forward the selection anchor through the Chrome content-script renderer (A6)"
```

---

### Task 6: e2e coverage — new placement spec + update the overflow regression spec

**Files:**

- Create: `packages/extension-chrome/e2e/a6-smart-card-placement.spec.ts`
- Modify: `packages/extension-chrome/e2e/bottom-sheet-overflow.spec.ts`

- [ ] **Step 1: Build for e2e.**

```
GEMINI_API_KEY= bun run build:chrome
```

- [ ] **Step 2: Write the new placement spec.** Create
      `packages/extension-chrome/e2e/a6-smart-card-placement.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('A6 smart card placement', () => {
  test('prefers directly below the selection when there is room', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await selectWord(page, 't', 'bank');
    const anchorRect = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const panelTop = await page.evaluate(() => {
      const panel = document.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel')!;
      return panel.getBoundingClientRect().top;
    });
    expect(panelTop).toBeGreaterThanOrEqual(anchorRect.bottom);
  });

  test('flips above the selection when there is not enough room below (viewport-clipped)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'spacer';
      spacer.style.height = '2000px';
      document.getElementById('t')!.before(spacer);
    });
    // Scroll so the paragraph's bottom sits a small, fixed margin above the viewport's bottom
    // edge, computed from the actual rendered rect — not a guessed pixel offset (avoids
    // CI font-metric flake).
    await page.evaluate(() => {
      const rect = document.getElementById('t')!.getBoundingClientRect();
      window.scrollBy(0, rect.bottom - (window.innerHeight - 40));
    });

    await selectWord(page, 't', 'bank');
    const anchorRect = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top };
    });
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const panelBottom = await page.evaluate(() => {
      const panel = document.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel')!;
      return panel.getBoundingClientRect().bottom;
    });
    expect(panelBottom).toBeLessThanOrEqual(anchorRect.top);
  });

  test('never shifts the host page layout when the card opens', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'layout-marker';
      marker.style.height = '20px';
      document.body.append(marker);
    });
    const before = await page.evaluate(() =>
      document.getElementById('layout-marker')!.getBoundingClientRect().toJSON(),
    );

    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const after = await page.evaluate(() =>
      document.getElementById('layout-marker')!.getBoundingClientRect().toJSON(),
    );
    expect(after).toEqual(before);
  });
});
```

Horizontal clamping is deliberately not re-verified here — `card-placement.test.ts` (Task 1)
already asserts the exact clamp math exhaustively and deterministically; constructing a reliable
"selection pinned to the viewport's right edge" DOM/CSS fixture in a real browser adds flake risk
(font-metric and text-reflow dependent) for no additional coverage over the pure-function tests.

Run:

```
cd packages/extension-chrome && bunx playwright test a6-smart-card-placement
```

Expected: 3 passed.

- [ ] **Step 3: Update the overflow regression spec.** In
      `packages/extension-chrome/e2e/bottom-sheet-overflow.spec.ts`, add an import:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_PLACEMENT_MARGIN } from '@ai-dict/app';
```

Replace the assertion block (currently `expect(m.panelTop).toBeGreaterThanOrEqual(0);` /
`expect(m.panelBottom).toBe(m.viewportH);` / `expect(m.scrolls).toBe(true);`):

```ts
// A6: the panel is no longer always bottom-anchored — it's positioned near the selection via
// computeCardPlacement, which guarantees (by construction, for any anchor position that fits
// within this 480px viewport with an 88dvh-capped panel) that the panel stays within
// [CARD_PLACEMENT_MARGIN, viewportH - CARD_PLACEMENT_MARGIN] on both edges. ±1 tolerates this
// test's own Math.round.
expect(m.panelTop).toBeGreaterThanOrEqual(CARD_PLACEMENT_MARGIN - 1);
expect(m.panelBottom).toBeLessThanOrEqual(m.viewportH - CARD_PLACEMENT_MARGIN + 1);
// …and the long definition scrolls inside it rather than overflowing the sheet.
expect(m.scrolls).toBe(true);
```

(The rest of the test — mocking, navigation, selection, the screenshot capture, the close-button
visibility check — is unchanged.)

Run:

```
cd packages/extension-chrome && bunx playwright test bottom-sheet-overflow
```

Expected: 1 passed.

- [ ] **Step 4: Commit** — gate, then commit:

```
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/a6-smart-card-placement.spec.ts packages/extension-chrome/e2e/bottom-sheet-overflow.spec.ts
git commit -m "[A6SmartCardPlacement] test: e2e coverage for smart card placement (A6)"
```

---

## Final gate (run once, after Task 6, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test
```

Run the **full** e2e suite here, not just the two specs Task 6 touched — `content.ts`,
`inline-bottom-sheet-renderer.ts`, and `bottom-sheet.ts` are shared plumbing that nearly every
in-page-card e2e spec exercises (lookup, selection, cooldown, saved-word, idiom-expansion,
provider-_, keyboard-commands, sanitize-hostile-output, side-panel_, etc.), so a narrower
"affected" subset would not catch a positioning regression surfacing through one of those paths.

Expected: typecheck clean on both packages; the full Vitest suite green — all pre-existing tests
remain green plus exactly 15 new tests added by this card (8 in `card-placement.test.ts`, 3 in
`bottom-sheet.test.ts`, 4 in `inline-bottom-sheet-renderer.test.ts`; the total suite count is not
hardcoded here since other cards landing before this one changes it); lint/format clean; the
Chrome build succeeds with the env key cleared; the full Playwright suite passes — all
pre-existing specs remain green plus exactly 3 new tests in `a6-smart-card-placement.spec.ts`,
including the updated `bottom-sheet-overflow.spec.ts`.

Then confirm the C3 model still matches reality (this card adds one file to an existing component,
not a new component — see Global Constraints):

```
c3 sweep
```

or, if `sweep` is unavailable in this environment, `c3 audit`. If either reports a mismatch, stop
and report — do not hand-edit `.c3/`.

## PR

Regular merge (no squash — owner ruling 2026-07-16). Title: `[A6SmartCardPlacement] Smart card
placement`. Jira ticket link per the repo convention if one exists for this card; per REPO-FACTS
§13, no `.github/PULL_REQUEST_TEMPLATE` file exists in this repo, so the required body element is
a written **"Testing performed"** section (no screenshots/video — owner ruling 2026-07-16),
listing:

- Unit: full suite passed — all pre-existing tests green plus exactly 15 new tests added by this
  card (8 `card-placement.test.ts` + 3 `bottom-sheet.test.ts` + 4
  `inline-bottom-sheet-renderer.test.ts`; the `workflow.test.ts` happy-path test also gained one
  assertion, no new test count there). State the actual before/after totals from the run in the
  PR body — do not carry forward a number written into this plan, since other cards landing first
  change the pre-existing baseline.
- Typecheck: `packages/app` and `packages/extension-chrome` both clean.
- Lint + format: clean.
- Build: `GEMINI_API_KEY= bun run build:chrome` succeeded.
- E2e: full Playwright suite passed — all pre-existing specs green plus exactly 3 new tests in
  `a6-smart-card-placement.spec.ts`; `bottom-sheet-overflow.spec.ts` updated and passing.
