# A7 — Pin cards

Roadmap card: `docs/ROADMAP.md` §4 A7 (Impact 3 · Effort M · Score 1.5). Depends on: — (independent).
Interacts with (not a dependency): A6 smart-card-placement (not yet built — see §6 Concurrency),
A1 streamed-answers, A2 recursive-lookup, A5 gloss-mode, A10 tts-pronunciation (all touch the same
`lookup-card.ts`/`inline-bottom-sheet-renderer.ts` files — CONTRACTS §5's hot-file list).

## 1. Problem (grounded in code)

Today exactly **one** lookup card can exist at a time, and it is a **modal**, not a floating
panel:

- `InlineBottomSheetRenderer` (`packages/app/src/app/inline-bottom-sheet-renderer.ts`) holds the
  live card as two singleton fields, `private sheet: HTMLElement | null` and
  `private card: LookupCard | null` (13-14). `ensureCard()` (47-72) returns the existing pair if
  one exists — `if (this.card && this.sheet) return this.card;` (48) — otherwise creates a new
  `<bottom-sheet>` + `<lookup-card>` pair and appends it to `this.host` (68, `document.body` in
  Chrome — `content.ts:20`). There is no mechanism anywhere in this class, or in `content.ts`, for
  more than one card to be on screen simultaneously; a second Define click **replaces** the first
  card's content via `replaceChildren` (`setState`, 74-82), it does not open a second one.
- The wrapper, `<bottom-sheet>` (`packages/app/src/ui/bottom-sheet.ts`), is a full-viewport modal:
  `:host{position:fixed;inset:0;z-index:var(--adp-z-overlay)}` (21) with a `.scrim` covering the
  whole viewport (23, click-to-dismiss at `connectedCallback`'s `scrim.addEventListener('click', ()
=> this.dismiss())`, line 44) and a bottom-anchored `.panel` (24-26, `position:absolute;left:0;
right:0;bottom:0`). `onKeydown` (72-79) closes on `Escape` unconditionally — `if (e.key ===
'Escape') { ... this.dismiss(); }` — and `connectedCallback` (35-65) installs a focus trap
  (`trapFocus`, 88-105) and steals initial focus (`this.panel?.focus()`, 64). None of this behavior
  is selective: whichever single sheet exists is always modal, always Esc-closable, always
  click-away-dismissible, and the reader cannot keep more than one open while scrolling to compare
  a definition against a passage further down the page — the exact gap the roadmap card names.
- `lookup-card.ts`'s `.actions` bar (`connectedCallback`, 519-528) is a **shadow-DOM** header built
  once, containing side-panel/settings/close buttons that never change per state — there is no
  existing precedent for a state-reactive shadow-DOM control. Word-level actions that DO change per
  render (`renderSaveRow` 322-357, `renderStatusBtn` 366-380, `renderNudgeRow` 390-420,
  `renderMetaRow`'s provider switcher 431-503) are instead **light-DOM** content produced by the
  pure `renderCardState(state): Node[]` function (240-288) and written via `replaceChildren` — the
  documented reason (`inline-bottom-sheet-renderer.ts:74-79`) is that this content-script renderer
  runs in a Chrome MV3 **isolated world**, while `LookupCard`'s class lives in the page's **MAIN**
  world (Chromium bug 390807): a JS property/method call never reaches the MAIN-world instance, but
  a **shared-DOM mutation** (an attribute write, or writing light-DOM children) does cross that
  boundary. Any new per-lookup-reactive control this card adds must follow the light-DOM pattern,
  not the shadow-DOM header pattern.
- Word-level actions are wired through **singleton, module-level state in `content.ts`** —
  `lastSavePayload`, `lastSaved`, `lastStatus` (42-63) — set fresh on every `renderLoading`/
  `renderResult` and read back when `toggle-save`/`toggle-status` fire (150-192). They describe
  "whatever the current lookup is," not a specific card instance. `InlineBottomSheetRenderer`'s own
  `setSaved`/`setStatus`/`dismissNudge` (129-165) all guard on `this.lastState` — also a singleton
  field, cleared to `null` by `close()` (167-172).
- Both Chrome (`content.ts:20`) and Safari (`content.ts:14` in `extension-safari`) construct the
  **same** `InlineBottomSheetRenderer` from `@ai-dict/app` and call the **same**
  `registerContentElements()` (`packages/app/src/ui/register.ts:8-12`) to register `lookup-trigger`/
  `lookup-card`/`bottom-sheet` — confirmed by reading both shells' `content.ts` files. Any change to
  the shared UI/renderer therefore reaches both shells for free; neither shell needs its own code
  for this card.
- No navigation-teardown logic exists anywhere (`grep -rn "popstate|pushState|beforeunload"
packages/app/src packages/extension-chrome/src` → zero hits, confirmed in this worktree): the
  single existing card already has no client-side-navigation dismissal, only the natural teardown
  of a full page (re-)load destroying the content-script realm.

**In one sentence: making a card "pin" means detaching it from the single-instance, modal
`<bottom-sheet>` machinery into an independent, non-modal, draggable shell — a mechanism that does
not exist today in any form.**

## 2. Design questions (card's "Lead decides: drag UX" — pinned, and others this card leaves open)

### 2.1 Where does the pin button live: shadow-DOM header, or light-DOM content?

**Pinned: light-DOM**, alongside the save row, built by a new pure function `renderPinRow` inside
`renderCardState` (§3.1), not as a fourth shadow-DOM `actionButton` next to settings/close/
side-panel.

Rejected: a shadow-DOM header button (matching settings/close/side-panel's `actionButton` helper,
`lookup-card.ts:552-581`). Those three are built once in `connectedCallback` and **never change
across state** — there is no existing mechanism for the content-script (isolated world) to
re-render shadow-DOM content after the fact, because (per §1) only shared-DOM mutations cross the
MV3 world boundary, and the shadow header is built exactly once. The pin control needs three
distinct visual states (pinnable / at-cap-disabled / already-pinned-inert) that change on every
`renderResult` (capacity) and once irreversibly per card (pinned), i.e. it is exactly the kind of
per-state-reactive control the codebase already solves with light-DOM + `replaceChildren` for
save/status/nudge/provider-switch. Reusing that existing, working pattern is simpler than inventing
a second reactivity channel (e.g. an observed attribute + `attributeChangedCallback` on the shadow
button) for a single new control.

### 2.2 What happens to word-level and one-shot actions on a pinned card?

**Pinned: they are removed entirely** — a pinned card shows headword, body, and a static provider
badge only (no switch picker); no save star, no status toggle, no nudge banner, no "Show literal
word." The Close button (shadow-DOM, unaffected) is the only remaining way to remove a pinned card.

This is forced, not a style preference: `toggle-save`/`toggle-status`/`dismiss-nudge` read/write
`content.ts`'s **module-level singleton** `lastSavePayload`/`lastSaved`/`lastStatus` (42-63,
150-192) — fields that always describe "whatever the live/current lookup is," never a specific
past card. The renderer's own `setSaved`/`setStatus`/`dismissNudge`/`onSwitch`/`onForceLiteral`
(74-172) are exactly the same shape — singleton fields cleared by `close()`. Once a card is pinned
and detached, it is no longer "the current lookup"; if its star/status/switch controls stayed
clickable, clicking them would silently act on **whatever word the live slot holds next**, not the
pinned word — a correctness bug (the wrong entry gets saved/re-looked-up), not a cosmetic one.

Rejected: making every renderer method instance-addressable (per-card `lastSavePayload`, per-card
`onSwitch`, etc.) so pinned cards keep full interactivity. This generalizes correctly, but turns a
single-instance renderer into a genuinely multi-instance one across `content.ts` and the renderer —
a much larger refactor than this card's Effort-M budget, and not what the roadmap card asks for
("keep up to 3 definitions floating **beside the text while you read on**" — a reference
companion, not three independently live lookup sessions). Revisit only if a future card explicitly
asks for interactive pinned cards.

### 2.3 Pin button behavior: one-directional toggle, or reversible pin/unpin?

**Pinned: one-directional.** Clicking Pin transitions `canPin`→irrelevant, `pinned: false` →
`pinned: true`, permanently, for that card's lifetime; there is no "unpin back to floating" or
"unpin back to the modal slot" action. The only path to remove a pinned card is Close.

Rejected: a reversible pin/unpin toggle. There is nowhere sensible to put an "unpinned" card back —
the singleton modal slot may already be showing a different, newer lookup by the time an old pin is
unpinned (§2.2), so "unpin" cannot mean "make this the live card again" without either clobbering
whatever the reader is currently looking up or requiring the same multi-instance rewrite rejected
in §2.2. A pinned card that can only be removed via Close is simple, unsurprising, and matches how
the existing Close button already behaves for the modal card.

### 2.4 Pin button placement, icon, and cap-reached affordance

**Pinned:** a new row (`.pin-row`) is the first light-DOM node, above the headword, right-aligned
(`justify-content:flex-end`) so it reads visually as a top-right corner control — close to (though
not inside) the shadow header's own close/settings icons above it. Label copy: "Pin" (unpinned,
enabled) / "Pinned" (already pinned, inert) — same text-plus-icon shape as the existing save button
(`renderSaveRow`, `lookup-card.ts:322-357`). A new icon, `ICON_PIN` (`styles/tokens.ts`, joining the
pinned §5.10 canonical set alongside `ICON_STAR`/`ICON_CLOSE`/etc.), a stroked pushpin glyph —
CSP-safe inline SVG, `stroke="currentColor"`, `stroke-width="1.7"`, `aria-hidden="true"`, matching
every other icon in the set exactly.

At the cap (3 already pinned), the button is **rendered `disabled` from the start** (computed by
the renderer before the click, §3.3), with an explanatory `aria-label`/`title`
("Unpin another card to pin this one (max 3)") — mirroring the existing `title` precedent on the
side-panel action button (`lookup-card.ts:563`, `if (act === 'side-panel') b.title = label;`).

Rejected: a silent no-op on the 4th click (no visual change beforehand, the click simply does
nothing). This repo has no toast/banner mechanism to explain the no-op after the fact, and a button
that looks clickable but silently isn't is worse than one that visibly can't be clicked and says
why — the disabled+labelled state is fully achievable with existing CSS/ARIA, so there is no
technical reason to prefer the silent version.

Rejected: auto-evicting the oldest pinned card to make room for a 4th. Silently closing a card the
reader deliberately kept open contradicts the entire premise of pinning ("keep... while you read
on"); an explicit cap that the reader must resolve themselves (unpin one, i.e. Close one) never
surprises them.

### 2.5 Drag implementation (card's own "Lead decides")

**Pinned: pointer events on a new host element, `<floating-pin>`**, the non-modal counterpart to
`<bottom-sheet>`. `<floating-pin>` listens for `pointerdown` on itself; a drag starts only when
`e.composedPath()` includes an element with `classList.contains('bar')` (the card's existing shadow
header, `lookup-card.ts:514-528`) **and does not** include a `<button>` (so clicking pin/settings/
side-panel/close never starts a drag). Verified empirically in this exact shape against happy-dom
15.11.7 (the vitest environment this repo uses, `packages/app/package.json:21`): a synthetic
`PointerEvent('pointerdown', {composed:true,bubbles:true})` dispatched on a shadow-DOM button
produces a `composedPath()` that includes both the button and its `.bar` ancestor when read from a
listener on an OUTER ancestor across an **open** shadow root (`lookup-card.ts:511`,
`attachShadow({mode:'open'})`) — exactly the same `composedPath()`-across-open-shadow-root technique
`chrome-floating-trigger.ts:15` already uses for its own outside-press dismissal. `setPointerCapture`/
`releasePointerCapture` are both present and callable on happy-dom 15.11.7 elements (verified); only
`hasPointerCapture` is absent there, so the implementation never calls it (release is wrapped in a
`try/catch` instead — safe in both environments; see §3.2).

Rejected: HTML5 native drag-and-drop (`draggable="true"`/`dragstart` et al.). It is built for
data-transfer between drop targets, fights custom positioning (browsers render a drag ghost image
at the OS level, not the live element), and has no clean touch-device story — pointer events are
the standard modern replacement for exactly this "move an on-screen panel" case.

Rejected: attaching the drag listener inside `<lookup-card>` itself (rather than the new
`<floating-pin>` wrapper). The card is also used, unpinned and un-draggable, inside `<bottom-sheet>`
and the side panel; teaching it to sometimes-drag would need a mode flag threaded through a
shared component used by three different hosts. A dedicated wrapper that only exists when a card is
pinned keeps drag-only-when-pinned true by construction — no conditional needed anywhere.

### 2.6 Z-order among multiple pinned cards

**Pinned: DOM order, not per-instance z-index arithmetic.** Every `<floating-pin>` shares one
static `z-index:var(--adp-z-pinned)` (a new primitive, §3.2). Fixed-position siblings with equal
z-index paint in DOM order, so "bring this pinned card to front" is simply
`this.parentElement?.append(this)` (re-appending an already-connected child moves it to the end of
its parent's children) on any `pointerdown` inside it — verified: `Node.append()` on an
already-connected node reorders it without needing to touch style at all.

Rejected: an incrementing per-instance `z-index` (a module-level counter bumped on each
interaction). It achieves the same visible result but adds mutable numeric state with no natural
ceiling _conceptually_ clashing with `--adp-z-overlay`'s already-maximum-int value
(`styles/tokens.ts:71`, `2147483647`) — DOM reordering needs no new state and cannot ever approach
that ceiling.

The **live/ambient modal** (`<bottom-sheet>`, still `--adp-z-overlay` = `2147483647`) must always
paint above every pinned card even if both are visible at once — a fresh Define click is the
reader's most immediate focus. `--adp-z-pinned` is therefore pinned at `2147483646` (§3.2), one
less than the ceiling, guaranteeing that ordering regardless of DOM position.

### 2.7 Initial position at the moment of pinning

**Pinned: a snapshot of the card's own `getBoundingClientRect()`**, taken by the renderer the
instant before detaching it (`pinCurrent()`, §3.3), and forwarded to the new `<floating-pin>`'s
`place({left, top})`. Because `position:fixed` coordinates are viewport-relative — exactly what
`getBoundingClientRect()` already reports — no conversion is needed, and the card never visually
jumps at the moment of pinning: it starts exactly where the reader was already looking at it.

### 2.8 What happens on page navigation

**Pinned: nothing new — pins die with the page, matching today's baseline.** Per §1, no
navigation-teardown mechanism exists anywhere in this codebase today (confirmed by grep); the
single existing card's only teardown is a full page (re-)load destroying the content-script realm
and its DOM. `<floating-pin>` elements are plain DOM nodes appended to `document.body` with no
`chrome.storage`/persistence involvement (per the card's own scope fence, §4) — a full reload
clears them for free, identically to how it already clears today's single card. This card
deliberately does **not** add SPA-route-change (`pushState`) detection: the unpinned card has never
had that either, so pinned cards inherit the exact same (non-)behavior rather than gaining a new
capability the rest of the product doesn't have.

## 3. The change

### 3.1 `packages/app/src/ui/lookup-card.ts`

- Import `ICON_PIN` alongside the other icons (`ICON_CLOSE`, `ICON_SHIELD`, etc., current import
  block at 3-12).
- `CardState`'s `'result'` variant (30-54) gains two new optional fields, placed after `nudge?:
boolean`:

  ```ts
  /** A7: whether this rendering surface supports pinning at all — undefined means "not
   * applicable" (e.g. the side panel, which is already persistent and never sets this — see
   * side-panel-view.ts, unchanged by this card); when defined, true means capacity remains
   * (fewer than 3 pinned) and false means the cap is reached. */
  canPin?: boolean;
  /** A7: whether this specific card instance has already been detached into a pinned floating
   * card. Only meaningful when canPin !== undefined. Renders the pin control as an inert
   * "Pinned" badge and strips the word-level controls entirely (see renderCardState). */
  pinned?: boolean;
  ```

- New pure function, placed just above `renderSaveRow`:

  ```ts
  /**
   * A7: the pin control — keeps this card open as an independent, draggable floating copy that
   * survives Esc, scrolling, and clicking elsewhere on the page (up to 3 at once). Returns null
   * when `state.canPin` is undefined: this rendering surface does not support pinning at all
   * (e.g. the side panel — already persistent, see side-panel-view.ts, unchanged by this card).
   * Dispatches a composed `pin` event; the in-page renderer (not a platform shell) performs the
   * actual detach (inline-bottom-sheet-renderer.ts's pinCurrent) — this function is pure UI, the
   * same separation every other card action already has.
   */
  function renderPinRow(state: { canPin?: boolean; pinned?: boolean }): HTMLElement | null {
    if (state.canPin === undefined) return null;
    const row = document.createElement('div');
    row.className = 'pin-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pin-btn';
    const isPinned = state.pinned === true;
    if (isPinned) {
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Pinned — use Close to remove it');
    } else {
      const atCap = state.canPin === false;
      btn.disabled = atCap;
      btn.setAttribute('aria-pressed', 'false');
      const label = atCap
        ? 'Unpin another card to pin this one (max 3)'
        : 'Pin this card so it stays open';
      btn.setAttribute('aria-label', label);
      if (atCap) btn.title = label; // native tooltip, mirrors the side-panel action's own `title`
      btn.addEventListener('click', () =>
        btn.dispatchEvent(new CustomEvent('pin', { bubbles: true, composed: true })),
      );
    }
    btn.innerHTML = ICON_PIN; // decorative aria-hidden SVG; name comes from aria-label
    const lbl = document.createElement('span');
    lbl.className = 'pin-lbl';
    lbl.textContent = isPinned ? 'Pinned' : 'Pin';
    btn.append(lbl);
    row.append(btn);
    return row;
  }
  ```

- `renderCardState`'s `'result'` branch (240-288) is restructured so a pinned card omits every
  word-level/one-shot control (§2.2), while the pin row itself always leads:

  ```ts
  const h = document.createElement('h2');
  h.textContent = state.word;
  const body = document.createElement('div');
  body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
  // A7: a pinned card is a read-only reference copy — word-level controls (save/status/nudge)
  // and one-shot re-lookup controls (switch-provider/force-literal, via renderMetaRow's
  // `providers` gate and the definedAs row) all act through the renderer's SINGLETON
  // "current lookup" state, which no longer describes this card once it is pinned and
  // detached (see the design spec §2.2) — they are omitted entirely rather than left inert.
  const nodes: Node[] = [h];
  if (state.pinned !== true) {
    nodes.push(renderSaveRow(state));
    if (state.nudge === true) nodes.push(renderNudgeRow(state));
  }
  const definedAsRow =
    state.pinned !== true && state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
  if (definedAsRow) nodes.push(definedAsRow);
  nodes.push(body);
  const meta = renderMetaRow(state); // pinCurrent() already stripped `providers`, so this
  if (meta) nodes.push(meta); // naturally renders the static badge only, never the switch
  const pinRow = renderPinRow(state);
  if (pinRow) nodes.unshift(pinRow);
  return nodes;
  ```

- CSS additions. In the main `:host` template string, right after the existing
  `::slotted(.save-row){display:flex;margin:6px 0 10px}` (139):

  ```css
  ::slotted(.pin-row) {
    display: flex;
    justify-content: flex-end;
    margin: 0 0 6px;
  }
  ```

  In `CARD_DOC_CSS` (document-scoped rules for slotted descendants `::slotted` cannot reach — the
  exact reason `.save-btn`/`.status-btn` already live there, 161-172), append:

  ```css
  lookup-card .pin-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--ad-line);
    background: transparent;
    color: var(--ad-ink-soft);
    border-radius: var(--adp-radius-control);
    padding: 4px 10px;
    font: inherit;
    font-size: var(--adp-text-2xs);
    font-weight: var(--adp-weight-semi);
    cursor: pointer;
    transition:
      background var(--adp-dur-fast) var(--adp-ease),
      color var(--adp-dur-fast) var(--adp-ease),
      border-color var(--adp-dur-fast) var(--adp-ease);
  }
  lookup-card .pin-btn svg {
    width: 15px;
    height: 15px;
    pointer-events: none;
  }
  lookup-card .pin-btn:hover:not(:disabled) {
    background: var(--ad-surface-raised);
    color: var(--ad-ink);
  }
  lookup-card .pin-btn:focus-visible {
    outline: 2px solid var(--ad-accent);
    outline-offset: 2px;
  }
  lookup-card .pin-btn[aria-pressed='true'] {
    border-color: var(--ad-accent);
    color: var(--ad-accent-ink);
  }
  lookup-card .pin-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  @media (prefers-reduced-motion: reduce) {
    lookup-card .pin-btn {
      transition: none;
    }
  }
  ```

### 3.2 `packages/app/src/ui/styles/tokens.ts`

- New exported constant, placed directly above `ADP_PRIMITIVES` so both the CSS custom property
  and `floating-pin.ts`'s JS derive from one source:

  ```ts
  // A7: floating pinned cards' base z-index — one below --adp-z-overlay's max-int ceiling
  // (below) so a live/ambient modal <bottom-sheet>, when also open, always paints above every
  // pinned card. Exported as a plain number (not just the CSS custom property) so
  // floating-pin.ts can read the exact same source of truth for DOM-order bring-to-front
  // (see the design spec §2.6 for why no per-instance z-index arithmetic is needed).
  export const Z_PINNED_BASE = 2147483646;
  ```

- `ADP_PRIMITIVES`'s stacking group gains one entry, right after `'--adp-z-overlay:2147483647'`:

  ```ts
  `--adp-z-pinned:${Z_PINNED_BASE}`,
  ```

- New canonical icon, appended to the §5.10 set (after `ICON_STAR`):

  ```ts
  // Pin (keep this card open, floating) — card body, A7. A pushpin silhouette: angled head +
  // tail, geometric, matching the set's stroke/viewBox/aria-hidden conventions exactly.
  export const ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14.5 3.5l6 6-3.2 1.9-1 4.3-2.3-2.3-5 5-1-1 5-5-2.3-2.3 4.3-1z"/><line x1="7.5" y1="16.5" x2="4" y2="20"/></svg>';
  ```

### 3.3 `packages/app/src/app/inline-bottom-sheet-renderer.ts`

- New module constant `const MAX_PINNED = 3;` and a new field
  `private readonly pinned: Set<FloatingPin> = new Set();` (every currently-open `<floating-pin>`).
- `renderResult` (88-107) adds one line to the built `CardState`:
  `canPin: this.pinned.size < MAX_PINNED` — computed fresh on every render, so a lookup started
  while already at the cap renders its pin button disabled from the first paint (§2.4); no
  `ResultRenderContext`/`ports.ts` change needed (§4 — this stays entirely inside the renderer).
- `ensureCard()` (47-72): store the live-close handler as a named field so it can be selectively
  removed later —
  `private readonly onLiveClose = (): void => this.close();`, used in place of the current inline
  arrow at `card.addEventListener('close', () => this.close())` (59) — and add one more listener
  next to the existing `switch-provider`/`force-literal` wiring:
  `card.addEventListener('pin', () => this.pinCurrent());`.
- New private method:

  ```ts
  /**
   * A7: detach the current live card from its modal <bottom-sheet> into an independent,
   * non-modal <floating-pin> shell (design spec §2). No-op if there is no live result card, or
   * the cap is already reached (defense-in-depth; the pin control itself is already rendered
   * disabled at the cap, per the `canPin: false` state renderResult just set).
   */
  private pinCurrent(): void {
    if (!this.card || !this.sheet) return;
    if (this.pinned.size >= MAX_PINNED) return;
    if (this.lastState?.kind !== 'result') return; // the pin control only ever renders for 'result'
    const card = this.card;
    const sheet = this.sheet;
    const rect = card.getBoundingClientRect(); // viewport coords — same frame <floating-pin> uses
    // Freeze the content for its detached life: strip everything that reads/writes through this
    // renderer's (or content.ts's) SINGLETON "current lookup" fields — see design spec §2.2.
    const {
      status: _status,
      nudge: _nudge,
      providers: _providers,
      definedAs: _definedAs,
      saved: _saved,
      ...rest
    } = this.lastState;
    const frozen: CardState = { ...rest, pinned: true };
    card.replaceChildren(...renderCardState(frozen));

    card.removeEventListener('close', this.onLiveClose);
    const pin = document.createElement('floating-pin') as FloatingPin;
    pin.setAttribute('data-ad-theme', this._theme);
    pin.append(card); // moves the existing (already re-rendered) element — no re-creation
    pin.place({ left: rect.left, top: rect.top });
    card.addEventListener('close', () => {
      pin.remove();
      this.pinned.delete(pin);
    });
    this.host.append(pin);
    this.pinned.add(pin);

    sheet.remove(); // the now-empty <bottom-sheet> wrapper (card already moved out)
    this.sheet = null;
    this.card = null;
    this.lastState = null; // forces the NEXT renderLoading/renderResult to build a fresh pair
  }
  ```

- `set theme(t)` (38-42) additionally propagates to every pinned card:

  ```ts
  set theme(t: Theme) {
    this._theme = t;
    this.card?.setAttribute('data-ad-theme', t);
    this.sheet?.setAttribute('data-ad-theme', t);
    // A7: pinned cards are independent, longer-lived subtrees the reader may keep open across
    // a settings change — they must re-theme too, not just the live card.
    for (const pin of this.pinned) {
      pin.setAttribute('data-ad-theme', t);
      pin.querySelector('lookup-card')?.setAttribute('data-ad-theme', t);
    }
  }
  ```

- Import `type { FloatingPin }` alongside the existing `type { CardState, LookupCard, SafeHtml }`
  import from `'../ui/index'`.
- `close()` (167-172) is **unchanged** — it only ever affects the live/unpinned card; pinned cards
  are deliberately independent of it (design spec §2.8's "pins die only on page nav").

### 3.4 `packages/app/src/ui/floating-pin.ts` (new file)

The non-modal counterpart to `bottom-sheet.ts` — no scrim, no focus trap, no Escape handling
(§2.8/design spec §1), a fixed-position, draggable shell around a slotted `<lookup-card>`:

```ts
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

// A7: the non-modal counterpart to <bottom-sheet> (bottom-sheet.ts). No scrim, no focus trap, no
// Escape handling — pinned cards must survive Esc, scrolling, and clicking elsewhere on the page
// (the whole point of pinning). Purely a fixed-position, draggable shell around a slotted
// <lookup-card>; the card itself already carries the visible surface (bottom-sheet.ts's own "One
// Surface Rule" comment), so this host stays transparent.
const CSS = `:host{${BASE_VARS};position:fixed;display:block;z-index:var(--adp-z-pinned);width:max-content;max-width:min(var(--adp-card-width),calc(100vw - 16px));touch-action:none}
${THEME_CSS}
::slotted(*){display:block}`;

export class FloatingPin extends HTMLElement {
  private dragging = false;
  private startPointer = { x: 0, y: 0 };
  private startRect = { left: 0, top: 0 };

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      adoptStyles(root, CSS);
      root.append(document.createElement('slot'));
    }
    this.addEventListener('pointerdown', this.onPointerDown);
  }

  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.onPointerDown);
    this.endDrag();
  }

  /** A7: place the card at a fixed viewport position — a snapshot of the on-page card's own
   * `getBoundingClientRect()` at the moment of pinning, captured by the renderer BEFORE the card
   * moves here, so pinning never visually jumps the card to a new spot. */
  place(rect: { left: number; top: number }): void {
    this.style.left = `${rect.left}px`;
    this.style.top = `${rect.top}px`;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Bring-to-front on ANY interaction, not just a drag: same-z-index fixed siblings paint in
    // DOM order, so re-appending as the host's last child is enough (design spec §2.6) — no
    // per-instance z-index bookkeeping needed.
    this.parentElement?.append(this);
    const path = e.composedPath();
    const onBar = path.some((n) => n instanceof Element && n.classList.contains('bar'));
    const onButton = path.some((n) => n instanceof Element && n.tagName === 'BUTTON');
    if (!onBar || onButton) return; // only the card's title bar drags it, never a button inside it
    e.preventDefault(); // suppress text-selection/native-drag ghosting while dragging
    this.dragging = true;
    this.setPointerCapture(e.pointerId);
    const r = this.getBoundingClientRect();
    this.startPointer = { x: e.clientX, y: e.clientY };
    this.startRect = { left: r.left, top: r.top };
    this.addEventListener('pointermove', this.onPointerMove);
    this.addEventListener('pointerup', this.onPointerUp);
    this.addEventListener('pointercancel', this.onPointerUp);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.startPointer.x;
    const dy = e.clientY - this.startPointer.y;
    // Clamp so at least a 32px sliver of the card stays on-screen and grabbable in every
    // direction — never fully draggable off the viewport.
    const margin = 32;
    const left = Math.min(
      Math.max(this.startRect.left + dx, margin - this.offsetWidth),
      window.innerWidth - margin,
    );
    const top = Math.min(Math.max(this.startRect.top + dy, 0), window.innerHeight - margin);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    try {
      this.releasePointerCapture(e.pointerId);
    } catch {
      // no-op — release throws harmlessly if capture was never established
    }
    this.endDrag();
  };

  private endDrag(): void {
    this.dragging = false;
    this.removeEventListener('pointermove', this.onPointerMove);
    this.removeEventListener('pointerup', this.onPointerUp);
    this.removeEventListener('pointercancel', this.onPointerUp);
  }
}
```

### 3.5 `packages/app/src/ui/register.ts` and `packages/app/src/ui/index.ts`

- `register.ts`'s `registerContentElements()` (8-12) registers the new element alongside
  `bottom-sheet`:

  ```ts
  import { FloatingPin } from './floating-pin';
  // ...
  if (!customElements.get('floating-pin')) customElements.define('floating-pin', FloatingPin);
  ```

- `index.ts` (the `ui/` barrel) adds `export * from './floating-pin';` next to
  `export * from './bottom-sheet';`.

Because both Chrome's and Safari's `content.ts` call this same `registerContentElements()` and
construct the same `InlineBottomSheetRenderer` (confirmed by reading both files — §1), **both
shells get pinning for free**; neither `packages/extension-chrome/src/content.ts` nor
`packages/extension-safari/src/content.ts` needs any change.

### 3.6 `packages/extension-chrome/src/content-elements.ts` (comment only)

Its header comment currently says "Registers the three custom elements in the page's MAIN world."
Update to "four" — a one-line factual correction, no behavior change.

## 4. No change to X (things an implementer would reflexively touch)

- **`packages/app/src/ports.ts` / `ResultRenderContext`** — `canPin` is computed entirely inside
  `InlineBottomSheetRenderer` from its own `pinned` registry (§3.3); it never needs to ride the
  wire or cross a port boundary, so no new port field is added.
- **`packages/app/src/ui/side-panel-view.ts`** — it builds its own `CardState`/`PanelFocusState`
  independently (confirmed by reading `side-panel-view.ts:4,13,191` — it calls the same
  `renderCardState`, but from its own state object, never populating `canPin`). Since
  `renderPinRow` returns `null` whenever `canPin` is `undefined`, the side panel silently never
  shows a pin control — no side-panel code changes at all.
- **`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`** — confirmed by reading
  the file: it posts its own `{state, payload, sentence, url, title}` messages independent of
  `CardState`/`canPin` entirely; untouched.
- **`packages/app/src/ui/bottom-sheet.ts`** — the modal stays exactly as it is today for the live/
  unpinned card; this card adds a sibling component (`floating-pin.ts`) rather than teaching
  `bottom-sheet.ts` a non-modal mode.
- **`packages/app/src/ports.ts`'s `ResultRenderer`/`TriggerUI` interfaces** — unchanged; pinning is
  entirely inside the one `ResultRenderer` implementation that already exists.
- **`packages/extension-chrome/src/content.ts` / `packages/extension-safari/src/content.ts`** — no
  changes (§3.5); both shells already construct the shared renderer and call the shared
  registration function.
- **`manifest.json`** (either shell) — no new permission; this card is pure UI with zero new
  browser APIs.
- **`packages/app/src/domain/*`** — no domain/policy files are touched; there is no new persisted
  shape (the card's own fence: "no persistence").

## 5. Scope fence (from the card, held exactly)

- **Max 3 pinned** — enforced by `MAX_PINNED = 3` in the renderer (§3.3), reflected in the pin
  button's disabled state (§2.4) and independently guarded again inside `pinCurrent()` itself.
- **Floating / draggable** — `<floating-pin>` is `position:fixed` (never shifts page layout,
  matching A6's own future fence for card positioning) and pointer-draggable from its title bar
  (§2.5).
- **Esc closes only the top unpinned card** — achieved structurally: `<bottom-sheet>`'s own
  `Escape` handler (`bottom-sheet.ts:72-79`) is the only Escape handling in this feature area, and
  it only ever wraps the single live/unpinned card; `<floating-pin>` has no keydown handling at
  all, so Escape can never reach a pinned card (§2.8).
- **No persistence** — `<floating-pin>` elements are plain, non-persisted DOM nodes; nothing about
  a pin is written to `chrome.storage`/any `Storage` port keyspace. A reload clears every pin,
  matching the card's explicit "nothing about surviving reloads" fence (§2.8).
- **S1 held** — this card touches no API-key-adjacent code path at all (no wire message, no
  settings, no storage read of the key).
- **S4 held** — pinning re-renders the SAME already-sanitized `state.safeHtml` value produced once
  at `renderResult` time (`this.sanitize(r.markdown)`, unchanged); no new raw-HTML path is
  introduced anywhere in `pinCurrent()` or `floating-pin.ts`.
- **Constraint 4 (no background LLM calls)** — this card makes zero new lookup/LLM calls; pinning
  is pure client-side DOM manipulation. (§2.2 in fact actively _removes_ the one-shot switch-
  provider/force-literal re-lookup triggers from a pinned card, tightening rather than loosening
  this constraint's surface.)
- **Design tokens only** — every new CSS declaration in `floating-pin.ts` and the `.pin-row`/
  `.pin-btn` rules in `lookup-card.ts` reads only `--ad-*`/`--adp-*` custom properties (§3.1/3.2);
  no hard-coded color; `@media (prefers-reduced-motion:reduce)` neutralizes the pin button's own
  hover/border transition, matching every other action button in the file.
- **No new manifest permission** — §4.

## 6. Testing strategy

1. **Unit — `packages/app/test/ui/lookup-card.test.ts`** (new `describe('<lookup-card> — pin
control (A7)', ...)`): `renderCardState` with `canPin` undefined renders no `.pin-row`; `canPin:
true` renders an enabled button with the "Pin this card so it stays open" label; `canPin: false`
   renders a disabled button whose `aria-label` contains "max 3"; `pinned: true` renders a disabled,
   `aria-pressed="true"` "Pinned" badge; clicking the enabled button dispatches a composed `pin`
   event; a `pinned: true` state omits `.save-btn`, `.nudge-row`, and `.defined-as` entirely even
   when `nudge`/`definedAs` are present on the state object.
2. **Unit — `packages/app/test/ui/floating-pin.test.ts`** (new file): the element attaches a shadow
   root containing exactly one `<slot>` and no `[role="dialog"]` (proving it is non-modal); `place()`
   sets `style.left`/`style.top` in pixels; a pointerdown-then-pointermove starting from a `.bar`-
   classed child moves the host by the exact pointer delta; a pointerdown starting from a `<button>`
   inside `.bar` does **not** start a drag (the host's position is unchanged after a subsequent
   move); a pointerdown on any pinned host re-parents it to the end of its parent's children
   (bring-to-front via DOM order); an extreme pointermove is clamped so the host never fully leaves
   the viewport in either axis. (Positions are asserted via `element.style.left/top`, not
   `getBoundingClientRect()` — happy-dom 15.11.7, this repo's vitest environment, does not compute
   real layout and always returns a zero rect regardless of applied styles, confirmed empirically;
   pixel-accurate, real-layout dragging is proven by the e2e spec below instead.)
3. **Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`** (new `describe(
'InlineBottomSheetRenderer — pin cards (A7)', ...)`): `renderResult` sets an enabled pin button
   when fewer than 3 are pinned; clicking Pin removes the `<bottom-sheet>` wrapper, creates a
   `<floating-pin>` containing the moved `<lookup-card>` (same headword), and renders that copy's
   pin button as an inert "Pinned" badge; the pinned copy has no `.save-btn`/`.nudge-row`, and a
   provider badge with no `.prov-switch` even when the original had `providers`/switching enabled; a
   fresh `renderLoading` after pinning creates a brand-new live `<bottom-sheet>` while the pinned
   `<floating-pin>` is untouched; dispatching `close` on a pinned copy removes only that
   `<floating-pin>` (others, and the live slot, are unaffected); pinning 3 cards then rendering a
   4th result yields a disabled pin button and exactly 3 `<floating-pin>` elements; a `theme`
   assignment after pinning re-stamps `data-ad-theme` on every pinned host and its card.
4. **e2e — new `packages/extension-chrome/e2e/a7-pin-cards.spec.ts`**:
   - Pinning detaches the card: after clicking `.pin-btn`, `<bottom-sheet>` has count 0 and
     `<floating-pin>` is visible; pressing `Escape`, clicking elsewhere on the page, and scrolling
     (`page.mouse.wheel`) all leave the pinned card visible (today's modal would have closed on
     any of the three).
   - Dragging the card's title bar (real `page.mouse` down/move/up over the shadow `.bar`'s
     bounding box, read via `page.evaluate`) moves the `<floating-pin>` host by a comparable delta
     (asserted via real `getBoundingClientRect()` before/after — real Chromium, so this is where
     pixel-accurate drag math is actually proven, unlike the happy-dom unit test in item 2).
   - Clicking the pinned copy's Close button (`button[aria-label="Close"]`, unchanged from the
     existing header) removes the `<floating-pin>`.
   - Pinning 3 distinct lookups, then starting a 4th, leaves the 4th's `.pin-btn` disabled with an
     `aria-label` containing "max 3", and exactly 3 `<floating-pin>` elements remain.
   - Navigating to a fresh fixture page after pinning leaves zero `<floating-pin>` elements (pins
     die on page nav, §2.8).

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section lists the suites run, test counts, and e2e scenarios
exercised from §6 above, plus the standard gates (lint, format check, typecheck for both
`packages/app` and `packages/extension-chrome`, the full unit suite, and
`GEMINI_API_KEY= bun run build:chrome` followed by the affected e2e specs). No `pr-assets/*` branch
is created for this card.

## 8. Risk / rollback

- **Risk: low-moderate.** The riskiest new logic is `pinCurrent()`'s move-and-freeze sequencing
  (§3.3) — a bug here could either leave the pinned card still wired to the singleton save/switch
  state (reintroducing the wrong-entry-gets-saved hazard §2.2 exists to prevent) or leave the live
  slot's fields un-cleared (breaking the next Define click). Both are directly covered by the unit
  tests in §6 item 3, which assert on the DOM structure and event wiring, not just visual state.
- **No data migration** — this card introduces no persisted shape at all (§5); nothing to migrate,
  nothing that can be left in a bad state across a rollback.
- **Isolated blast radius** — the only existing files touched are `lookup-card.ts` (additive: new
  optional `CardState` fields, one new pure function, one restructured branch inside
  `renderCardState`) and `inline-bottom-sheet-renderer.ts` (additive: one new field, one new
  method, two small edits to existing methods). Reverting the single PR restores exactly today's
  single-modal-card behavior; no stored data becomes invalid, since none exists.

## 9. Files touched (summary)

| File                                                         | Change                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ui/lookup-card.ts`                         | `CardState` gains `canPin?`/`pinned?`; new `renderPinRow`; `renderCardState`'s result branch gates save/nudge/defined-as on `pinned`; new `.pin-row`/`.pin-btn` CSS |
| `packages/app/src/ui/styles/tokens.ts`                       | new `Z_PINNED_BASE` + `--adp-z-pinned` primitive; new `ICON_PIN`                                                                                                    |
| `packages/app/src/ui/floating-pin.ts`                        | **new** — non-modal draggable host, `<floating-pin>`                                                                                                                |
| `packages/app/src/ui/register.ts`                            | registers `floating-pin`                                                                                                                                            |
| `packages/app/src/ui/index.ts`                               | barrel-exports `floating-pin.ts`                                                                                                                                    |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`       | new `pinned` registry, `pinCurrent()`, `canPin` in `renderResult`, theme propagation to pinned cards                                                                |
| `packages/extension-chrome/src/content-elements.ts`          | comment fix ("three" → "four")                                                                                                                                      |
| `packages/app/test/ui/lookup-card.test.ts`                   | + pin-control tests                                                                                                                                                 |
| `packages/app/test/ui/floating-pin.test.ts`                  | **new** — component tests                                                                                                                                           |
| `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` | + pin-cards tests                                                                                                                                                   |
| `packages/extension-chrome/e2e/a7-pin-cards.spec.ts`         | **new** — functional e2e                                                                                                                                            |

No change to `packages/app/src/ports.ts`, `packages/app/src/ui/bottom-sheet.ts`,
`packages/app/src/ui/side-panel-view.ts`, `packages/extension-chrome/src/adapters/
chrome-side-panel-mirror.ts`, `packages/extension-chrome/src/content.ts`,
`packages/extension-safari/src/content.ts`, or any `manifest.json`.

## 10. Concurrency

Per CONTRACTS §5, the lookup-card UI is already a listed hot file across A1/A2/A3/A5/A7/A10 — this
card touches it, so it must be serialized against whichever of those lands concurrently. Beyond
that pre-listed set, this card's own reading surfaces two additional files worth flagging
explicitly for the orchestrator, since CONTRACTS' table names `lookup-card.ts` but not these:

- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`** — not in CONTRACTS' pre-listed hot-
  file table, but A1 (streamed-answers, repaints the card mid-stream) and A6 (smart-card-placement,
  not yet authored — will change how/where the card is positioned) both plausibly touch this exact
  file too. Serialize A7 against A1 and A6 specifically on this file, not just on `lookup-card.ts`.
- **`packages/app/src/ui/styles/tokens.ts`** — any other in-flight card adding a new canonical icon
  (e.g. A10 tts-pronunciation's speaker icon, B8's export icon) edits the same icon-set region of
  this file; a straightforward textual merge conflict, not a logic conflict, but still worth
  serializing to avoid a painful three-way icon-list merge.
- **`packages/app/src/ui/register.ts` / `packages/app/src/ui/index.ts`** — any other card
  registering a new custom element touches the same two files; same textual-merge-only risk as
  tokens.ts above.

No overlap with the persistence-policy files (`domain/saved-words-policy.ts`,
`domain/history-policy.ts`), the wire/router (`wire.ts`/`router.ts` — this card adds no wire
message), or `settings-form.ts`/the side panel/`docs/index.html`.
