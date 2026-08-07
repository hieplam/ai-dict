# A2 — Recursive lookup

Roadmap card: `docs/ROADMAP.md` §4 A2 (Impact 4 · Effort M · Score 2.0). Depends on: — (independent).
Slug: `a2-recursive-lookup`. C3: the content-script state machine is `c3-110 lookup-workflow`
(rules: `rule-domain-purity`, `rule-typed-errors`); card UI is governed by
`ref-web-components-shadow-dom`.

## 1. Problem (grounded in code, and in a live probe of today's behavior)

The roadmap card claims "you must close the card, and you can't select text inside it." That is
**not literally true today** — verified by driving the real extension (Playwright, bundled
Chromium, `bun run build:chrome` then a scripted in-card selection) rather than assuming from
source alone:

- The result body is written straight into the card's **light DOM** —
  `packages/app/src/ui/lookup-card.ts:278-279` (`const body = document.createElement('div');
body.innerHTML = state.safeHtml;`), appended via `this.replaceChildren(...)` and projected
  through a `<slot>` (`lookup-card.ts:533`). Light-DOM text is ordinary document content; nothing
  sets `user-select:none` anywhere in this codebase (`grep -rn user-select` — only one unrelated
  hit, `settings-form.ts:125`, on a `<summary>`). `window.getSelection()` sees it exactly like any
  other page text.
- `DomSelectionSource` (`packages/app/src/app/dom-selection-source.ts:35-51`) listens for
  `mouseup`/`touchend` on `document` — the same `document` the card's light DOM lives in (Chrome
  MV3's isolated content-script world and the MAIN world that owns the `<lookup-card>` class both
  see the one real page `document`; they are not separate DOM trees).
- Nothing in `runLookupWorkflow` (`packages/app/src/domain/workflow.ts:123-139`) or
  `ChromeFloatingTrigger` (`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`)
  filters a selection by where it originated.

A scripted probe (select a word inside an already-open card's rendered definition, then dispatch
`mouseup`) confirms mechanically:

```
SELECT RESULT   {"found":true,"selText":"institution","rect":{"w":67.8,"h":18}}
TRIGGER COUNT AFTER IN-CARD SELECTION   1
TRIGGER GEOM   {"topElementTag":"LOOKUP-TRIGGER","isTriggerOnTop":true}   // clickable, not occluded
CARD TEXT AFTER CLICKING INNER DEFINE (immediately, <2s later)
  → "Lookup failed / Slow down — wait a moment before the next lookup."
CARD TEXT AFTER CLICKING INNER DEFINE (waited 2.1s)
  → "institution / Save / bank\nA financial institution near a riverbank. / Gemini"
```

So the real, grounded problem is narrower and sharper than "selection doesn't work":

1. **A word inside a definition already triggers a real lookup today, by accident** — but it
   **destructively replaces the open card in place**. `InlineBottomSheetRenderer.ensureCard()`
   (`packages/app/src/app/inline-bottom-sheet-renderer.ts:47-72`) reuses the same `<bottom-sheet>`/
   `<lookup-card>` pair (`if (this.card && this.sheet) return this.card;`), and `setState`
   (`:74-82`) calls `replaceChildren(...)` unconditionally. The probe shows exactly this: after
   selecting "institution" inside the "bank" card and clicking Define, the SAME single
   `<bottom-sheet>` (count stayed 1) now shows "institution" — the original "bank" definition is
   gone, with **no way back**. This is the literal "dead end": the mechanism works, the _history_
   doesn't.
2. **The shared 2-second cooldown gate** (`COOLDOWN_MS = 2000`, `workflow.ts:17`,
   `lastFireAt`/`now()` check at `:128-134`) applies uniformly to every Define click, including
   one on a word inside a just-rendered definition — confirmed by the probe's first attempt
   ("Slow down…"). This is a genuine, grounded interaction A2 must decide whether to special-case
   (§3 below pins: no).
3. There is **no navigation stack anywhere** — `runLookupWorkflow` tracks only `inFlight`
   (the in-progress `AbortController`) and `lastFireAt`; no prior result is ever retained once a
   new one renders.

## 2. Design question 1 — how does the workflow tell "inside a definition" apart from "a new page selection"? (Lead decides — PINNED)

**Pinned:** mark the definition body with a plain CSS class used **only as a JS query target**,
no styling attached — `body.className = 'lookup-answer'` in `renderCardState`'s result branch
(`lookup-card.ts:278`, replacing the current unclassed `const body = document.createElement('div')`).
`DomSelectionSource`'s `defaultReader()` (`dom-selection-source.ts:15-31`, the one call site with
real DOM access — `rule-domain-purity` forbids this check inside `workflow.ts` itself) computes:

```ts
const startEl =
  range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
const insideResult = startEl?.closest('.lookup-answer') != null;
```

and stamps a new optional field, `SelectionEvent.insideResult?: boolean`, only when true (this
codebase's established `exactOptionalPropertyTypes` idiom — e.g. `LookupResult.provider?:
Provider | undefined` — omit the key rather than set it `undefined`). `runLookupWorkflow` treats
`insideResult === true` as "extend the chain"; absent/false is an ordinary page selection.

**Why the marker is scoped to the definition body, not the whole card:** the roadmap's own scope
fence says _"the sentence inside the definition is the inner lookup's context"_ — i.e. the card
in general (headword, Save button, footer) is explicitly out of scope; only the rendered markdown
answer is. Scoping the marker there also keeps `extractSentence`'s existing sentence-boundary
logic (`dom-selection-source.ts:5-12`, unchanged) meaningful: a selection's `range.startContainer`
inside `.lookup-answer` is real prose (the model's sanitized markdown), so "the sentence
containing the selection" resolves to an actual sentence, not e.g. the word "Settings".

**Rejected alternative — detect via `.closest('lookup-card')` (the whole card):** would also treat
a selection of the headword text, the "Save"/"Settings" labels, or the footer ("Stays on your
device") as a recursion attempt. Selecting UI chrome text and recursing into it has no sentence
context to extract and no product value; the roadmap fence's explicit "inside the _definition_"
wording rules this out.

**Rejected alternative — thread a `sourceIsCard` boolean through `ports.ts`'s `SelectionSource`
interface instead of computing it in the adapter:** the interface is deliberately minimal
(`onSelection(cb): () => void`, `ports.ts:12-14`); adding an out-of-band way to ask "was this
selection inside X" would need the adapter to know about the card DOM anyway (there is only ever
one caller, `DomSelectionSource`), so it is strictly more surface for the same computation.

## 3. Design question 2 — does the recursive lookup bypass the Define-spam cooldown, like A8/A3 one-shot re-runs do? (Lead decides — PINNED: no)

`onSwitchProvider` and `onForceLiteral` (`workflow.ts:95-113`) both bypass `COOLDOWN_MS`
deliberately — the code comments say so ("Deliberate switch bypasses the Define-spam cooldown —
it's not spam"). A2's in-definition Define click is **not** the same shape of action and is
**pinned to stay subject to the cooldown, with no special case**:

- A8/A3's bypassed actions **re-run the exact same already-fetched selection** against a
  different provider or reading — at most one extra paid call, and it is gated behind an existing
  result already on screen (the reader consciously chose "Switch" or "Show literal word").
- A recursive in-definition Define click selects **brand-new text** and fires a **brand-new paid
  lookup**, exactly like any other Define click on the page. Bypassing the cooldown here would let
  a reader chain 3 fresh paid API calls back-to-back with zero throttling — the precise spam
  pattern `COOLDOWN_MS` exists to stop (roadmap §3 constraint 4: "every model call is triggered by
  an explicit user action" — a rapid, unthrottled chain is a materially different cost profile
  than the existing bypasses).
- Consequence, stated plainly for the implementer and the reader: selecting a word inside a
  definition **immediately** after that definition finished loading can show "Slow down — wait a
  moment before the next lookup." for up to ~2 seconds, exactly the probe's observed behavior.
  This is accepted, not a bug to route around.

## 4. Design question 3 — what does "Depth capped at 3" mean, and where is it enforced? (Lead decides — PINNED)

**Pinned reading:** 3 is the **maximum number of cards ever in the chain at once**, counting the
original lookup. Chain: original (depth 1) → select inside it (depth 2) → select inside _that_
(depth 3) → no further recursion offered. `RECURSIVE_LOOKUP_DEPTH_CAP = 3` is exported from
`workflow.ts` (mirroring the existing `export const COOLDOWN_MS = 2000` pattern, `workflow.ts:17`).

**Rejected alternative — "3" means 3 _nested_ nested levels beyond the original (4 total):** reads
"capped at 3" as bounding only the recursive hops, not the whole visible chain. Rejected because
it contradicts the plain meaning of "depth capped at 3" (a chain of depth 4 is not capped at 3),
and a shallower cap keeps the mental model simple ("at most 3 cards deep, ever") and bounds
worst-case paid-lookup chains per selection burst to 3, not 4.

**Enforcement point — pinned to the trigger, not the lookup:** in `runLookupWorkflow`'s
`selection.onSelection` callback (`workflow.ts:123-139`), **before** `deps.trigger.show(...)` is
ever called:

```ts
if (e.insideResult === true && stack.length >= RECURSIVE_LOOKUP_DEPTH_CAP) return;
```

At the deepest level, selecting a word inside the definition shows **no "Define" trigger bubble at
all** — silently, exactly like today's existing "a collapsed selection shows no trigger" behavior
(`DomSelectionSource.defaultReader` already returns `null` for an empty/collapsed selection,
`selection.spec.ts:4-16`). No new UI state, no wasted paid call, no new copy.

**Rejected alternative — show the trigger, then reject the click with a new error state
("Max depth reached — go Back first"):** would need a new `LookupErrorCode` (not one of today's
`NO_KEY | INVALID_KEY | RATE_LIMIT | NETWORK | PARSE | UNKNOWN`, `types.ts:112-118`) or a
non-error UI branch nothing else in this codebase has, for a self-explanatory edge case: the
reader can already see they are 3 cards deep (each nested card visibly shows a fresh headword +
"Back" button, §5), and the Back button is right there. Adding a dead click + new copy for this is
unjustified UI surface for what "no trigger appears" already communicates for free.

**Rejected alternative — a visible depth counter ("2 of 3") on the card:** the roadmap fence asks
for "stack UI, depth-cap UX," not a counter specifically; the Back button visible/absent state
already communicates depth implicitly (present = not at the root; absent = at the root or at the
cap with no way to tell those two apart from the button alone — accepted, since going one level
too far simply shows no trigger, so a reader at the cap discovers it the moment they try, then
taps Back). Kept out to avoid new UI surface, new copy, and new i18n for a rare edge case.

## 5. Design question 4 — where does "Back" live, and how does it wire to the stack? (Lead decides — PINNED)

**Stack model** — `runLookupWorkflow` gains one closure-local array,
`stack: { event: SelectionEvent; result: LookupResult; providers: Provider[] }[]`, oldest first,
last = currently displayed (plain data — no DOM/chrome, stays domain-pure):

- **A fresh (non-recursive) selection succeeding** → `stack = [frame]` (wholesale reset). Matches
  today's existing behavior for "select somewhere else while a card is open" (replace in place) —
  A2 does not change that case, it only adds a _third_ option (push) for the in-definition case.
- **`e.insideResult === true` and `stack.length > 0` succeeding** → `stack.push(frame)` (extend the
  chain; gated at `RECURSIVE_LOOKUP_DEPTH_CAP`, §4).
- **`onSwitchProvider`/`onForceLiteral` re-running the same selection succeeding** → replace the
  top frame in place (`stack[stack.length - 1] = frame`) — same depth, same position; switching
  providers or forcing the literal reading is not "going deeper," it is re-answering the current
  card. (Existing behavior for these two paths is otherwise untouched.)
- **Back** (`onBack`, only offered when `stack.length > 1`) → `stack.pop()`, then
  `deps.renderer.renderResult(parent.result, buildCtx(parent))` on the new top frame — **no
  network call**, a pure local re-render of an already-fetched `LookupResult` from the cache-free
  in-memory stack.

**"Back" restores a _fresh_ render of the parent, not its prior save/status/nudge-dismissed
state — pinned, citing existing precedent, not a new limitation:** B1's own accepted rule is "a
fresh render always starts unstarred" (`content.ts:42-44`'s comment, "no is-already-saved round
trip"). Every `renderResult` call — recursive or not — already resets `lastSavePayload`/
`lastSaved`/`lastStatus` in `content.ts`'s `renderResult` handler (`content.ts:86-105`, runs
unconditionally on every call). Back does not special-case this: it calls the exact same
`deps.renderer.renderResult(...)` path any other lookup uses, so the existing reset logic applies
uniformly with zero new code in `content.ts`. If the reader had starred the parent word before
recursing away from it, Back shows it unstarred again — identical to how switching provider or
re-selecting the same word twice already behaves today.

**Back button placement — pinned to the card's light-DOM content (not the shadow-DOM `.bar`),
first node, before the headword:** the shadow-DOM `.bar` (brand + Settings/Close/side-panel
actions, `lookup-card.ts:514-528`) is built **once** in `connectedCallback` and never rebuilt per
render (confirmed by A7's spec, `docs/superpowers/specs/2026-07-17-a7-pin-cards-design.md:31,73`:
"built once in `connectedCallback` and never change[s] again"). Back must toggle on **every**
state change within one long-lived card instance (push → true, pop-to-root → false), so it belongs
in the **per-state light-DOM content** `renderCardState` already rebuilds via `replaceChildren`
(`lookup-card.ts:592-594`) — the same mechanism `renderSaveRow`/`renderDefinedAsRow`/
`renderNudgeRow` already use for exactly this reason (conditional, per-render rows). A new
`CardState.canGoBack?: boolean` field and a `renderBackRow()` function (mirroring
`renderNudgeRow`'s shape) are added; when true, the row is unshifted to the front of the node list
`renderCardState` returns for `kind: 'result'` (`lookup-card.ts:280-287`), so Back always reads as
the topmost, first-glance affordance — matching the near-universal "back = top-left" convention.

**Rejected alternative — a shadow-DOM `.bar` button (like Settings/Close):** would require a new
per-render toggle mechanism the card doesn't have today (the bar's action buttons are stamped once
from a static attribute — e.g. `hasAttribute('side-panel')` — never from mutable per-state data);
building that mechanism only for Back is more new surface than reusing the light-DOM content path
every other conditional row already uses.

**New icon — `ICON_BACK`, `styles/tokens.ts`:** a simple chevron-left glyph, appended after the
current last icon in the canonical §5.10 set, `ICON_STAR` (`tokens.ts:213-215`), same
stroke/viewBox/`aria-hidden` conventions as every other icon there. (A7 "pin cards" is unshipped
and sequenced after A2 in the roadmap's dependency order, ROADMAP §8 — there is no `ICON_PIN`
precedent to join yet; §13 flags `tokens.ts` as a plain append-only collision surface with A7
instead.)

## 6. Design question 5 — does the side panel get its own recursive-selection trigger? (Lead decides — PINNED: no)

The roadmap card's wording ("select any word inside the card/panel") could be read as requiring
the side panel to independently support in-place recursive selection. **Pinned: it does not.**
Grounded in the panel's actual, current architecture:

- `packages/extension-chrome/src/side-panel.ts` wires **no** `SelectionSource`, **no**
  `TriggerUI`, and **no** `LookupClient` of its own — it is a pure message-driven **mirror** of
  whatever the in-page content script's `runLookupWorkflow` renders
  (`chrome.runtime.onMessage.addListener(...)`, `side-panel.ts:224-252`, posted by
  `ChromeSidePanelMirror`, `chrome-side-panel-mirror.ts:9-39`). There is no baseline "select a
  word inside the panel → define it" flow to extend — building one from scratch for A2 would mean
  duplicating `DomSelectionSource` + a trigger UI + a `LookupClient` wiring a **second time** in a
  different composition root, roughly doubling this card's Effort-M budget for a capability no
  other roadmap card needed either.
- **Direct precedent already in this exact file:** `side-panel.ts`'s `resultToFocus(r:
LookupResult): PanelFocusState` (`side-panel.ts:114-127`) takes **only** a `LookupResult`, never a
  `ResultRenderContext` — so it structurally cannot receive `ctx.providers`/`onSwitchProvider`/
  `onForceLiteral` either. The function's own comment says exactly why: \*"Show the provider badge
  - fallback note in the panel too, but no one-shot picker here (the panel is a persistent
    surface, not the transient in-page card) — omit `providers`."\* A8's "Show literal word"
    (`ctx.onForceLiteral`) is omitted the same way (never threaded through `resultToFocus`). A2's
    `onBack` is architecturally identical — a one-shot, in-page-card-only contextual callback — so
    it follows the same, already-established precedent: **`resultToFocus` never receives `ctx` and
    therefore never sets `canGoBack`; the panel shows no Back button of its own.**
- The panel still **displays** whichever frame the in-page card currently shows (headword,
  definition, translation, provider badge) — because Back is implemented as an ordinary
  `deps.renderer.renderResult(...)` call inside `workflow.ts` (§5), and `content.ts`'s existing
  `renderResult` handler already forwards every such call to **both** `inline.renderResult(r, ctx)`
  and `mirror.renderResult(r, ctx)` (`content.ts:86-105`, unchanged). The panel mirrors the
  _result_, never the _navigation control_ — exactly the same split it already has for the
  provider picker and the idiom override.

**Rejected alternative — build independent selection/trigger/lookup wiring into
`side-panel.ts`:** rejected for the reasons above (no precedent, doubles scope, breaks the
established one-shot-actions-stay-in-page-card-only pattern this codebase already committed to
with A8).

## 7. The change

### 7.1 `packages/app/src/domain/types.ts` — one new optional field

`SelectionEvent` (`types.ts:8-14`) gains:

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  /**
   * A2: true when this selection's start lands inside the currently-rendered lookup result's
   * definition body (`.lookup-answer`, stamped by `renderCardState` in `ui/lookup-card.ts`) — the
   * reader selected a word INSIDE an existing definition, not on the surrounding page.
   * `runLookupWorkflow` uses this to decide whether to push a new frame onto the recursive
   * lookup chain (true) or start a fresh chain (absent/false). Computed only by
   * `DomSelectionSource`'s `defaultReader` — the one call site with real DOM access; every other
   * `SelectionEvent` producer (tests, fakes) simply omits it, which reads as false.
   */
  insideResult?: boolean;
}
```

### 7.2 `packages/app/src/app/dom-selection-source.ts` — compute the marker in `defaultReader`

`defaultReader()` (`:15-31`) gains the `.closest('.lookup-answer')` check (§2) and threads
`insideResult` onto the returned object only when true (EOP-safe spread, matching every other
optional field in this codebase). `extractSentence` and `DomSelectionSource`'s class body
(`:33-51`) are unchanged.

### 7.3 `packages/app/src/domain/workflow.ts` — the recursive-lookup stack

- New export `RECURSIVE_LOOKUP_DEPTH_CAP = 3` (alongside the existing `COOLDOWN_MS = 2000`).
- New closure-local `stack: StackFrame[]` (a local `interface StackFrame { event: SelectionEvent;
result: LookupResult; providers: Provider[] }`, not exported — internal to this module).
- New `buildCtx(frame: StackFrame): ResultRenderContext` helper, replacing the inline ctx-object
  literal currently built inside `runLookup`'s `try` block (`workflow.ts:88-114`) — same
  `providers`/`onSwitchProvider`/`onForceLiteral` logic, unchanged in substance, plus a new
  `onBack` key when `stack.length > 1`.
- `runLookup` gains a fourth parameter, `stackOp: 'push' | 'replace-top' | 'reset' = 'reset'`,
  and — on a successful `client.lookup` — updates `stack` per `stackOp` before calling
  `buildCtx`/`renderResult` (§5).
- The `selection.onSelection` callback (`:123-139`) gains the depth-cap early return (§4) and
  computes `stackOp` (`'push'` when `e.insideResult === true && stack.length > 0`, else `'reset'`)
  before calling `runLookup`.
- The `onSwitchProvider`/`onForceLiteral` closures (now built inside `buildCtx`) pass
  `stackOp: 'replace-top'`.
- The workflow's returned `teardown` function additionally resets `stack = []`.

Full replacement code is in the plan (Task 2) — reproduced there in full per house style, not
duplicated here.

### 7.4 `packages/app/src/ports.ts` — one new optional callback

`ResultRenderContext` (`:26-48`) gains:

```ts
/**
 * A2: pop the current recursive-lookup frame and re-render its parent (the previous result in
 * the chain) — a pure local re-render, no network call. Present only when a parent frame exists
 * (this result was reached via an in-definition selection); absent at the root of a chain.
 * Installed by `runLookupWorkflow`; consumed by the in-page card only — the side panel mirror
 * never receives it (`side-panel.ts`'s `resultToFocus` takes no `ResultRenderContext` at all,
 * matching how the provider picker and A8's "Show literal word" are also in-page-card-only).
 */
onBack?: () => void;
```

### 7.5 `packages/app/src/ui/styles/tokens.ts` — `ICON_BACK`

A new chevron-left icon constant, appended after the current last icon in the file, `ICON_STAR`
(`tokens.ts:213-215`), same `stroke="currentColor"`/`aria-hidden="true"` conventions as the rest
of the §5.10 set.

### 7.6 `packages/app/src/ui/lookup-card.ts` — `CardState.canGoBack`, `renderBackRow`, CSS

- `CardState`'s `'result'` variant (`:30-55`) gains `canGoBack?: boolean` next to the other
  boolean display flags (`saved?`, `nudge?`).
- The result body div (`:278-279`) gets `body.className = 'lookup-answer';` added before
  `body.innerHTML = state.safeHtml`.
- New `renderBackRow(): HTMLElement` function (mirrors `renderNudgeRow`'s shape, `:390-420`):
  builds a `.back-row > button.back-btn` dispatching a composed, payload-free `lookup-back` event
  (mirrors `close`'s parameterless composed-event pattern).
- `renderCardState`'s `'result'` branch (`:276-288`) unshifts `renderBackRow()` to the front of
  the returned node list when `state.canGoBack === true`.
- New CSS: `::slotted(.back-row){display:flex;margin:2px 0 8px}` in the main `CSS` template
  (next to `::slotted(.save-row)`, `:148`), and a `.back-btn`/`.back-btn svg`/`:hover`/
  `:focus-visible` block (mirroring `.save-btn`'s exact block, `:161-167`) plus a
  `prefers-reduced-motion` rule in `CARD_DOC_CSS`.

### 7.7 `packages/app/src/app/inline-bottom-sheet-renderer.ts` — wire `onBack`

- New private field `private onBack: (() => void) | undefined;` (alongside `onSwitch`/
  `onForceLiteral`, `:19-21`).
- `ensureCard()` (`:47-72`) gains one new listener, mirroring `switch-provider`/`force-literal`
  exactly: `card.addEventListener('lookup-back', () => this.onBack?.());`.
- `renderResult(r, ctx)` (`:88-107`) sets `this.onBack = ctx?.onBack;` and adds
  `canGoBack: ctx?.onBack !== undefined` to the `CardState` object passed to `setState`.
- `setSaved`/`setStatus`/`dismissNudge` (`:129-165`) are unchanged — they already spread
  `...rest`/`...this.lastState`, which carries `canGoBack` forward automatically (it is always a
  concrete boolean on the state object, never `undefined`-assigned, so no EOP issue).

### 7.8 `packages/app/src/ui/side-panel-view.ts` — CSS parity only (defensive, unreachable today)

Adds `.focus .back-row`/`.focus .back-btn` CSS rules mirroring `.focus .save-row`/`.focus
.save-btn` (`:61-68`), for consistency with the fact that **every** other class `renderCardState`
can produce already has a `.focus`-scoped mirror in this file. **This CSS is never actually
exercised by `side-panel.ts` today** (§6 — `resultToFocus` never sets `canGoBack`), but keeping
the mirror complete avoids an unstyled button if `CardState.canGoBack` is ever wired here by a
future card. No change to `SidePanelView`'s class body, `renderFocus`, or `PanelFocusState`.

### 7.9 `packages/extension-chrome/e2e/helpers.ts` — one new helper

New exported `selectWordInCard(page: Page, word: string): Promise<void>` (mirrors `selectWord`,
`:117-134`): finds `word` inside the currently-open card's `.lookup-answer` div via
`document.createTreeWalker`, selects it, and dispatches `mouseup` — the e2e-side equivalent of the
grounding probe in §1.

### 7.10 No change to these files (recorded explicitly)

- **`packages/app/src/wire.ts`, `packages/app/src/app/router.ts`** — recursion reuses the
  existing, unmodified `lookup` wire message end-to-end (§8). Every nested lookup is an ordinary
  `LookupRequest` differing only in `word`/`context`; `handleLookup`'s cache/history logic already
  treats every request independently by its own derived key — no special-casing needed, matching
  the existing precedent that provider-switch/force-literal re-runs already go through this exact
  same unmodified path today.
- **`packages/extension-chrome/src/content.ts`** — its `renderResult` handler
  (`content.ts:86-105`) already forwards `ctx` **wholesale** to both `inline.renderResult(r, ctx)`
  and `mirror.renderResult(r, ctx)`; `ctx.onBack` rides along with zero code changes. Its
  save/status/nudge closures already reset unconditionally on every `renderResult` call (§5).
- **`packages/extension-chrome/src/side-panel.ts`** — `resultToFocus(r: LookupResult)` takes no
  `ctx` parameter at all (§6); nothing to change or omit, it structurally cannot see `onBack`.
- **`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`** —
  `renderResult(r, ctx)` already extracts only `sentence`/`url`/`title` from `ctx` by name
  (`:24-32`); adding `onBack` to the `ResultRenderContext` type is invisible to this file (no
  wholesale spread of `ctx` into the posted message). Confirmed against its own test,
  `chrome-side-panel-mirror.test.ts:43-63` ("posts sentence/url/title... omits [them] when
  absent") — no assertion assumes a closed field set.
- **`packages/app/src/domain/error-mapper.ts`, `packages/app/src/domain/types.ts`'s
  `LookupErrorCode`** — no new error code (§4's rejected alternative).
- **`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`** — the depth cap is
  enforced by never calling `trigger.show(...)` in the first place (§4); the trigger adapter
  itself is unaware of recursion.
- **`packages/extension-chrome/src/manifest.json`, any Safari file** — no permission change, no
  Safari-specific behavior (Safari shell has no side panel and no A2-specific UI beyond the shared
  `packages/app` card, which gets the same `renderCardState` change automatically).

## 8. Scope fence (from the card, held exactly)

- **"Select any word inside the card/panel → define it, with Back navigation"** — held for the
  in-page card (§1-§5); the "panel" half is interpreted as _displaying_ the recursive chain, not
  independently triggering it (§6, grounded in the panel's actual architecture, not a fence cut).
- **"The sentence inside the definition is the inner lookup's context"** — held exactly:
  `extractSentence` is unchanged; a selection inside `.lookup-answer` naturally resolves its
  sentence from that same rendered markdown (§2).
- **"Depth capped at 3"** — held and pinned precisely (§4): `RECURSIVE_LOOKUP_DEPTH_CAP = 3`,
  enforced before the trigger ever shows.
- **S1 (API key isolation)** — untouched. This card adds no wire message, no new settings field,
  and touches no code path near `apiKey`/`chrome.storage.local` settings reads.
- **S4 (sanitize model output)** — untouched. Every nested lookup's `LookupResult.markdown` still
  passes through `sanitizeMarkdown` at the exact same call site
  (`inline-bottom-sheet-renderer.ts:95`, unchanged) before it ever reaches `.lookup-answer`'s
  `innerHTML`; Back never re-renders anything that bypasses this (it re-renders an already-
  sanitized `LookupResult` through the same `setState`/`sanitize` path).
- **Constraint 4 (every model call is user-triggered, no background spend)** — held: every frame
  in the stack corresponds to one explicit Define click; Back makes zero network calls (§5); the
  cooldown gate is deliberately NOT bypassed for recursive lookups (§3), keeping worst-case spend
  bounded to one paid call per explicit click, throttled the same as any other Define click.
- **Design tokens only** — the one new icon (`ICON_BACK`) and the two new CSS blocks
  (`.back-row`/`.back-btn` in both `lookup-card.ts` and `side-panel-view.ts`) read only
  `--ad-*`/`--adp-*` tokens, matching `.save-btn`'s existing block verbatim in structure.
- **Ports architecture** — the only port change is one new optional field on
  `ResultRenderContext` (`ports.ts`); no new port, no change to `SelectionSource`/`TriggerUI`/
  `LookupClient`/`SettingsStore`/`Storage`.

## 9. Testing strategy

### 9.1 Unit — `packages/app/test/app/dom-selection-source.test.ts` (append)

- A selection whose range starts inside an element carrying `.lookup-answer` yields
  `insideResult: true` on the emitted `SelectionEvent`.
- A selection elsewhere in the document (no `.lookup-answer` ancestor) yields no `insideResult`
  key at all (`'insideResult' in event === false`), preserving every existing test's assumptions.

### 9.2 Unit — `packages/app/test/workflow.test.ts` (append)

- A first (`insideResult` absent) selection succeeding renders with `ctx.onBack === undefined`
  (root of a fresh chain).
- A second selection with `insideResult: true` succeeding renders with `ctx.onBack` defined;
  calling it re-renders the FIRST result verbatim (`renderer.lastResult`/`lastCtx` match the first
  call's), with **no additional `client.lookup` call** (`client.lastReq`'s call count unchanged).
- Three consecutive `insideResult: true` selections succeed (reaching `stack.length === 3`); a
  fourth `insideResult: true` selection never calls `trigger.show` (`h.trigger.shown` stays
  `null`) — the depth cap.
- An `insideResult: false` (ordinary) selection after a chain is established resets the chain:
  the next successful render's `ctx.onBack` is `undefined` again.
- A recursive push is still subject to the cooldown gate (advance the fake clock < `COOLDOWN_MS`
  after the parent's fetch resolves; the child click is blocked with `RATE_LIMIT`/"Slow down",
  matching §3's pinned no-bypass decision) — reusing the existing cooldown-test harness pattern.
- `onSwitchProvider`/`onForceLiteral` re-runs still replace the top frame in place (existing tests
  in this file continue to pass unmodified; a new assertion confirms `stack.length`/`canGoBack`
  is unaffected by a provider switch at the root).

### 9.3 Unit — `packages/app/test/ui/lookup-card.test.ts` (append)

- `state.canGoBack === true` renders a `.back-btn`; `canGoBack` absent/false renders none.
- Clicking `.back-btn` fires a composed, bubbling `lookup-back` event (mirrors the existing
  `force-literal`/`switch-provider` event tests).
- The result body div carries class `lookup-answer` (locks the contract §2/§9.1 relies on).
- No axe violations with `canGoBack: true` (extends the existing a11y sweep pattern).

### 9.4 Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` (append)

- `renderResult(r, { onBack: fn })` sets `CardState.canGoBack === true` in the light DOM (a
  `.back-btn` appears); `renderResult(r)` (no ctx) renders none.
- Clicking `.back-btn` invokes the injected `onBack` (mirrors the existing
  `onSwitchProvider`/`onForceLiteral` click-wiring tests).

### 9.5 Unit — `packages/app/test/ui/side-panel-view.test.ts` (append)

- Setting `focusState` directly with `canGoBack: true` (bypassing `side-panel.ts`, exercising the
  shared `renderCardState` only) renders a `.back-btn` in the panel's shadow tree — locks the CSS
  parity added in §7.8 even though `side-panel.ts` itself never sets this field.

### 9.6 e2e — new `packages/extension-chrome/e2e/a2-recursive-lookup.spec.ts`

Three scenarios, each mocking Gemini via a custom `context.route` that inspects
`route.request().postData()` for `Word/phrase: "<word>"` to return a different canned definition
per nested word (`spelunking` → mentions "caves" → mentions "chambers" → mentions "underground"):

1. **Chain + Back, no re-fetch.** Select "spelunking" → Define (depth 1: "spelunking"/"caves").
   Wait past the cooldown; `selectWordInCard(page, 'caves')` → Define (depth 2: "caves"/
   "limestone", `.back-btn` count 1). Wait past cooldown; `selectWordInCard(page, 'chambers')` →
   Define (depth 3: "chambers"/"underground", `.back-btn` count 1). Wait past cooldown;
   `selectWordInCard(page, 'underground')` → assert **zero** `lookup-trigger` elements (depth
   cap). Click `.back-btn` twice: headword goes chambers → caves → spelunking, `.back-btn`
   disappears at the root; assert the Gemini mock's call count is unchanged across both Back
   clicks (no re-fetch).
2. **A fresh page selection resets the chain.** Build a two-word fixture ("spelunking" ... "bank
   of the river"). Recurse once (spelunking → caves, `.back-btn` present). Select "bank"
   elsewhere on the page (not via `selectWordInCard`) → Define: the card shows "bank" with
   `.back-btn` count 0 (a fresh, non-recursive chain, exactly today's existing "select elsewhere
   replaces the card" behavior — A2 does not change this case).
3. **The side panel mirrors the result but never shows its own Back button.** Open
   `side-panel.html` in the same context alongside a real content-script tab (mirrors
   `side-panel.spec.ts`'s `openPanelAndSender` pattern). Drive the chain from the tab (spelunking
   → caves). Assert the panel's `side-panel-view` shows "caves" (mirrored) while
   `bottom-sheet lookup-card .back-btn` (the tab) has count 1 **and** `side-panel-view .back-btn`
   (the panel) has count 0 — proving §6's architectural pin.

## 10. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section carries: suite/test counts for
`dom-selection-source.test.ts`, `workflow.test.ts`, `lookup-card.test.ts`,
`inline-bottom-sheet-renderer.test.ts`, `side-panel-view.test.ts` (§9.1-9.5), the 3 new e2e
scenarios (§9.6) with pass/fail, and the full gate list (lint, format:check, typecheck ×2,
`bun run test`, `GEMINI_API_KEY= bun run build:chrome`, affected e2e specs). No `pr-assets/*`
branch.

## 11. Risk / rollback

- **Risk: low-moderate.** The only genuinely new stateful logic is the `stack`
  push/replace-top/reset bookkeeping inside `runLookup` (§7.3) — a pure, synchronous, in-memory
  array with three transition rules, directly unit-tested (§9.2) including the depth-cap boundary.
  Everything downstream (rendering, Save/Status/nudge reset, side-panel mirroring) reuses existing,
  already-tested call paths unchanged (§7.10).
- **No data migration.** No persisted shape changes — `SavedWordEntry`/`HistoryEntry`/cache
  entries are untouched; the stack lives only in the content script's in-memory closure and is
  discarded on tab reload/navigation (consistent with today's "the card doesn't survive a page
  reload" behavior — not a regression).
- **No wire/permission change** — nothing here can break Safari, the service worker, or any other
  card's manifest/wire assumptions (§7.10).
- **Rollback:** revert the single PR. Every touched file's non-A2 behavior (provider switch, idiom
  override, Save/Status/nudge, side-panel mirroring, cooldown) is exercised by its own pre-existing
  test suite, which stays green throughout — a revert restores exactly today's behavior with zero
  residual state (no persisted shape ever changed).

## 12. Files touched (summary)

| File                                                         | Change                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/types.ts`                           | + `SelectionEvent.insideResult?: boolean`                                                                       |
| `packages/app/src/app/dom-selection-source.ts`               | `defaultReader` computes `insideResult` via `.closest('.lookup-answer')`                                        |
| `packages/app/src/domain/workflow.ts`                        | + `RECURSIVE_LOOKUP_DEPTH_CAP`, `stack`, `buildCtx`, `stackOp` param, depth-cap gate, `teardown` resets `stack` |
| `packages/app/src/ports.ts`                                  | + `ResultRenderContext.onBack?: () => void`                                                                     |
| `packages/app/src/ui/styles/tokens.ts`                       | + `ICON_BACK`                                                                                                   |
| `packages/app/src/ui/lookup-card.ts`                         | + `CardState.canGoBack?`, `renderBackRow`, `.lookup-answer` class, `.back-row`/`.back-btn` CSS                  |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`       | + `onBack` field, `lookup-back` listener, `canGoBack` in `renderResult`                                         |
| `packages/app/src/ui/side-panel-view.ts`                     | + `.focus .back-row`/`.focus .back-btn` CSS only (defensive parity, unreachable today)                          |
| `packages/extension-chrome/e2e/helpers.ts`                   | + `selectWordInCard`                                                                                            |
| `packages/app/test/app/dom-selection-source.test.ts`         | + tests (§9.1)                                                                                                  |
| `packages/app/test/workflow.test.ts`                         | + tests (§9.2)                                                                                                  |
| `packages/app/test/ui/lookup-card.test.ts`                   | + tests (§9.3)                                                                                                  |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | + tests (§9.4)                                                                                                  |
| `packages/app/test/ui/side-panel-view.test.ts`               | + test (§9.5)                                                                                                   |
| `packages/extension-chrome/e2e/a2-recursive-lookup.spec.ts`  | new — functional e2e (§9.6)                                                                                     |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/extension-chrome/src/content.ts`, `packages/extension-chrome/src/side-panel.ts`,
`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
`packages/app/src/domain/error-mapper.ts`,
`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`, any manifest file, or any
Safari-specific file (§7.10).

## 13. Concurrency

Per CONTRACTS §5's hot-file registry, this card touches files other not-yet-shipped Category A/B
cards also modify — the orchestrator must serialize these, not run them concurrently:

- **Lookup-card UI group (`packages/app/src/ui/lookup-card.ts`) — hot for A1, A2, A3, A5, A7,
  A10.** This card adds one `CardState` field (`canGoBack?`), one new render function
  (`renderBackRow`), a class-name addition to the existing result-body div, and 2 CSS blocks. A7
  (pin cards)'s own spec is confirmed to also plan a touch to this file's `CardState`/
  `renderSaveRow` area and to `styles/tokens.ts` for its own new icon
  (`docs/superpowers/specs/2026-07-17-a7-pin-cards-design.md:126`) — but A7 is **unshipped and
  sequenced after A2** in the roadmap's own dependency/quick-win ordering (`docs/ROADMAP.md`
  §8, "…A2, A5, A13, A14, A7, A12…"), so as of this spec neither `lookup-card.ts` nor
  `tokens.ts` carries any A7 code yet (confirmed against the pristine worktree: `tokens.ts`'s
  last icon today is `ICON_STAR`, `:213-215` — no `ICON_PIN`). Serialize against A7 on both files
  when it runs; A1/A3/A5/A10 are listed in CONTRACTS' own grouping as sharing `lookup-card.ts`
  too, even though not all are confirmed to touch it in their own specs.
- **`packages/app/src/domain/workflow.ts` and `packages/app/src/ports.ts` — confirmed hot for A1
  and A5.** A1 (streamed answers) adds `onChunk`/`renderPartial` wiring inside the SAME
  `runLookup` function this card modifies, and adds a method to `ResultRenderer`
  (`docs/superpowers/specs/2026-07-17-a1-streamed-answers-design.md:684-703`, its own §11
  Concurrency section already flags `ports.ts` as "first to add an optional method to
  `ResultRenderer`" — A2 does not touch `ResultRenderer`, only `ResultRenderContext`, but both
  land in the same file). A5 (gloss mode) also edits `runLookup`'s two call sites and adds
  `ResultRenderContext.anchor?`/a `ResultRenderer.renderLoading` parameter
  (`docs/superpowers/specs/2026-07-17-a5-gloss-mode-design.md:538-563`). **This is the highest-
  risk overlap in this card** — `runLookup`'s body is rewritten by this spec (§7.3) with a new
  4th parameter and a `stack`-aware ctx-builder; whichever of A1/A2/A5 lands second must rebase
  its `runLookup` edits by hand. Recommend sequencing these three one at a time, not in parallel.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts` — hot for A1** (A1's `renderPartial` +
  throttle addition, same spec §4.9) **and side-panel group overlap is N/A** (this file has no
  side-panel counterpart; `side-panel-view.ts` is the panel's own UI file, listed separately
  below). Serialize against A1 here too.
- **Side panel (`packages/app/src/ui/side-panel-view.ts` / `packages/extension-chrome/src/
side-panel.ts`) — hot for A2, B6, B10, B11** (CONTRACTS §5's own grouping). This card's
  `side-panel-view.ts` change is CSS-only and additive (§7.8); `side-panel.ts` itself is untouched
  (§7.10). Low collision risk, but still worth sequencing awareness against B6/B10/B11.
- **`packages/app/src/ui/styles/tokens.ts`** — a shared, append-only file (new icon constants).
  This card appends `ICON_BACK` after today's last icon, `ICON_STAR` (`:213-215`); A7 (pin cards,
  unshipped, sequenced after A2 per `docs/ROADMAP.md` §8) plans to append its own `ICON_PIN` here
  too once it runs. Low-risk (pure append), but flagging since two cards touching the same file
  concurrently is still a merge surface — serialize A2 before A7 on this file, matching the
  roadmap's own sequencing.
- **`packages/extension-chrome/e2e/helpers.ts`** — not in CONTRACTS §5's named registry, but a
  shared, append-only e2e helper file; any card adding an e2e helper (this card adds
  `selectWordInCard`) touches it. Low-risk append-only surface.
