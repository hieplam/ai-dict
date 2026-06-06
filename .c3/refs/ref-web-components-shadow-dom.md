---
id: ref-web-components-shadow-dom
c3-seal: 236701c589635d3c017e002e3e4fe2c2458a06d91f6712a8966341a18510e6bf
title: web-components-shadow-dom
type: ref
goal: 'The in-page UI must render identically inside both extensions and survive arbitrary host-page CSS and a strict extension CSP. The recurring need: isolated, framework-free, CSP-safe components shared by Chrome and Safari.'
---

## Goal

The in-page UI must render identically inside both extensions and survive arbitrary host-page CSS and a strict extension CSP. The recurring need: isolated, framework-free, CSP-safe components shared by Chrome and Safari.

## Choice

**Native custom elements in *open* Shadow DOM**, styled with **Constructable Stylesheets** (`new CSSStyleSheet()` + `replaceSync()` + `adoptedStyleSheets`), registered idempotently. No UI framework.

## Why

Content scripts mount into pages we do not control, under a strict CSP (spec S5) that forbids inline `<style>`. Shadow DOM isolates our DOM/CSS from the page; constructable stylesheets apply styles without violating CSP; *open* mode (not closed) is required so `axe-core` and `@testing-library/dom` can reach the root for the automated a11y tier (spec §5.3 *shadow-mode note*). A framework was rejected for bundle weight and CSP friction; closed shadow was rejected because the test tooling cannot pierce it. Component tests therefore run under **happy-dom**, which implements `CSSStyleSheet.replaceSync()` (jsdom does not).

## How

Literal from `packages/app/src/ui/register.ts` — define once, guarded:

```ts
// REQUIRED: idempotent registration — the content script may run more than once
export function registerContentElements(): void {
  if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
  if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
  if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
}
```

REQUIRED: open shadow root + `adoptedStyleSheets` (see `packages/app/src/ui/styles/adopt.ts`).
