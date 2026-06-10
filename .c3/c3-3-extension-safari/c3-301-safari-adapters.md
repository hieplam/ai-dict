---
id: c3-301
c3-seal: f7eeeb05d0b49349a70d48a626006d34e5ccb2c00ef7177b93b2a6b6e48ca071
title: safari-adapters
type: component
category: foundation
parent: c3-3
goal: Provide Safari-native implementations of the four core ports so the rest of the extension never touches `browser.storage.local` or DOM directly.
uses:
    - ref-core-dependency-rule
    - ref-kv-storage-prefixes
    - rule-api-key-isolation
---

## Goal

Provide Safari-native implementations of the four core ports so the rest of the extension never touches `browser.storage.local` or DOM directly.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-3 (extension-safari) |
| Category | Foundation |
| Runtime | both |
| Public surface | SafariKvStore, SafariStorageStore, SafariFloatingTrigger, MessageRelaySettingsStore, StorageAreaLike |
| Implements ports | Storage (c3-102), SettingsStore (c3-102), TriggerUI (c3-102) |
| Depends on | @ai-dict/app ports and types (c3-102), browser.storage.local (service-worker side), DOM (content-script side) |
| Bundled into | sw.js (SafariKvStore, SafariStorageStore) and content.js (SafariFloatingTrigger, MessageRelaySettingsStore) |

## Purpose

Owns all Safari-specific I/O at the boundary between the dependency-free core and the browser platform. `SafariKvStore` wraps `browser.storage.local` as a key-value `Storage` without any adapter-side prefix (core's `cache:` / `history:` namespaces own prefixing). `SafariStorageStore` exposes full `Settings` to the service worker but strips `apiKey` before returning `PublicSettings` to callers. `SafariFloatingTrigger` mounts and positions the `<lookup-trigger>` web component in the page DOM, using `composedPath()` to pierce the shadow DOM for accurate outside-press detection. `MessageRelaySettingsStore` implements `SettingsStore` for the content-script side by relaying `settings.get` over `browser.runtime.sendMessage`, caching the result per storage-change cycle, and explicitly rejecting `set()` because the content side must never write settings. Does NOT implement `LookupClient`, `SelectionSource`, or `ResultRenderer` — those are in `c3-115`.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | browser.storage.local is accessible; registerContentElements() called before SafariFloatingTrigger is instantiated (defined in packages/extension-safari/src/adapters/safari-floating-trigger.ts) | ref-web-components-shadow-dom |
| Storage area abstraction | StorageAreaLike interface (in packages/extension-safari/src/adapters/safari-kv-store.ts) used by both SafariKvStore and SafariStorageStore so test fakes satisfy it without importing webextension-polyfill types | c3-102 |
| Prefix ownership | No prefix added by SafariKvStore; cache: and history: prefixes are owned entirely by persistence policies in the core | ref-kv-storage-prefixes |
| API key isolation | SafariStorageStore.get() returns only {targetLang, promptTemplate, hasKey} — apiKey never included; MessageRelaySettingsStore also strips all unknown fields from the SW reply | rule-api-key-isolation |
| Core dependency rule | All four classes depend on inward-pointing interfaces only; no dependency on DOM APIs or browser.* outside the class body itself | ref-core-dependency-rule |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Callers (service worker composition root, content composition root) receive platform-agnostic port implementations they can inject into the core workflow without knowing they are on Safari | c3-102 |
| Primary path (KV) | SafariKvStore.getItem(key) → area.get(key) → returns value or null; setItem and removeItem delegate to area.set and area.remove (see packages/extension-safari/src/adapters/safari-kv-store.ts) | ref-kv-storage-prefixes |
| Primary path (Settings SW side) | SafariStorageStore.get() reads settings key, derives hasKey via hasKeyFor(settings) (the selected provider's key), returns PublicSettings without apiKey (see packages/extension-safari/src/adapters/safari-storage-store.ts) | rule-api-key-isolation |
| Primary path (Trigger) | SafariFloatingTrigger.show(anchor, onClick) creates <lookup-trigger>, positions it at fixed (anchor.x, anchor.y + anchor.h), registers capture-phase dismiss listeners; hide() removes element and all listeners (see packages/extension-safari/src/adapters/safari-floating-trigger.ts) | ref-web-components-shadow-dom |
| Primary path (Settings content side) | MessageRelaySettingsStore.get() returns cached PublicSettings if present, else sends {type: 'settings.get'} via runtime.sendMessage, strips to known fields, caches result; set() rejects unconditionally (see packages/extension-safari/src/adapters/message-relay-settings-store.ts) | rule-api-key-isolation |
| Failure behavior | MessageRelaySettingsStore.get() throws 'settings.get failed' when SW reply is not ok or not type settings; SafariKvStore propagates area promise rejections unmodified (see packages/extension-safari/src/adapters/message-relay-settings-store.test.ts) | c3-111 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | All four adapter classes import only inward-pointing port interfaces from @ai-dict/app | High | Enforced structurally — adapters are never imported by the core |
| ref-kv-storage-prefixes | ref | SafariKvStore adds no adapter-side prefix; keys(prefix) returns full keys with the core-owned prefix intact | High | Comment in source confirms intent: "core's cache-/history-policy own the namespaces themselves" |
| rule-api-key-isolation | rule | SafariStorageStore.get() strips apiKey; MessageRelaySettingsStore whitelists only the three PublicSettings fields from the wire reply | Critical | Defense-in-depth: isolation enforced at both storage layer and wire layer |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| SafariKvStore (implements Storage) | IN/OUT | getItem(key) returns string or null; keys(prefix?) returns all matching keys; setItem/removeItem delegate to area | Service-worker bundle boundary (sw.js) | packages/extension-safari/src/adapters/safari-kv-store.ts + safari-kv-store.test.ts |
| SafariStorageStore (implements SettingsStore) | IN/OUT | get() returns PublicSettings (no apiKey); set(patch) merges only targetLang/promptTemplate preserving apiKey and toggles | Service-worker bundle boundary (sw.js) | packages/extension-safari/src/adapters/safari-storage-store.ts + safari-storage-store.test.ts |
| SafariFloatingTrigger (implements TriggerUI) | IN/OUT | show(anchor, onClick) mounts <lookup-trigger> at fixed coordinates; hide() removes it and cleans up all event listeners | Content-script bundle boundary (content.js) | packages/extension-safari/src/adapters/safari-floating-trigger.ts + safari-floating-trigger.test.ts |
| MessageRelaySettingsStore (implements SettingsStore) | IN/OUT | get() returns cached PublicSettings; invalidates on subscribe callback; set() always rejects | Content-script bundle boundary (content.js) | packages/extension-safari/src/adapters/message-relay-settings-store.ts + message-relay-settings-store.test.ts |
| StorageAreaLike | IN | Minimal interface for browser.storage.local so test fakes don't require webextension-polyfill types | Test and composition-root boundary | packages/extension-safari/src/adapters/safari-kv-store.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| SafariKvStore adds an adapter prefix, breaking core cache/history clear | Modifying getItem/setItem or keys() | Unit test asserts full cache: prefixed keys are returned unchanged | bun run --filter @ai-dict/extension-safari test → packages/extension-safari/src/adapters/safari-kv-store.test.ts |
| SafariStorageStore.get() leaks apiKey in PublicSettings | Adding fields to the return object or spreading Settings directly | Unit test asserts 'apiKey' in pub is false; wire-layer proof test asserts reply has no apiKey | bun run --filter @ai-dict/extension-safari test → packages/extension-safari/src/adapters/safari-storage-store.test.ts |
| SafariFloatingTrigger fails to remove outside-press listeners on hide() | Modifying listener registration or hide() cleanup | Unit test checks no dismissal leaks across re-mounts | bun run --filter @ai-dict/extension-safari test → packages/extension-safari/src/adapters/safari-floating-trigger.test.ts |
| MessageRelaySettingsStore caches a reply that includes extra fields | SW reply format change | Unit test explicitly asserts apiKey and unexpectedField are absent after strip | bun run --filter @ai-dict/extension-safari test → packages/extension-safari/src/adapters/message-relay-settings-store.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests (four .test.ts siblings) | Contract | Test fakes may use vi.fn() stubs for StorageAreaLike; DOM tests use jsdom via vitest | packages/extension-safari/src/adapters/safari-kv-store.test.ts, safari-storage-store.test.ts, safari-floating-trigger.test.ts, message-relay-settings-store.test.ts |
| sw.js bundle (service-worker) | Business Flow | No tree-shaking of SafariKvStore or SafariStorageStore permitted — both are wired at composition-root time | packages/extension-safari/src/sw.ts |
| content.js bundle (content script) | Business Flow | No tree-shaking of SafariFloatingTrigger or MessageRelaySettingsStore permitted — both must be present for the workflow | packages/extension-safari/src/content.ts |
