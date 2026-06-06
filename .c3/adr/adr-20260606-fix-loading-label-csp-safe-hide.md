---
id: adr-20260606-fix-loading-label-csp-safe-hide
c3-seal: 8b5963c8c68f2e45cd0dc7251349ced27bec8000f08299ce20055dd67b29521d
title: fix-loading-label-csp-safe-hide
type: adr
goal: Change how the lookup card's loading state hides its "Looking up…" screen-reader label so the label stays hidden under a strict `style-src 'self'` Content-Security-Policy. Today the label is hidden with an inline `style` attribute and nested inside the rotating ring; this ADR authorizes hiding it with a CSS class (`::slotted(.sr-only)` in the card's adopted stylesheet) and making it a sibling of the ring, so the hidden text can never become visible or rotate on extension pages (the Chrome side panel) or strict-CSP websites.
status: implemented
date: "2026-06-06"
---

## Goal

Change how the lookup card's loading state hides its "Looking up…" screen-reader label so the label stays hidden under a strict `style-src 'self'` Content-Security-Policy. Today the label is hidden with an inline `style` attribute and nested inside the rotating ring; this ADR authorizes hiding it with a CSS class (`::slotted(.sr-only)` in the card's adopted stylesheet) and making it a sibling of the ring, so the hidden text can never become visible or rotate on extension pages (the Chrome side panel) or strict-CSP websites.

## Context

`renderCardState({kind:'loading'})` in `packages/app/src/ui/lookup-card.ts` (component c3-117 ui-components) renders a `.spinner` ring with a visually-hidden `<span>"Looking up…"` appended as its child, hidden via `setAttribute('style', '…clip…')`. On the Chrome side panel — an extension page whose manifest CSP is `style-src 'self'` (no `'unsafe-inline'`) — Chrome blocks the inline `style` attribute, so the label is not hidden, and being a child of the ring (`animation:spin`) the visible "Looking up…" text rotates with the ring. Verified in a real browser: the label computes to `position:static;width:auto`, renders ~51×38px, and rotates. Constraint: the card's content lives in light DOM projected through a `<slot>` across the Chrome MV3 world boundary, so it must be styled from the card's adopted (constructable) stylesheet via `::slotted()`, not via document-level or inline styles. Affected topology: c3-117 only; the bottom sheet and the side panel both consume the same `renderCardState`, so one fix covers both.

## Decision

Make the label a sibling of the ring (`return [ring, label]`) and hide it with `class="sr-only"`, adding a `::slotted(.sr-only)` rule to the card's adopted CSS. Constructable stylesheets are exempt from `style-src`, so the hiding applies on extension pages; the sibling structure means the label cannot rotate regardless of any styling outcome. This mirrors the existing `.sr-only` pattern in `bottom-sheet.ts` and the `::slotted()` styling already used for `.spinner`. It is one change to shared code, so it fixes the side panel and the bottom sheet together with no workflow or per-surface change.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | Owns lookup-card.ts and renderCardState, whose loading branch is changed | Confirm the renderCardState(state):Node[] contract and the loading-state textContent invariant are preserved; re-run the card test suite |
| c3-1 | container | Parent container of c3-117 | No-delta: components, responsibilities, and boundary unchanged (implementation-only fix) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | The fix depends on the shadow-DOM + adopted-stylesheet + ::slotted() model this ref governs; CSP-exempt constructable styles are the mechanism | comply — no ref change; the fix follows the ref's golden pattern |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-sanitize-model-output | Governs the card's result branch (innerHTML = SafeHtml); review must confirm this change touches only the loading branch and alters no innerHTML/SafeHtml path | review — confirmed not implicated (loading renders only a static label and a decorative ring) |
| rule-api-key-isolation | Governs the ui-components boundary; review must confirm the change introduces no API key, port, or wire-message access | review — confirmed not implicated (UI-only DOM/CSS change) |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Code | lookup-card.ts: loading branch returns [ring, label]; label uses class 'sr-only' (no inline style); add ::slotted(.sr-only) rule to the card CSS | packages/app/src/ui/lookup-card.ts |
| Test | lookup-card.test.ts: assert the label is not inside .spinner, has no style attribute, has class sr-only, and the adopted CSS defines ::slotted(.sr-only); keep existing loading/textContent/keyframes assertions green | packages/app/test/ui/lookup-card.test.ts |
| Verify | Browser before/after on the side panel loading state; full app test suite | bun run --filter '@ai-dict/app' test |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI command, validator, schema row, hint, template, or test is changed by this code fix | N.A | c3x check reports 0 issues before and after the change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| lookup-card.test.ts | Fails if the label regains an inline style attribute or becomes a descendant of .spinner | packages/app/test/ui/lookup-card.test.ts |
| Browser side-panel check | Loading label must be hidden (not visible, not rotating) under style-src 'self' | agent-browser eval probe + screenshot |
| c3x check | Catches documentation drift for c3-117 | C3X_MODE=agent c3x check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hide via individual el.style.x= properties, keep the label as a ring child | CSP-safety of per-property CSSOM writes under style-src 'self' is uncertain in Chrome, and the label would still be a child of the rotating ring — a latent rotation bug if hiding ever fails |
| Move the label into the card's shadow DOM | The card's state is driven cross-world by writing light DOM (Chromium 390807); a shadow-only label cannot be updated by the isolated-world renderer, breaking the loading announcement |
| Inject an .sr-only rule into the document via a <style> (like ensureDocKeyframes) | Adds a second styling path and another document-level injection; ::slotted() from the card's existing adopted stylesheet is the established, self-contained pattern |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| ::slotted(.sr-only) fails to hide the label (selector/scope error) | Reuse the ::slotted() mechanism already proven for .spinner; check computed style in a real browser | agent-browser eval: label VISIBLE=false on the side panel |
| Loading announcement regresses (aria-live no longer reads the label) | Keep the label in the card's light DOM inside the aria-live region; only its parent (card vs ring) changes | lookup-card.test.ts textContent assertion + axe loading-state test stay green |
| Sibling label shifts the loading layout | Label is visually hidden (1px, absolutely positioned), so it occupies no layout box | Before/after screenshot of the side panel loading state |

## Verification

| Check | Result |
| --- | --- |
| bun run --filter '@ai-dict/app' test | All app tests pass, including the new lookup-card loading assertions |
| C3X_MODE=agent c3x check | 0 issues (no doc drift for c3-117) |
| agent-browser side-panel loading probe (after fix) | label VISIBLE=false, ROTATES_WITH_RING=false, ring still animates |
