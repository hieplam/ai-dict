---
id: c3-312
c3-seal: ecbedb3e4c0bb9752a66a89784ff13d48bd6bd7a0eb718c69ffc755fc24783d1
title: safari-options-page
type: component
category: feature
parent: c3-3
goal: Provide the trusted Safari extension page where the user enters and saves their Gemini API key and adjusts settings directly into `browser.storage.local`.
uses:
    - rule-api-key-isolation
---

## Goal

Provide the trusted Safari extension page where the user enters and saves their Gemini API key and adjusts settings directly into `browser.storage.local`.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-3 (extension-safari) |
| Category | Feature |
| Runtime | extension page |
| Public surface | None — module is the entry point options.js loaded by options.html; no exported symbols |
| Bundled into | options.js loaded by options.html (registered as "options_page" in manifest.json) |
| Hosts web component | <settings-form> registered by registerSettingsForm() from c3-117 |
| Depends on | registerSettingsForm, DEFAULT_TEMPLATE, Settings type from @ai-dict/app (c3-117); browser.storage.local and browser.runtime.sendMessage |

## Purpose

Owns the settings page lifecycle in the trusted extension-page context where direct writes to `browser.storage.local` are permitted. Calls `registerSettingsForm()` to define the `<settings-form>` custom element, loads current `Settings` (including `apiKey`) from storage and hydrates the form's `value` property, then listens for four form events: `save` (merges patch into stored settings), `clear-cache` (relays `cache.clear` message to SW), `clear-history` (relays `history.clear` to SW), and `test-connection` (relays `connection.test` to SW). Writing `apiKey` directly to storage here is the intended and only permitted write path for the key. Does NOT relay settings writes over the content-script wire — that path is intentionally broken in `MessageRelaySettingsStore.set()`.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Trusted context | Extension pages run in the extension origin; browser.storage.local writes are permitted and not proxied through the SW (enforced by packages/extension-safari/src/options.ts) | rule-api-key-isolation |
| Form registration | registerSettingsForm() defines <settings-form> as a custom element (shadow DOM) before the form element is queried from the DOM | c3-117 |
| Initial hydration | load() in packages/extension-safari/src/options.ts reads {settings} from browser.storage.local; falls back to DEFAULTS (including apiKey: '') on first run; assigns to form.value | rule-api-key-isolation |
| Event-driven updates | Form fires save CustomEvent with Partial<Settings> detail; handler in packages/extension-safari/src/options.ts reads current stored settings, merges patch, and writes back atomically | c3-117 |
| SW message relay | clear-cache, clear-history, test-connection events forward typed messages to the SW via browser.runtime.sendMessage — storage is not touched for these operations | c3-310 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User can enter a Gemini API key, change target language and prompt template, and clear cache or history; changes persist to browser.storage.local immediately | rule-api-key-isolation |
| Primary path (save) | User submits form → save event fires → load() re-reads current settings → merged object written via browser.storage.local.set({settings: {...cur, ...next}}) (see packages/extension-safari/src/options.ts) | rule-api-key-isolation |
| Primary path (key entry) | apiKey is part of Settings; <settings-form> collects it and fires it in the save event detail; it is written directly to storage in this trusted context (see packages/extension-safari/src/options.ts) | rule-api-key-isolation |
| Alternate path (clear ops) | clear-cache / clear-history / test-connection events send messages to SW via browser.runtime.sendMessage; options page does not wait for or display the SW reply | c3-310 |
| Failure behavior | load() promise rejection leaves form at empty defaults; browser.runtime.sendMessage failures for clear/test ops are silently swallowed via void (see packages/extension-safari/src/options.ts) | c3-310 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-api-key-isolation | rule | apiKey is written only here (trusted extension page) — never over the content-script message wire | Critical | MessageRelaySettingsStore.set() explicitly rejects to enforce the complementary side of this rule |
| c3-117 | example | <settings-form> is owned by ui-components (c3-117); registerSettingsForm() must be called before the element is used | High | Options page is a consumer of c3-117, not a reimplementation |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <settings-form> element (form.value = s) | IN | Hydrated with full Settings object (including apiKey) at page load | Extension-page DOM boundary | packages/extension-safari/src/options.ts |
| save event (CustomEvent<Partial<Settings>>) | IN | Fires when user submits form; event.detail contains the patch to merge into stored settings | Extension-page DOM event boundary | packages/extension-safari/src/options.ts |
| browser.storage.local.set({settings: ...}) | OUT | Writes merged Settings (including apiKey) atomically to extension local storage | Safari WebExtension storage API boundary | packages/extension-safari/src/options.ts |
| browser.runtime.sendMessage({type: 'cache.clear' or 'history.clear' or 'connection.test'}) | OUT | Fire-and-forget typed messages relayed to the service worker for cache/history management | Safari WebExtension runtime boundary | packages/extension-safari/src/options.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| apiKey written over the content-script wire instead of directly here | Moving save logic to content.ts or adding a relay path | MessageRelaySettingsStore.set() rejects — surfaces as unhandled rejection in content script | bun run --filter @ai-dict/extension-safari test → packages/extension-safari/src/adapters/message-relay-settings-store.test.ts |
| registerSettingsForm() removed, breaking the custom element definition | Refactoring import in options.ts | document.querySelector('settings-form') returns an HTMLElement with no shadow root; form events never fire | bun run --filter @ai-dict/extension-safari typecheck |
| load() no longer merges with stored settings (overwrites instead of patching) | Changing the save handler to write only next without reading cur | apiKey is silently deleted when user saves only targetLang | bun run --filter @ai-dict/extension-safari test packages/extension-safari/src/adapters/safari-storage-store.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| options.js bundled output | Business Flow | Tree-shaking of unused DEFAULT_TEMPLATE import is permitted | packages/extension-safari/src/manifest.json |
| options.html | Contract | Title and lang attribute may vary; must include <settings-form> and <script type="module" src="options.js"> | packages/extension-safari/src/options.html |
| <settings-form> web component | Contract | Component internals are opaque to this module; only the save, clear-cache, clear-history, test-connection events are consumed | packages/extension-safari/src/options.ts |
