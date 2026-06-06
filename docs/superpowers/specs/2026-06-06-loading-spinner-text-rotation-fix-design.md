# Fix: loading spinner's hidden label becomes visible and rotates on extension pages

Date: 2026-06-06
Status: approved

## Problem

On the **Chrome side panel**, the lookup card's loading state shows the ring spinner
**and** the words "Looking up…" — and the text rotates along with the ring. The
"Looking up…" label is meant to be a screen-reader-only, visually-hidden string.

Verified in a real browser (built extension, side panel page). The label computes to
`position:static; width:auto; clip:auto` and renders at ~51×38px (fully visible),
while sitting **inside** the rotating `.spinner` element.

## Root cause

In `packages/app/src/ui/lookup-card.ts`, `renderCardState({kind:'loading'})` builds the
label two ways that combine into the bug:

1. **Hidden via an inline `style` attribute** (`label.setAttribute('style', '…clip…')`).
2. **Appended as a child of the rotating ring** (`ring.append(label)`).

The side panel is an **extension page**, whose manifest CSP is
`style-src 'self'` (no `'unsafe-inline'`). Chrome therefore **blocks the inline `style`
attribute**, so the visually-hidden styling never applies → the text is visible → and
because the label is a child of the ring (which has `animation:spin`), the visible text
rotates with it.

This only surfaces on strict-CSP surfaces: the extension's own pages (side panel) and
strict-CSP websites. Normal pages allow inline styles, so the label stays hidden there —
which is why PR #8's tests (jsdom, no CSP) and casual testing on ordinary pages missed it.

## Fix

A single change to the shared `renderCardState({kind:'loading'})`, mirroring the
CSP-safe `.sr-only` pattern already used in `bottom-sheet.ts`:

1. Make the label a **sibling** of the ring, not a child — return `[ring, label]`. It can
   never rotate, independent of any styling outcome.
2. Hide it with a **class** (`sr-only`) instead of an inline `style` attribute, styled via
   `::slotted(.sr-only)` in the card's **adopted (constructable) stylesheet**. Constructable
   stylesheets are not subject to `style-src`, so the hiding works on extension pages too.

```js
// loading branch
const ring = document.createElement('div');
ring.className = 'spinner';
const label = document.createElement('span');
label.className = 'sr-only';          // was: inline style attribute
label.textContent = 'Looking up…';
return [ring, label];                 // was: ring.append(label); return [ring]
```

```css
/* added to the card's adopted CSS */
::slotted(.sr-only){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
```

Both `.spinner` and `.sr-only` are now top-level slotted nodes, so both `::slotted(...)`
rules match.

### Why this covers both asks

The side panel and the bottom sheet both render loading through the *same*
`renderCardState`. Fixing it once corrects the spinner on **both** surfaces (and on
strict-CSP websites). No workflow or per-surface change is needed.

## Accessibility

Unchanged. The label text is still "Looking up…", still present in the card's
`aria-live="polite"` region, so the loading→result transition is still announced. The
spinner itself remains decorative (no `role`), as designed in PR #8.

## Tests (TDD — write first, red → green)

In `packages/app/test/ui/lookup-card.test.ts`, add to the loading-state coverage:

- The label is **not** a descendant of the `.spinner` element (no shared rotation).
- The label carries **no inline `style` attribute** (the CSP-fragile mechanism is gone).
- The label has class `sr-only`; the card's adopted CSS defines a `::slotted(.sr-only)`
  rule (the CSP-safe hiding mechanism is present).
- Existing guarantees stay green: loading content still has a `.spinner`, the card's
  `textContent` still contains "Looking up", and `@keyframes spin` is still defined.

Note: jsdom does not enforce CSP, so the tests assert the **structure** (sibling + class,
no inline style) that makes the rendering CSP-robust, not CSP enforcement itself. The
CSP behaviour is confirmed by the before/after browser check on the side panel.

## Scope

- **In:** `packages/app/src/ui/lookup-card.ts` (loading branch + one CSS rule) and its test.
- **Out:** the Define-bubble spinner (`lookup-trigger.ts`) — it lives in shadow DOM with no
  inline style and no child label, so it is unaffected; no workflow changes; no restyle of
  the spinner's size/colour; no new ports.
