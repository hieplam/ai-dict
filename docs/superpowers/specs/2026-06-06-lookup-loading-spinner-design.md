# Lookup loading spinner

Date: 2026-06-06
Status: approved

## Goal

Show a CSS-only loading spinner after the user clicks the **Define** bubble, in
**two** places that cover the full wait:

1. **On the Define bubble** — during the brief gap between click and the card
   appearing (while settings load).
2. **In the result card** — replacing the plain `"Looking up…"` text while the
   lookup API call runs.

Style: pure CSS rotating ring (no assets, no deps), works inside shadow DOM.

## Current flow (before)

1. Select text → `trigger.show()` renders `<lookup-trigger>` ("Define" button).
2. Click Define → onClick callback calls `trigger.hide()` **immediately**, then
   `runLookup(e)`.
3. `runLookup` awaits `settings.get()`, then `renderer.renderLoading()` → card
   shows `{kind:'loading'}` → renders text node `"Looking up…"`.
4. Result/error replaces the card content.

The bubble vanishes the instant it is clicked, so there is no room today for a
bubble spinner; and the card's loading state is text, not an icon.

## Changes

### 1. `packages/app/src/ui/lookup-trigger.ts`
On click, swap the button label for a CSS ring spinner and set `disabled` +
`aria-busy="true"`, **then** dispatch `lookup-click` (as today). Add
`@keyframes` + a `.spinner` rule to the host's adopted CSS. Self-contained in the
element — no port change.

### 2. `packages/app/src/ui/lookup-card.ts`
`renderCardState({kind:'loading'})` returns a spinner node
(`<div class="spinner" role="status">`) plus a visually-hidden `"Looking up…"`
span (keeps screen-reader text and the existing `el.textContent` contract). Add
`@keyframes spin` and `::slotted(.spinner)` rules to the card's adopted CSS.
The live region is already `aria-live="polite"`.

### 3. `packages/app/src/domain/workflow.ts`
Move `deps.trigger.hide()` out of the onClick callback into `runLookup`, called
**once** right after `settings.get()` resolves (before both the no-key error
branch and `renderLoading()`). The bubble's spinner now stays visible during the
settings-load gap, then the card takes over.

## Behavioural contract / test constraints (must stay green)

- `workflow.test.ts` happy path: `renderer.calls === ['loading','result']` and
  `trigger.hidden === 1`. Moving hide() to after `settings.get()` keeps both
  (hide once, before renderLoading).
- `workflow.test.ts` NO_KEY: still no `'loading'` call; `lastReq` null. hide()
  runs before the branch — bubble still gets dismissed.
- `workflow.test.ts` teardown: hide() called again on teardown (count increases).
- `lookup-card.test.ts`: default loading content — `el.textContent` still
  contains `"Looking up"` (via the visually-hidden span). Axe clean in loading
  state (spinner has `role="status"` + accessible name).

## New tests (TDD, write first → red → green)

- **lookup-trigger**: clicking the button sets `disabled`/`aria-busy` and renders
  a `.spinner` in the shadow, while still emitting `lookup-click`.
- **lookup-card**: `renderCardState({kind:'loading'})` returns a node with
  `class="spinner"` + `role="status"`; accessible text still contains
  `"Looking up"`; adopted CSS defines `@keyframes spin`.
- **workflow**: after `trigger.click()` the trigger is **not** hidden
  synchronously (`trigger.hidden === 0` immediately), and becomes hidden
  (`=== 1`) once the lookup resolves — proves hide() moved out of the sync
  onClick path.

## Out of scope

No new ports, no spinner duration/min-display logic, no theming, no changes to
Safari/Chrome adapters (the element + workflow changes are shared via
`@ai-dict/app`).
