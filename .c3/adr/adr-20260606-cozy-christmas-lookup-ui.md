---
id: adr-20260606-cozy-christmas-lookup-ui
c3-seal: fdcef7aa64643575030a2bc2b064f29a7d76df8e023aed3415dd46c7c51c3cfe
title: cozy-christmas-lookup-ui
type: adr
goal: 'Replace the placeholder browser-default styling of the in-page lookup UI (`<lookup-card>`, `<lookup-trigger>`, and the `<bottom-sheet>` container in `packages/app/src/ui`) with a deliberate "cozy Christmas" visual identity: a shared warm OKLCH token palette (honey-amber signature, mulled-wine red + pine-green festive accents), adaptive light/dark via `prefers-color-scheme`, a serif headword, a small geometric holly mark, a soft candlelight glow, and a "stays on your device" footer — delivered entirely through the existing constructable-stylesheet (CSP-safe) mechanism, with no change to any component''s public contract, cross-world rendering, or accessibility behavior.'
status: implemented
date: "2026-06-06"
---

## Goal

Replace the placeholder browser-default styling of the in-page lookup UI (`<lookup-card>`, `<lookup-trigger>`, and the `<bottom-sheet>` container in `packages/app/src/ui`) with a deliberate "cozy Christmas" visual identity: a shared warm OKLCH token palette (honey-amber signature, mulled-wine red + pine-green festive accents), adaptive light/dark via `prefers-color-scheme`, a serif headword, a small geometric holly mark, a soft candlelight glow, and a "stays on your device" footer — delivered entirely through the existing constructable-stylesheet (CSP-safe) mechanism, with no change to any component's public contract, cross-world rendering, or accessibility behavior.

## Context

The three in-page UI elements currently render with minimal, browser-default CSS (system-ui; Google tokens `#202124` / `#1a73e8` / `#b00020`; plain bordered buttons). The merged PRODUCT.md sets a "distinct, trustworthy, focused" brand, and the user confirmed the visual direction in a shape session: warm, cozy, coffee-shop / learning mood, tasteful Christmas accents, adaptive to the host page, easy on the eyes for prolonged reading. Constraints from the design spec and c3-117: strict extension CSP (`style-src 'self'` → adopted stylesheets only, no inline `<style>`, no external font CDN); open Shadow DOM; the result body is freeform sanitized markdown placed in LIGHT DOM and projected through a `<slot>` (Chromium MV3 world boundary 390807), so shadow CSS can style only the chrome, top-level slotted nodes (`::slotted(h2 / .err / .spinner)`), and inherited font/color — not the markdown internals. Affected topology: component c3-117 (ui-components) under container c3-1 (app).

## Decision

Add a shared, selector-less CSS token string (`packages/app/src/ui/styles/tokens.ts` exporting `LIGHT_VARS` / `DARK_VARS` and a `HOLLY_SVG` markup constant) and concatenate it into each component's single adopted stylesheet, preserving `adoptedStyleSheets.length === 1`. Each component keeps its own top-level `:host` rule (so the trigger's `:host` z-index pin stays the first `:host` rule the regression test finds) and applies dark values via a nested `@media (prefers-color-scheme: dark){ :host{ … } }` block, which keeps top-level `cssRules` scans unaffected. Style the chrome, the `::slotted` top-level nodes, and inherited font/color; render the holly as clean geometric inline SVG (CSP-safe markup, not a banned sketchy/feTurbulence SVG). Give the card a complete cozy surface and neutralize the bottom-sheet panel so the card is the single visible surface (avoids nested-card). renderCardState's light-DOM output, the SafeHtml brand, event names + `composed: true`, ARIA, focus-trap, and `@keyframes spin` are all untouched.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | Restyles lookup-card, lookup-trigger, bottom-sheet and adds styles/tokens.ts; public contract (SafeHtml, renderCardState, events, register fns) is unchanged | Parent Delta: confirm Goal / Contract / Code references unchanged (visual-only); review ref-web-components-shadow-dom compliance for the touched files |
| c3-1 | container | Owns c3-117; gains one new presentational file under packages/app/src/ui/styles | Confirm Components + Responsibilities still accurate (no new public surface, no new dependency) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | The change touches every in-page component's shadow-DOM styling and the CSP-safe adopted-stylesheet mechanism this ref governs | comply — keep open shadow + adoptStyles single sheet + light-DOM slot projection + cross-world renderCardState |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-sanitize-model-output | The card renders Gemini markdown; a restyle must not change how sanitized HTML reaches the DOM | comply — renderCardState result branch still writes only SafeHtml into body.innerHTML; no new unsanitized path is introduced |
| rule-api-key-isolation | c3-117 cites this rule (it governs settings-form), so the change must be reviewed to confirm it introduces no new key-exposure path | review — confirmed not engaged: lookup-card, lookup-trigger, and bottom-sheet never read the key or touch settings-form, the service worker, or the wire |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| tokens | Add packages/app/src/ui/styles/tokens.ts exporting LIGHT_VARS / DARK_VARS (warm OKLCH) and HOLLY_SVG | new file |
| lookup-card | Rewrite adopted CSS (cozy surface, candle glow, ::slotted(h2) serif headword, warm body, holly brand row, footer) keeping the bar's [data-act] buttons, aria-live region + slot, ::slotted(.err / .spinner), and @keyframes spin | packages/app/src/ui/lookup-card.ts |
| lookup-trigger | Cozy warm pill + holly; keep :host{all:initial;z-index:2147483647;color-scheme}, an explicit button color, the click→disabled+spinner behavior, and aria-label | packages/app/src/ui/lookup-trigger.ts |
| bottom-sheet | Neutralize the panel (transparent, drop the white bg + radius) so the card surface shows; warm scrim; keep role=dialog, focus-trap, Escape, reduced-motion | packages/app/src/ui/bottom-sheet.ts |
| verify | Bundle a harness that mounts the real components and agent-browser screenshot the card (loading / result / error, light + dark) | /tmp harness render |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI, validator, schema, template, hint, or C3-test surface changes; this is application-code (visual) only | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run --filter @ai-dict/app test | Component + a11y tests pin structure (light-DOM render, [data-act] buttons, .err/.spinner, aria-live), the trigger CSS regression guards (:host z-index, explicit button color), and axe roles/aria/names | packages/app/test/ui/*.test.ts |
| bun run --filter @ai-dict/app typecheck | SafeHtml brand and exported types stay intact | tsc --noEmit |
| bun run lint && bun run format:check | ESLint + Prettier CI gates | CI workflow |
| agent-browser screenshot | The real rendered card matches the cozy-Christmas direction in light and dark | harness render artifact |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Inline style="" on rendered light-DOM nodes to deep-style markdown | Blocked by strict CSP (style-src 'self') on strict host pages and extension pages; defeats the adopted-stylesheet design |
| Parse markdown into typed sections and render structured light-DOM nodes | Fights the deliberate freeform user-editable-template design and is fragile for custom templates; out of scope for a visual pass |
| Bundle a custom web font for the headword | Adds bundle weight against the size budget and contradicts the no-external-font CSP posture; Georgia (system serif) gives the bookish feel for free |
| Adopt a second token stylesheet alongside each component sheet | Breaks the adoptedStyleSheets.length === 1 regression assertion and the first-:host-rule ordering the trigger z-index test relies on |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Trigger z-index / colour regression (occlusion or invisible label) | Keep :host{all:initial;z-index:2147483647} as the first :host rule and an explicit button{color:…} | lookup-trigger.test.ts ':host pins a high z-index' and 'declares an explicit text color' pass |
| Cross-world render regression (stuck on "Looking up…") | renderCardState still returns light-DOM nodes; the result is never rendered into shadow | lookup-card.test.ts 'renders content written straight to light DOM' passes |
| Contrast below WCAG AA in the warm palette | Hand-tune OKLCH lightness for ≥4.5:1 body text / ≥3:1 UI; verify in a real browser (axe cannot compute contrast under happy-dom) | agent-browser screenshot review + manual contrast check |
| Adopted-sheet count or @keyframes drift breaks tests | One concatenated sheet per root; keep a top-level @keyframes spin in the card and trigger | lookup-card.test.ts '@keyframes' + adopted-sheet assertions pass |

## Verification

| Check | Result |
| --- | --- |
| bun run --filter @ai-dict/app test | all app UI + a11y tests green |
| bun run --filter '*' typecheck | no type errors |
| bun run lint && bun run format:check | clean |
| bun run build:chrome | dist builds within bundle budget |
| agent-browser screenshot (light + dark, 3 states) | matches the approved cozy-Christmas direction |
| c3 check | 0 issues; Parent Delta recorded; ADR → implemented |
