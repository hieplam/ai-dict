---
id: c3-211
c3-seal: 02e8802a1d8724801b0ec4a684ad6070b7f7cd8b97f28fc715df519eea366980
title: chrome-content-script
type: component
category: feature
parent: c3-2
goal: Wire the full lookup workflow inside every page the user visits, using Chrome-specific adapters for trigger, rendering, messaging, and settings.
uses:
    - ref-core-dependency-rule
    - ref-web-components-shadow-dom
---

## Goal

Wire the full lookup workflow inside every page the user visits, using Chrome-specific adapters for trigger, rendering, messaging, and settings.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-2 (extension-chrome) |
| Category | Feature |
| Runtime | content script |
| Public surface | N.A - content.ts and content-elements.ts are entry points; they export no symbols |
| Bundled into | content.js (isolated world) and content-elements.js (MAIN world), per manifest.json content_scripts |
| Depends on | runLookupWorkflow (c3-110), DomSelectionSource, InlineBottomSheetRenderer, MessageRelayLookupClient from @ai-dict/app; ChromeFloatingTrigger, MessageRelaySettingsStore, ChromeSidePanelMirror from c3-201 |
| Injects into | Every page matched by <all_urls> at document_idle |

## Purpose

`content.ts` is the composition root for the content-script world. It constructs `DomSelectionSource`, `ChromeFloatingTrigger`, a composite `ResultRenderer` (fan-out to `InlineBottomSheetRenderer` + `ChromeSidePanelMirror`), `MessageRelayLookupClient`, and `MessageRelaySettingsStore`, then passes them all to `runLookupWorkflow` (`c3-110`). This single call is the entire content-side setup; no further orchestration is needed. `content-elements.ts` is a separate bundle entry that runs in the MAIN world and calls `registerContentElements()` once — this makes the three custom elements (`<lookup-trigger>`, `<lookup-card>`, etc.) available to the page's `CustomElementRegistry` before the isolated-world `content.js` runs, avoiding a null-registry crash. The two scripts share the same element instances through the DOM: `content.ts` does NOT re-import `registerContentElements`. This component does NOT read the `apiKey`, does NOT write settings, and does NOT communicate directly with the Gemini API — all of that is proxied through the SW via the message relay adapters.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Page DOM is ready (document_idle); SW is alive and responding to lookup.* and settings.get messages; declared in packages/extension-chrome/src/manifest.json lines 10-18 | c3-210 |
| MAIN-world precondition | content-elements.js has run first, calling registerContentElements() so customElements.define(...) succeeds in the page registry | ref-web-components-shadow-dom |
| Input — selection | DomSelectionSource listens for selectionchange events on document; wired in packages/extension-chrome/src/content.ts line 18 | c3-115 |
| Input — trigger | ChromeFloatingTrigger() constructed with default host (document.body); wired in packages/extension-chrome/src/content.ts line 19 | c3-201 |
| Input — settings | MessageRelaySettingsStore(chrome.runtime) fetches PublicSettings from SW; apiKey is never received in the content script | rule-api-key-isolation |
| Shared dependency — runtime | chrome.runtime passed directly to MessageRelayLookupClient and ChromeSidePanelMirror; see packages/extension-chrome/src/content.ts lines 14, 37 | c3-201 |
| Custom element registry | Shared via the page DOM between MAIN world (content-elements.ts) and isolated world (content.ts); not re-registered in isolated world per comment in packages/extension-chrome/src/content.ts lines 7-8 | ref-web-components-shadow-dom |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User selects text on any page, a "Define" bubble appears, and clicking it triggers a lookup whose result appears both inline and in the side panel | c3-110 |
| Primary path | DomSelectionSource fires → ChromeFloatingTrigger.show() → user clicks → runLookupWorkflow calls MessageRelayLookupClient → SW processes → composite renderer calls InlineBottomSheetRenderer and ChromeSidePanelMirror simultaneously; wired in packages/extension-chrome/src/content.ts lines 16-38 | c3-110 |
| Renderer fan-out | The inline renderer object passed to runLookupWorkflow delegates each method to both inline and mirror so both surfaces update in sync; see packages/extension-chrome/src/content.ts lines 19-35 | c3-201 |
| Alternate path — side panel closed | ChromeSidePanelMirror.post() swallows the rejected sendMessage; inline card still renders normally | c3-201 |
| Failure — SW unreachable | MessageRelayLookupClient or MessageRelaySettingsStore rejects; runLookupWorkflow calls renderer.renderError(...) | c3-110 |
| Isolation boundary | content.ts runs in the isolated world — it has access to chrome.* APIs but not to the page's JS globals; element registry is bridged via the DOM only | ref-web-components-shadow-dom |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | content.ts is a composition root for c3-110; it may depend on adapters (c3-201) and app exports, but nothing in packages/app/src/domain/** may import from content.ts | Primary | One-directional dependency enforced at the package boundary |
| ref-web-components-shadow-dom | ref | Custom elements must be registered in the MAIN world (content-elements.ts) to avoid null customElements in the isolated world | Primary | content.ts explicitly avoids re-importing registerContentElements (comment lines 7-8) |
| c3-115 | example | MessageRelayLookupClient and MessageRelaySettingsStore are the content-side adapters for lookup and settings that this composition root wires | Informational | Both are defined in packages/app/src/adapters/ not in the chrome package |
| c3-110 | example | runLookupWorkflow is the single call that drives the entire content-side pipeline; this component is its Chrome composition root | Primary | content.ts has no other domain logic |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runLookupWorkflow(...) call | OUT | Receives all five port implementations; owns the full lookup lifecycle after this call | packages/app/src/lookup-workflow.ts | packages/extension-chrome/src/content.ts |
| registerContentElements() call in content-elements.ts | OUT | Registers custom elements once in MAIN world before content.js runs | packages/app export | packages/extension-chrome/src/content-elements.ts |
| chrome.runtime (as RuntimeLike) | IN | Passed to MessageRelayLookupClient and ChromeSidePanelMirror for all SW messaging | Chrome content-script boundary | packages/extension-chrome/src/content.ts |
| Composite ResultRenderer inline object | IN/OUT | Fan-out object satisfying ResultRenderer port; delegates each method to InlineBottomSheetRenderer and ChromeSidePanelMirror | packages/app/src/ports.ts → ResultRenderer | packages/extension-chrome/src/content.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Custom elements not available in isolated world | Re-importing or calling registerContentElements() from content.ts, or removing content-elements.ts from manifest | <lookup-trigger> is undefined; floating trigger fails to mount | bun run --filter @ai-dict/extension-chrome e2e |
| Renderer fan-out drops a surface | Removing inline.* or mirror.* calls from the composite renderer | One surface stops updating; no compile error caught at build time | packages/extension-chrome/test/manifest.test.ts |
| MessageRelaySettingsStore replaced with a store that exposes apiKey | Swapping the settings adapter in the composition | rule-api-key-isolation violated; apiKey present in content-script scope | bun run --filter @ai-dict/extension-chrome typecheck |
| content.ts world changed from isolated to MAIN | Editing manifest content_scripts entry for content.js | chrome.* APIs unavailable in MAIN world; extension crashes | bun run --filter @ai-dict/extension-chrome test |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| content.js bundle | Business Flow | N.A - must remain in isolated world; no alternate entry | packages/extension-chrome/src/manifest.json |
| content-elements.js bundle | Business Flow | N.A - must declare world: MAIN; no alternate world is valid | packages/extension-chrome/src/manifest.json |
| E2E coverage | Contract | Test may use a mock SW to simulate the relay | bun run --filter @ai-dict/extension-chrome e2e |
