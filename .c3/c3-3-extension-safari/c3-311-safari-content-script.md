---
id: c3-311
c3-seal: a7c27d4b67c3a5b441138e08fdec13bf1bca7ce280501bd8129bc78beb862192
title: safari-content-script
type: component
category: feature
parent: c3-3
goal: 'Wire the Safari content-script composition root: connect DOM selection, the floating trigger, the inline renderer, and relay clients into `runLookupWorkflow` so word-lookup works on any page — with no side panel.'
uses:
    - ref-core-dependency-rule
    - ref-web-components-shadow-dom
---

## Goal

Wire the Safari content-script composition root: connect DOM selection, the floating trigger, the inline renderer, and relay clients into `runLookupWorkflow` so word-lookup works on any page — with no side panel.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-3 (extension-safari) |
| Category | Feature |
| Runtime | content script |
| Public surface | None — module is the entry point content.js; no exported symbols |
| Bundled into | content.js (declared under content_scripts in manifest.json; runs at document_idle) |
| Depends on | runLookupWorkflow (c3-110), DomSelectionSource, InlineBottomSheetRenderer, MessageRelayLookupClient, registerContentElements from @ai-dict/app (c3-115), SafariFloatingTrigger and MessageRelaySettingsStore from c3-301 |
| No side panel | Safari has no side-panel API; InlineBottomSheetRenderer is the only result surface |

## Purpose

Acts as the composition root for the Safari content script. Calls `registerContentElements()` to define the `<lookup-trigger>` and `<lookup-result>` custom elements (shadow DOM) before instantiating any adapter. Then wires five concrete adapters into `runLookupWorkflow`: `DomSelectionSource` for text selection events, `SafariFloatingTrigger` for the floating "Define" button, `InlineBottomSheetRenderer` for in-page result display, `MessageRelayLookupClient` for relaying lookup requests to the service worker, and `MessageRelaySettingsStore` for reading `PublicSettings` (with storage-change cache invalidation). Does NOT open or manage a side panel, does NOT implement any port interface itself, and does NOT read `apiKey` — that is exclusively the service worker's concern.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | registerContentElements() must complete before SafariFloatingTrigger is instantiated (custom element must be defined; call is at top of packages/extension-safari/src/content.ts) | ref-web-components-shadow-dom |
| Core dependency rule | content.ts is the composition root that runs runLookupWorkflow (c3-110); it depends on core ports inward but does not export anything back to core | ref-core-dependency-rule |
| Web components | <lookup-trigger> and <lookup-result> are shadow-DOM custom elements registered by registerContentElements() before use | ref-web-components-shadow-dom |
| Settings relay | MessageRelaySettingsStore subscribes to browser.storage.onChanged for cache invalidation (wired in packages/extension-safari/src/content.ts) so content script reflects settings changes without a reload | c3-301 |
| iOS-only renderer | InlineBottomSheetRenderer(document.body) is the sole result renderer in packages/extension-safari/src/content.ts — there is no side panel on iOS/Safari | c3-3 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | When a user selects text on any page, a floating trigger appears; on click the lookup is relayed to the SW and the result is rendered inline in a bottom sheet card | c3-110 |
| Primary path | DomSelectionSource emits selection → runLookupWorkflow calls SafariFloatingTrigger.show() → user clicks → MessageRelayLookupClient sends lookup.* message to SW → reply rendered by InlineBottomSheetRenderer (see packages/extension-safari/src/content.ts) | c3-110 |
| Settings read path | MessageRelaySettingsStore.get() returns cached PublicSettings; on browser.storage.onChanged cache clears and next get() re-fetches from SW (see packages/extension-safari/src/adapters/message-relay-settings-store.ts) | c3-301 |
| Alternate path (no key) | If hasKey is false, runLookupWorkflow surfaces a no-key state via the renderer without sending a network request | c3-110 |
| Failure behavior | Network or SW errors are returned as typed WireReply error objects; InlineBottomSheetRenderer displays the error; no crash in the content script | c3-115 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | content.ts as composition root depends on core workflow and port implementations; nothing in core depends back on content.ts | High | One-directional dependency enforced by package boundaries |
| c3-115 | example | DomSelectionSource, InlineBottomSheetRenderer, MessageRelayLookupClient, registerContentElements are all owned by content-adapters (c3-115) | High | content.ts consumes c3-115 adapters; does not re-implement them |
| ref-web-components-shadow-dom | ref | registerContentElements() must be called before any adapter that mounts <lookup-trigger> or <lookup-result> | High | Shadow DOM isolation prevents host-page CSS from leaking into extension UI |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runLookupWorkflow({selection, trigger, renderer, client, settings}) call | OUT | Starts the end-to-end lookup lifecycle with the five injected port implementations | Content-script-to-core boundary | packages/extension-safari/src/content.ts |
| browser.storage.onChanged subscription | IN | MessageRelaySettingsStore cache invalidation callback wired at construction time; fires on any storage area change | Safari WebExtension runtime boundary | packages/extension-safari/src/content.ts |
| browser.runtime (via MessageRelayLookupClient and MessageRelaySettingsStore) | OUT | sendMessage used to relay lookup.* and settings.get messages to the service worker | Safari WebExtension runtime boundary | packages/extension-safari/src/content.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| registerContentElements() removed or called after adapter instantiation | Refactoring import order in content.ts | SafariFloatingTrigger.show() creates an unknown element; no shadow root — runtime TypeError | bun run --filter @ai-dict/extension-safari test |
| Side-panel renderer added, breaking iOS layout | Adding a SidePanelRenderer branch | Safari has no sidePanel API; runtime error on browser.sidePanel access | bun run --filter @ai-dict/extension-safari typecheck |
| MessageRelaySettingsStore constructed without storage-change subscription | Removing the browser.storage.onChanged wire | Settings become stale after options-page save; detectable by relay store test | bun run --filter @ai-dict/extension-safari test packages/extension-safari/src/adapters/message-relay-settings-store.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| content.js bundled output | Business Flow | Tree-shaking of unused workflow branches is permitted | packages/extension-safari/src/manifest.json |
| SafariFloatingTrigger adapter | Contract | No variance — TriggerUI interface is the contract | packages/extension-safari/src/adapters/safari-floating-trigger.ts |
| MessageRelaySettingsStore adapter | Contract | set() must always reject (content side never writes settings) | packages/extension-safari/src/adapters/message-relay-settings-store.ts |
