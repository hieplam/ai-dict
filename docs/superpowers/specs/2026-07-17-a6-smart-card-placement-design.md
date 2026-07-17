# A6 — Smart card placement

Roadmap card: `docs/ROADMAP.md` §4 A6 (Impact 3 · Effort S · Score 3.0). Depends on: — (independent).
Scope fence (quoted): "Positioning only; card stays an overlay and must never shift page layout."
Lead decides: placement heuristic. Escalate: none — no ROADMAP §8 decision-log entry exists for
A6; every open choice below is pinned here per CONTRACTS §1.

## 1. Problem (grounded in code)

Today the lookup card is **not** positioned relative to the selection at all — it is a
full-viewport-width modal sheet permanently anchored to the bottom of the screen, regardless of
where on the page the reader made their selection:

- `BottomSheet`'s `.panel` rule (`packages/app/src/ui/bottom-sheet.ts:24-26`):
  `position:absolute;left:0;right:0;bottom:0;max-height:88vh;max-height:88dvh;overflow-y:auto;...`
  — always full width, always flush to the viewport bottom. The `:host` itself is
  `position:fixed;inset:0` (`bottom-sheet.ts:21`), i.e. the sheet already **is** an overlay that
  never shifts page layout — that half of the card fence is already true today and this card does
  not need to establish it, only preserve it.
- `InlineBottomSheetRenderer.ensureCard()` (`packages/app/src/app/inline-bottom-sheet-renderer.ts:47-72`)
  creates the `<bottom-sheet>`/`<lookup-card>` pair and appends it to `this.host` — no anchor rect
  is read or used anywhere in this file. `setState()` (74-82) writes content via
  `replaceChildren` and does nothing else positioning-related.
- The **only** anchor-aware positioning in the codebase today belongs to the small "Define"
  trigger **bubble**, not the card: `ChromeFloatingTrigger.show()`
  (`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts:29-42`) sets
  `el.style.position='fixed'; el.style.left=\`${anchor.x}px\`; el.style.top=\`${anchor.y+anchor.h}px\`;`
  — placed directly below the selection, with **no flip-when-clipped and no horizontal clamp**.
  This is the closest existing precedent for A6's rect math (cited throughout §2), but it solves a
  much easier problem: the bubble is small (~40px) and essentially never risks being clipped by
  the viewport edge the way a ~150-450px-tall card can.
- The selection's rect is captured once, as `AnchorRect = {x,y,w,h}` (`packages/app/src/domain/types.ts:1-11`),
  by `DomSelectionSource`'s `defaultReader()` (`packages/app/src/app/dom-selection-source.ts:15-31`,
  `range.getBoundingClientRect()` at line 22) and carried on `SelectionEvent.anchor`. It reaches
  `runLookupWorkflow`'s `onSelection` callback (`packages/app/src/domain/workflow.ts:123-139`) and
  is used **only** to call `deps.trigger.show(e.anchor, ...)` (line 124) — it is never forwarded to
  `deps.renderer` anywhere in `runLookup` (37-121), including the `renderLoading(e.text)` call at
  line 64, which is the card's very first paint.

The result: because the sheet is always bottom-anchored and full-width, any selection whose
sentence sits in the lower portion of the viewport — the common case when reading a long article
and picking a word near the bottom of the visible screen — gets its own sentence hidden the
instant the card opens on top of it. This is exactly the "Today" behavior the roadmap card names:
"The card opens ... and can land on top of the sentence being read."

## 2. Design questions (every "Lead decides" item pinned)

### 2.1 How does the selection's anchor rect reach the card's positioning code?

**Pinned: widen `ResultRenderer.renderLoading`'s existing signature** —
`renderLoading(word?: string, anchor?: AnchorRect): void` (`packages/app/src/ports.ts:50-60`) —
and have `runLookupWorkflow` pass `e.anchor` through at the one call site
(`packages/app/src/domain/workflow.ts:64`).

Rejected alternatives:

- **(a) Add `anchor` to `ResultRenderContext`.** `ResultRenderContext` (`ports.ts:26-48`) is only
  ever constructed inside `runLookup`'s **success** branch (`workflow.ts:88-114`), which feeds
  `renderResult`. A loading state (`renderLoading`, line 64) and the `NO_KEY` short-circuit
  (`renderError` at line 61) never get a `ctx` at all — so the card would render un-positioned for
  its very first paint and for the no-key error, which is precisely the failure mode A6 exists to
  close (the card overlapping the sentence from the moment it appears, not just once a result
  eventually lands).
- **(b) A new port method, e.g. `ResultRenderer.setAnchor(anchor)`, called once by the workflow
  before `renderLoading`.** This adds a whole new method every `ResultRenderer` implementer
  (`InlineBottomSheetRenderer`, `ChromeSidePanelMirror`) must at least stub, for zero benefit over
  widening an already-optional existing parameter — `renderLoading`'s signature already has one
  optional param (`word`), so adding a second is the smaller, more consistent surface change.

`renderResult`/`renderError`/`setSaved`/`setStatus`/`dismissNudge` keep their existing signatures
unchanged — see §2.2.

### 2.2 Does every render call need its own anchor parameter?

**Pinned: no — cache the anchor from `renderLoading` and reuse it for every subsequent render of
the same open card.** `runLookup` always calls `renderLoading` exactly once, before any
`renderResult`/`renderError` for that same attempt (`workflow.ts:64` then 115 or 117); a fresh
`renderLoading` call always precedes a fresh anchor (or explicitly clears it — see §2.4). The one
call that can happen with **no** preceding `renderLoading` this "session" is the `NO_KEY`
short-circuit (`workflow.ts:61`), which is exactly the case §2.4's fallback covers. Threading
`anchor` through `renderResult`/`renderError` too would mean passing the identical value on every
call for no behavioral gain, and would force `content.ts`'s composite renderer and
`ChromeSidePanelMirror` (which never needs an anchor) to thread a parameter through call sites
that don't use it.

The card is repositioned on **every** state-carrying render (`renderLoading`, `renderResult`,
`renderError`, and the B1/B5/B7 in-place updates `setSaved`/`setStatus`/`dismissNudge`, all of
which funnel through the same private `setState`) using the cached anchor, because the card's own
height changes materially between the loading state (a one-line spinner) and the result state (a
full definition) — repositioning only once, at `renderLoading` time, could leave a now-taller
result card covering the sentence it was clear of while it was still loading.

### 2.3 Where does the pure placement function live?

**Pinned: `packages/app/src/domain/card-placement.ts`**, exporting `computeCardPlacement` and the
margin constant `CARD_PLACEMENT_MARGIN`. The function's signature is `(anchor: AnchorRect | null,
card: PlacementBox, viewport: PlacementBox, margin?: number) => CardPlacement` — pure numeric
rect math, no DOM/`chrome`/`fetch` access anywhere, so `rule-domain-purity`
(`.claude/rules/domain-purity.md`) permits it in `domain/` (imports only from `./types`). This
matches the existing precedent of every other pure transform already living in `domain/` with no
"-policy" suffix (`error-mapper.ts`, `defined-as.ts`, `translation-line.ts` — see
`REPO-FACTS.md` §3) and gives the dispatch note's required "unit tests for the pure placement
function" the flattest possible surface: no DOM/jsdom setup needed at all, unlike testing
`app/`-layer code that touches real elements.

Rejected: putting it in `packages/app/src/app/` (e.g. beside `inline-bottom-sheet-renderer.ts`).
Nothing about the function needs the `app/` layer's DOM-adapter privileges, and keeping it in
`domain/` is strictly more restrictive (enforced by `scripts/check-dep-direction.mjs` + ESLint
`import-x/no-restricted-paths`), which is the safer default per `ref-core-dependency-rule`.

### 2.4 What happens when no anchor is known at all?

**Pinned: fall back to the exact pre-A6 default position — bottom-center** — computed by the same
function via an explicit `anchor === null` branch, not a separate code path or a second exported
function. This is the one scenario that can render the card without ever having called
`renderLoading` with a real anchor: the `NO_KEY` short-circuit on the very first lookup attempt of
a session with no key configured (`workflow.ts:60-63`, `deps.renderer.renderError(...)` with no
prior `renderLoading` this attempt). `InlineBottomSheetRenderer` also passes `null` explicitly
after `close()` resets its cached anchor (§4.2), so a fresh card opened via some future no-anchor
path never inherits a stale, unrelated position from a previous lookup.

### 2.5 The placement heuristic itself (rect math)

**Pinned**, modeled on but extending `chrome-floating-trigger.ts:39-41`'s existing "place directly
below the selection" rule with the two things the trigger bubble doesn't need — a flip when
clipped, and horizontal clamping — because a ~150-450px-tall card risks viewport clipping in a way
a ~40px bubble essentially never does:

1. **Prefer directly below the selection**: `top = anchor.y + anchor.h + margin`. Fits if
   `top + card.height <= viewport.height - margin`.
2. **Flip above when viewport-clipped** (doesn't fit below): `top = anchor.y - margin -
card.height`. Used if `top >= margin`.
3. **Last-resort clamp** (fits neither above nor below — a viewport shorter than the card even
   with 0 margin, e.g. a very short mobile landscape viewport with a long definition): clamp the
   "below" candidate into `[margin, viewport.height - card.height - margin]`. If that upper bound
   is itself below the lower bound (card taller than the viewport can ever accommodate with
   margins), the clamp resolves to `margin` — i.e. pin the card to the top of the viewport with a
   margin rather than push it further off-screen. `bottom-sheet.ts`'s pre-existing `max-height:
88dvh` cap already keeps this an edge case, not the common path (see §2.6).
4. **Horizontal**: `left = clamp(anchor.x, margin, viewport.width - card.width - margin)`. When
   the card is wider than the viewport minus margins (`maxLeft < margin`, e.g. a narrow mobile
   viewport), the clamp resolves to `margin` (pin to the left edge with a margin, some right-edge
   overflow accepted as unavoidable) rather than an inverted/negative range.

`margin = CARD_PLACEMENT_MARGIN = 8` (px), mirroring the existing `--adp-space-8: 8px` token value
(`packages/app/src/ui/styles/tokens.ts:49`) for visual consistency with the rest of the design
system. It is a **plain exported number, not a live read of the CSS custom property** — domain
purity forbids `getComputedStyle`/CSS access from `domain/` — so it is a **known, documented
coupling**: if the design system's spacing scale ever changes `--adp-space-8`'s value, this
constant needs a matching manual update. Callers may override it via the optional fourth
parameter (used by tests), but no production call site does.

### 2.6 Does the card become full-width (mobile bottom-sheet look) or a fixed-width anchored panel?

**Pinned: the exact same effective width as today, just now measured explicitly instead of
implied by `left:0;right:0`.** `.panel`'s CSS changes from `left:0;right:0;bottom:0` to `width:
min(var(--adp-card-width), calc(100% - 28px))` (`bottom-sheet.ts`'s existing `--adp-card-width:
420px` token, `tokens.ts:60`, and `28px` = the same `14px` side padding the panel already has on
each edge, `bottom-sheet.ts:25`). On narrow (mobile) viewports this reproduces the identical
`100% - 28px` content width the old `left:0;right:0` + `padding:0 14px` combination already
produced. On wide (desktop) viewports it caps at `420px` — the SAME value `lookup-card.ts`'s own
`:host{...max-width:var(--adp-card-width)...}` (`lookup-card.ts:83`) already self-imposed, so the
old full-width panel's slotted card was **already** visually capped and centered at 420px via
`::slotted(*){margin:0 auto}` (`bottom-sheet.ts:27`). The desktop visual result is therefore
**pixel-identical** before/after this card; the only change is that `.panel`'s own box now matches
the card's rendered footprint, which `positionNear` (§4.1) needs to be able to measure via
`getBoundingClientRect()`.

### 2.7 Trigger bubble and Safari — in scope?

**Pinned: no change to either.**

- **Trigger bubble** (`chrome-floating-trigger.ts`): out of scope. The roadmap card is titled
  "Smart **card** placement" — its rect math is cited above as the existing precedent this card
  extends, not a target for modification. The bubble's own lack of flip/clamp logic is a
  pre-existing, accepted gap this card does not change.
- **Safari** (`packages/extension-safari/src/content.ts`): automatically inherits this fix with
  **zero source changes**. Its composition root passes the shared `InlineBottomSheetRenderer`
  instance **directly** as `deps.renderer` — `const renderer = new InlineBottomSheetRenderer(
document.body); ... runLookupWorkflow({ ..., renderer, ... });` (`extension-safari/src/content.ts:14,34-40`)
  — unlike Chrome's `content.ts`, which wraps the renderer in a composite object literal (§4.3)
  that must be updated to forward the new parameter. Confirmed by reading the file in full; no
  Safari-side test exists today for this wiring (a pre-existing gap noted in `REPO-FACTS.md` §14,
  not introduced by this card).

### 2.8 Animation on reposition?

**Pinned: none.** `top`/`left` are set as plain inline styles by `positionNear` (§4.1), not
through the existing `.panel{transition:transform ...}` rule (`bottom-sheet.ts:26`, which today
animates nothing — no code anywhere sets `.style.transform` — and is left completely untouched).
A loading→result reposition therefore snaps instantly rather than sliding. Adding motion here
would be new product surface (a reduced-motion guard, a duration/easing choice) beyond
"Positioning only," and is not requested by the card.

### 2.9 Viewport measurement source

**Pinned: `window.innerWidth`/`window.innerHeight`** (the layout viewport) — the same coordinate
space `dom-selection-source.ts:22`'s `range.getBoundingClientRect()` already uses to produce
`AnchorRect`, keeping anchor and viewport measurements consistent. `window.visualViewport`
(pinch-zoom-aware, and offset from the layout viewport when zoomed) is a known, accepted gap —
the same class of limitation the trigger bubble already has today (`chrome-floating-trigger.ts`'s
`show()` never re-measures on pinch-zoom either).

### 2.10 Anchor staleness during the async lookup gap (does it re-measure on scroll)?

**Pinned: no — matches the pre-existing, accepted precedent already set by the trigger.**
`TriggerUI.show(anchor, onClick)` (`ports.ts:16-19`) is called once, with the anchor captured at
`mouseup`/`touchend` time, and never re-measured if the page scrolls while the lookup is in
flight (`chrome-floating-trigger.ts:29-42` has no scroll listener). A6 reuses the identical
`SelectionEvent.anchor` value for the card, so it inherits exactly the same (pre-existing, not
new) limitation — not a regression this card introduces.

## 3. The change

### 3.1 New pure module — `packages/app/src/domain/card-placement.ts`

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

### 3.2 `packages/app/src/index.ts` — barrel export

Add one line so `computeCardPlacement`/`CARD_PLACEMENT_MARGIN`/`PlacementBox`/`CardPlacement` are
reachable the same way every other domain module is:

```ts
export * from './domain/card-placement';
```

Placed after the existing `export * from './domain/nudge-policy';` line (alongside the other pure
domain modules), before `export * from './domain/error-mapper';`.

### 3.3 `packages/app/src/ports.ts` — widen `ResultRenderer.renderLoading`

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

`AnchorRect` is already imported at the top of `ports.ts` (`import type { AnchorRect,
SelectionEvent, ... } from './domain/types';`) — no new import needed. No other `ResultRenderer`
method changes.

### 3.4 `packages/app/src/domain/workflow.ts` — forward the anchor

Single-line change at the existing `renderLoading` call site (`workflow.ts:64`):

```ts
deps.renderer.renderLoading(e.text, e.anchor);
```

(was `deps.renderer.renderLoading(e.text);`). No other line in this file changes — the `NO_KEY`
short-circuit (`workflow.ts:60-63`) still calls `deps.renderer.renderError(mapError({ kind:
'no-key' }))` with no anchor involved, which is exactly the case §2.4's `null` fallback covers.

### 3.5 `packages/app/src/ui/bottom-sheet.ts` — measure + position the panel

CSS: replace the static `left:0;right:0;bottom:0` with an explicit, measurable `width` (§2.6);
everything else in the rule (`max-height:88vh;max-height:88dvh;overflow-y:auto;
overscroll-behavior:contain;padding:...;transition:...`) is unchanged, character for character:

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

New import + method on the `BottomSheet` class:

```ts
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';
import { computeCardPlacement } from '../domain/card-placement';
import type { AnchorRect } from '../domain/types';
```

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

Placed as a new public method on `BottomSheet`, e.g. directly after `dismiss()` (`bottom-sheet.ts:107-109`).
No change to `connectedCallback`, `disconnectedCallback`, focus trap, Escape/scrim dismiss, or the
`reduced` attribute — all untouched (§5).

### 3.6 `packages/app/src/app/inline-bottom-sheet-renderer.ts` — cache the anchor, reposition on every render

Imports gain `AnchorRect` (type, from the existing `'../index'` import) and `BottomSheet` (type,
added to the existing `'../ui/index'` import):

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

Field type change (`sheet` needs the `BottomSheet`-specific `positionNear` method, not just
generic `HTMLElement`) and a new cached-anchor field, added next to the existing `lastState`:

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

`ensureCard()` — one-line cast, matching the existing `card` cast pattern:

```ts
  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet') as BottomSheet;
    const card = document.createElement('lookup-card') as LookupCard;
    // ...(unchanged body below this line)...
```

`setState` gains the reposition call; `renderLoading` gains the anchor parameter; `close()` resets
the cached anchor:

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

```ts
  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
    this.lastAnchor = null;
  }
```

`renderResult`, `renderError`, `setSaved`, `setStatus`, `dismissNudge`, `appendToCard`, the `theme`
getter/setter — all unchanged; they all still funnel through `setState`, which now always
repositions using whatever anchor is currently cached (§2.2).

### 3.7 `packages/extension-chrome/src/content.ts` — forward the anchor through the composite renderer

The inline `renderer` object literal passed to `runLookupWorkflow` (`content.ts:76-113`) gains the
second parameter on its `renderLoading` method and forwards it to `inline` only (the side-panel
`mirror` doesn't take/need it — §2.1's port doc comment):

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

(was `renderLoading(word) { ...; inline.renderLoading(word); mirror.renderLoading(word); }`).
`anchor`'s type is inferred contextually from `WorkflowDeps['renderer']: ResultRenderer` exactly
like `word`'s type already is — no new import needed. No other line in `content.ts` changes.

### 3.8 No change to `packages/extension-safari/src/content.ts`

Per §2.7 — the shared `InlineBottomSheetRenderer` instance is passed directly as `deps.renderer`,
so it already receives the new `anchor` parameter through `runLookupWorkflow`'s own forwarding
(§3.4) with zero Safari-side edits.

### 3.9 No change to `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`

Per §2.7 — cited throughout as the precedent, not a target.

### 3.10 No change to `packages/app/src/ui/lookup-card.ts` or `packages/app/src/app/markdown-sanitize.ts`

The card's own internal rendering, sanitization (S4), save/status/nudge rows, and provider picker
are untouched — this card only changes where the `<bottom-sheet>` **wrapper** sits on screen, not
anything about what the `<lookup-card>` renders inside it.

### 3.11 No change to `packages/app/src/adapters/chrome-side-panel-mirror.ts` (Chrome) file itself

`ChromeSidePanelMirror.renderLoading(word?: string): void` keeps its existing one-parameter
signature — TypeScript's structural typing permits a method that declares **fewer** parameters
than the interface it implements (the same rule that lets `Array.prototype.forEach`'s callback
ignore the `index`/`array` arguments), so it still satisfies the widened `ResultRenderer` without
any edit. `content.ts`'s composite renderer (§3.7) only ever calls `mirror.renderLoading(word)`
(one argument) — unchanged call site.

## 4. Scope fence held

- **"Positioning only"** — every change in §3 is either the new pure rect-math module, the
  threading of an existing value (`AnchorRect`, already captured by `dom-selection-source.ts`) one
  hop further, or `.panel`'s CSS `position`/`width` properties. No change to what the card
  _renders_ (`lookup-card.ts`), how results are fetched, sanitized, cached, or saved.
- **"Card stays an overlay"** — `:host{position:fixed;inset:0}` (`bottom-sheet.ts:21`) is
  completely untouched; the card was already an overlay and remains one. `.panel` stays
  `position:absolute` (relative to the fixed `:host`, i.e. the viewport) throughout.
- **"Must never shift page layout"** — nothing in this card touches the host page's DOM or CSS;
  the sheet/card live entirely inside the content script's own injected, `position:fixed` overlay
  root exactly as before. `positionNear`'s only page-adjacent DOM read is
  `window.innerWidth`/`window.innerHeight` (viewport size, not layout-affecting).
- **S1 (`rule-api-key-isolation`)**: not touched — no code in this card reads, stores, or
  transmits the API key.
- **S4 (`rule-sanitize-model-output`)**: not touched — `sanitizeMarkdown` and its call site
  (`inline-bottom-sheet-renderer.ts`'s `renderResult`, unchanged) are untouched; positioning
  happens after content is already sanitized and written to the DOM.
- **Constraint 4 (no background LLM calls)**: not touched — no lookup is triggered by this card;
  positioning is pure client-side geometry.
- **Design tokens only**: `.panel`'s new `width` expression reads the existing
  `--adp-card-width` token (no new token, no hard-coded color or hex value); `CARD_PLACEMENT_MARGIN`
  is a plain JS number (not a CSS property) for the documented domain-purity reason in §2.5.
- **No new manifest permission**: nothing in §3 touches `manifest.json`.

## 5. Testing strategy

### 5.1 Unit — `packages/app/test/card-placement.test.ts` (new)

Exhaustive coverage of the pure function, no DOM required:

1. Prefers directly below the selection when there is room.
2. Flips above when there is not enough room below (viewport-clipped).
3. Clamps to the viewport (pinned to `margin` from the top) when the card fits neither above nor
   below.
4. Clamps `left` up to `margin` when the anchor is near/past the left edge.
5. Clamps `left` down so the card's right edge never passes the viewport's right edge.
6. Falls back to the bottom-center default when `anchor === null`.
7. Keeps the card on-screen (pinned to `margin`) even when the card itself is wider than the
   viewport.
8. Honors a custom `margin` override.

### 5.2 Unit — `packages/app/test/ui/bottom-sheet.test.ts` (extended)

Integration-level checks that `positionNear` wires the DOM correctly (exact pixel math is already
exhaustively covered by §5.1, so these assert plumbing, not arithmetic — computed via the same
`computeCardPlacement` function under test, using whatever the jsdom/happy-dom environment's real
`getBoundingClientRect()`/`window.innerWidth`/`innerHeight` values are, so the assertions are
environment-agnostic):

1. `positionNear(anchor)` sets `panel.style.bottom` to `'auto'` and non-empty numeric-px
   `top`/`left` matching `computeCardPlacement(anchor, measuredCardSize, measuredViewport)`.
2. `positionNear(null)` falls back to the bottom-center default without throwing.
3. `positionNear` is a no-op (does not throw) when called before the element has ever connected
   (`this.panel` still null).
4. The existing "caps the panel with dynamic viewport height" test (`bottom-sheet.test.ts:129-141`)
   keeps passing unmodified — it asserts the `max-height:88dvh` CSS rule text, which §3.5 leaves
   byte-identical.

### 5.3 Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` (extended)

1. `renderLoading(word, anchor)` positions the sheet panel (`panel.style.bottom === 'auto'`,
   `top`/`left` set).
2. A later `renderResult(result)` (no anchor argument) reuses the anchor cached by the preceding
   `renderLoading` — same computed `top` (given the same measured card/viewport size).
3. `close()` clears the cached anchor: a `renderLoading('word')` call with no anchor argument
   after `close()` uses the bottom-center default, not a stale anchor from before the close.
4. `renderLoading()` with no anchor at all does not throw (default fallback path, §2.4).

All pre-existing tests in this file — none of which currently pass an anchor or assert on
`panel.style.top`/`left` — continue to pass unmodified (verified by reading the full file; see
`REPO-FACTS.md`-style grounding in §1).

### 5.4 Unit — `packages/app/test/workflow.test.ts` (extended) + `packages/app/test/fakes/index.ts` (extended)

`FakeResultRenderer.renderLoading` gains a second parameter and records it (`loadingAnchor`); the
existing "happy path" test (`workflow.test.ts:62-79`) gains one assertion:
`expect(h.renderer.loadingAnchor).toEqual(sel.anchor);` — proving `workflow.ts:64` actually
forwards `e.anchor`.

### 5.5 e2e — `packages/extension-chrome/e2e/a6-smart-card-placement.spec.ts` (new)

Three scenarios exercising the real pipeline end-to-end (Chrome, mocked Gemini):

1. **Prefers below**: a tall viewport, selection near the top of the page (default `gotoFixture`
   layout) → after the result renders, the card's panel rect is entirely below the selected
   word's rect (`panelRect.top >= wordRect.bottom`).
2. **Flips above when clipped**: a spacer pushes the fixture paragraph down the page; the test
   measures the paragraph's rect, then scrolls so its bottom sits a small, fixed margin from the
   viewport's bottom edge (computed from the _actual_ rendered rect, not a guessed pixel offset —
   avoids CI font-metric flake) → after the result renders, the card's panel rect is entirely
   above the selected word's rect (`panelRect.bottom <= wordRect.top`).
3. **Never shifts page layout**: a marker element's `getBoundingClientRect()` is identical before
   opening the card and after the result renders.

Horizontal clamping is **not** re-verified in e2e — §5.1's unit tests already assert the exact
clamp math exhaustively and deterministically; constructing a reliable "selection pinned to the
viewport's right edge" DOM/CSS fixture in a real browser adds flake risk (font-metric and
text-reflow dependent) for no additional coverage over the pure-function tests. This is a
deliberate testing-strategy choice, not a gap.

### 5.6 e2e — `packages/extension-chrome/e2e/bottom-sheet-overflow.spec.ts` (existing, updated)

This spec's current assertion `expect(m.panelBottom).toBe(m.viewportH)` (line ~66) hard-codes the
pre-A6 "always flush to the viewport bottom" behavior, which §3.5/§2.5 change (the panel now sits
`margin` px above the viewport bottom whenever it renders in the "below" or clamped-fallback
branch). The scenario's actual invariant — long content stays fully on-screen and scrolls inside
the sheet, per issue #52 — is unaffected (`max-height:88dvh` is untouched). Update:

- `panelBottom <= viewportH - CARD_PLACEMENT_MARGIN` and `panelBottom >= viewportH -
CARD_PLACEMENT_MARGIN * 2` replaces the exact `toBe(m.viewportH)` (the panel is now pinned near,
  not flush to, the bottom in this scenario's clamped-fallback case — a short 480px viewport with
  long content, matching §2.5 point 3).
- `panelTop >= 0` stays (still true, now with a documented margin instead of being incidental).
- `m.scrolls === true` stays unchanged.
- Import `CARD_PLACEMENT_MARGIN` from `@ai-dict/app` for the bound instead of a bare magic number.

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section lists the suites run, test counts, e2e scenarios
exercised, and gates passed (lint, format check, typecheck, unit, e2e) — matching exactly what §5
enumerates. No `pr-assets/*` branch is created for this card.

## 7. Concurrency

Files this card modifies that other unshipped cards also modify, so the orchestrator serializes:

- `packages/extension-chrome/src/content.ts` — CONTRACTS §5's "content-script/trigger" bucket
  (A5, A6, A13, A14, A15, B3, B4 all touch this composition root).
- `packages/app/src/domain/workflow.ts` and `packages/app/src/ports.ts` — **not** in CONTRACTS'
  pre-listed hot-file buckets, flagged here explicitly: A1 (streamed answers) is the card most
  likely to also touch `runLookupWorkflow`'s render-call sequence (it needs incremental repaints
  through the same `ResultRenderer` port for partial markdown). Recommend serializing A1 and A6 on
  these two files even though A1 is nominally grouped under the "lookup-card UI" bucket instead.
- `packages/app/src/app/inline-bottom-sheet-renderer.ts` and `packages/app/src/ui/bottom-sheet.ts`
  — same reasoning as above: any card that changes what `renderResult`/`renderLoading` do to the
  shared sheet (A1 again) collides with this card's `positionNear` plumbing.
- **No** collision expected at the `packages/app/src/ui/lookup-card.ts` file level with the
  CONTRACTS "lookup-card UI" bucket (A1 A2 A3 A5 A7 A10) — this card does not touch that file.

## 8. Risk / rollback

- **Risk: low-moderate.** The riskiest single change is `.panel`'s CSS width expression (§2.6,
  §3.5) — a regression here could visually break the card at some viewport size. Mitigated by
  choosing an expression that reproduces the pre-A6 effective width exactly on narrow viewports
  (`100% - 28px`, identical to the old `left:0;right:0;padding:0 14px` combination) and the
  pre-existing `420px` self-cap on wide ones (already true today via `lookup-card.ts`'s own
  `max-width`) — the desktop visual result is provably pixel-identical before/after.
- **Second risk**: the last-resort clamp branch (§2.5 point 3 — card fits neither above nor
  below) is exercised by a dedicated unit test but not by e2e (constructing it deterministically
  in a real browser needs an exotic viewport/content combination); accepted as a coverage gap
  proportionate to this card's effort size, not a silent omission (flagged here per the quality
  wall's "no silent caps" expectation).
- **No data migration.** Nothing persisted changes shape — `AnchorRect`, `CardState`, and every
  wire/storage schema are untouched.
- **Rollback:** revert the single PR. Pre-A6 behavior (always-bottom, full-width sheet) returns
  exactly as it was; `computeCardPlacement`/`positionNear` are pure additions with no persisted
  side effects to unwind.

## 9. Files touched (summary)

| File                                                            | Change                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/app/src/domain/card-placement.ts`                     | **New** — pure `computeCardPlacement` + `CARD_PLACEMENT_MARGIN`                         |
| `packages/app/test/card-placement.test.ts`                      | **New** — 8 unit tests (§5.1)                                                           |
| `packages/app/src/index.ts`                                     | + `export * from './domain/card-placement';`                                            |
| `packages/app/src/ports.ts`                                     | `ResultRenderer.renderLoading` gains optional `anchor?: AnchorRect`                     |
| `packages/app/src/domain/workflow.ts`                           | `renderLoading(e.text)` → `renderLoading(e.text, e.anchor)`                             |
| `packages/app/test/workflow.test.ts`                            | + anchor-forwarding assertion (§5.4)                                                    |
| `packages/app/test/fakes/index.ts`                              | `FakeResultRenderer.renderLoading` records `loadingAnchor`                              |
| `packages/app/src/ui/bottom-sheet.ts`                           | `.panel` CSS (`width` replaces `left/right/bottom`) + new `positionNear()` method       |
| `packages/app/test/ui/bottom-sheet.test.ts`                     | + 3 tests for `positionNear` (§5.2)                                                     |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`          | `lastAnchor` field, `renderLoading` signature, `setState` repositions, `close()` resets |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`    | + 4 tests for anchor plumbing (§5.3)                                                    |
| `packages/extension-chrome/src/content.ts`                      | Composite renderer's `renderLoading` forwards `anchor` to `inline` only                 |
| `packages/extension-chrome/e2e/a6-smart-card-placement.spec.ts` | **New** — 3 e2e scenarios (§5.5)                                                        |
| `packages/extension-chrome/e2e/bottom-sheet-overflow.spec.ts`   | Geometry assertions updated for margin-based (not flush) placement (§5.6)               |

No change to `packages/app/src/ui/lookup-card.ts`, `packages/app/src/app/markdown-sanitize.ts`,
`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`,
`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
`packages/extension-safari/src/content.ts`, any manifest file, or `docs/index.html`.
