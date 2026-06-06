---
id: c3-201
c3-seal: 4f81513616bcd7290d52751fb3a63f46d91aff4c5d5afcdb3db19f09c8bffb86
title: chrome-adapters
type: component
category: foundation
parent: c3-2
goal: Provide Chrome-concrete implementations of every core port so the dependency-free domain can run inside the Chrome extension environment.
uses:
    - ref-core-dependency-rule
    - ref-kv-storage-prefixes
    - rule-api-key-isolation
---

## Goal

Provide Chrome-concrete implementations of every core port so the dependency-free domain can run inside the Chrome extension environment.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-2 (extension-chrome) |
| Category | Foundation |
| Runtime | both |
| Public surface | ChromeKvStore, ChromeStorageStore, ChromeFloatingTrigger, ChromeSidePanelMirror, MessageRelaySettingsStore, StorageAreaLike |
| Implements ports | Storage (c3-102), SettingsStore (c3-102), TriggerUI (c3-102), ResultRenderer (c3-102) |
| Bundled into | sw.js (service worker), content.js (content script) |
| Depends on | @ai-dict/app ports + types (c3-102, c3-101); chrome.storage.local (via StorageAreaLike); chrome.runtime.sendMessage (via RuntimeLike) |

## Purpose

These five classes close the gap between the platform-agnostic port interfaces defined in `packages/app/src/ports.ts` and the Chrome Extension APIs. `ChromeKvStore` wraps `chrome.storage.local` as the `Storage` port using pass-through keys (no adapter-side prefix; the `cache:` / `history:` namespaces are owned by the domain's persistence policies). `ChromeStorageStore` implements `SettingsStore` for service-worker use — it reads and writes the `settings` key in storage but exposes only `PublicSettings` (no `apiKey`) through `get()`. `ChromeFloatingTrigger` implements `TriggerUI` by mounting and managing a `<lookup-trigger>` custom element, using `composedPath()` to handle shadow-DOM dismiss events correctly. `ChromeSidePanelMirror` implements `ResultRenderer` by forwarding state transitions to the side panel over `chrome.runtime.sendMessage`. `MessageRelaySettingsStore` implements `SettingsStore` for the content-script side — it fetches `PublicSettings` from the SW via message relay and deliberately rejects `set()` so settings are never written over the content wire. This component does NOT own the port interfaces themselves, does NOT implement `SelectionSource` or `LookupClient`, and does NOT contain any domain logic.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | chrome.storage.local is accessible (service-worker context) or chrome.runtime is accessible (content-script context) | ref-core-dependency-rule |
| Input — KvStore | Any string key (including cache:* / history:* prefixes owned by the domain) passed through unchanged | ref-kv-storage-prefixes |
| Input — StorageStore | Reads/writes the literal settings key in chrome.storage.local; found in packages/extension-chrome/src/adapters/chrome-storage-store.ts | c3-102 |
| Input — FloatingTrigger | AnchorRect {x, y, w, h} from the selection source and an onClick callback; defined in packages/extension-chrome/src/adapters/chrome-floating-trigger.ts | c3-102 |
| Input — SidePanelMirror | LookupResult / LookupError structs plus a RuntimeLike wrapping chrome.runtime; defined in packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts | c3-102 |
| Input — MessageRelayStore | RuntimeLike plus a caller-supplied subscribe function; falls back to chrome.storage.onChanged when not provided | rule-api-key-isolation |
| Internal state — FloatingTrigger | Holds a single <lookup-trigger> element reference and one onClick closure; re-anchors on repeated show() calls | ref-web-components-shadow-dom |
| Internal state — MessageRelayStore | One-entry cache: PublicSettings │ null; invalidated by the subscribe callback on storage change | rule-api-key-isolation |
| Shared dependency | StorageAreaLike interface in packages/extension-chrome/src/adapters/chrome-kv-store.ts lets test fakes satisfy adapters without full Chrome type overloads | c3-102 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Each adapter satisfies its port contract so the composition roots can assemble the full lookup pipeline without any platform leak into the domain | ref-core-dependency-rule |
| Primary path — KvStore | getItem(key) calls area.get(key) and returns the string value or null; keys(prefix?) calls area.get(null) and filters by prefix; verified in packages/extension-chrome/src/adapters/chrome-kv-store.test.ts | ref-kv-storage-prefixes |
| Primary path — StorageStore | get() reads settings from storage, strips apiKey, derives hasKey from truthiness of stored key, fills defaults if absent; verified in packages/extension-chrome/src/adapters/chrome-storage-store.test.ts | rule-api-key-isolation |
| Primary path — FloatingTrigger | show() creates <lookup-trigger> if absent, positions it via fixed CSS, registers lookup-click listener; hide() removes element and cleans up document-level capture listeners; verified in packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts | ref-web-components-shadow-dom |
| Primary path — SidePanelMirror | renderLoading/renderResult/renderError/close each call runtime.sendMessage({ to: 'side-panel', state, payload? }); promise rejection is swallowed (panel may be closed); verified in packages/extension-chrome/src/adapters/chrome-side-panel-mirror.test.ts | c3-102 |
| Primary path — MessageRelayStore | get() returns the cached PublicSettings or sends { type: 'settings.get' } to the SW and caches the reply; verified in packages/extension-chrome/src/adapters/message-relay-settings-store.test.ts | rule-api-key-isolation |
| Alternate path — MessageRelayStore | Cache is cleared on subscribe callback (storage change event); next get() re-fetches from SW | rule-api-key-isolation |
| Failure — SidePanelMirror | Rejected sendMessage (no receiver) is caught and discarded silently via .catch(() => undefined) in packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts | c3-102 |
| Failure — MessageRelayStore | If SW reply is not { ok: true, type: 'settings' }, throws 'settings.get failed'; set() always rejects | rule-api-key-isolation |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | All five classes implement ports (c3-102); no domain logic lives here | Primary | These files may import @ai-dict/app types/ports; they must not be imported by packages/app/src/domain/** |
| ref-kv-storage-prefixes | ref | ChromeKvStore passes keys through unchanged; cache: and history: prefixes are the domain's concern | Primary | No adapter-side prefix is added — see comment in packages/extension-chrome/src/adapters/chrome-kv-store.ts line 12 |
| rule-api-key-isolation | rule | MessageRelaySettingsStore.get() returns only PublicSettings; set() is rejected; apiKey never crosses the content wire | Mandatory | ChromeStorageStore.get() also strips apiKey before returning |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| ChromeKvStore | IN/OUT | Implements Storage (getItem/setItem/removeItem/keys) over a StorageAreaLike; no key transformation | packages/app/src/ports.ts → Storage | packages/extension-chrome/src/adapters/chrome-kv-store.ts |
| ChromeStorageStore | IN/OUT | Implements SettingsStore; get() returns PublicSettings only; set() merges targetLang/promptTemplate while preserving apiKey and booleans | packages/app/src/ports.ts → SettingsStore | packages/extension-chrome/src/adapters/chrome-storage-store.ts |
| ChromeFloatingTrigger | IN/OUT | Implements TriggerUI; show(anchor, onClick) mounts/repositions <lookup-trigger>; hide() removes it and cleans up listeners | packages/app/src/ports.ts → TriggerUI | packages/extension-chrome/src/adapters/chrome-floating-trigger.ts |
| ChromeSidePanelMirror | OUT | Implements ResultRenderer; forwards state to side panel via runtime.sendMessage({ to: 'side-panel', ... }); swallows rejected sends | packages/app/src/ports.ts → ResultRenderer | packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts |
| MessageRelaySettingsStore | IN | Implements SettingsStore; get() relays settings.get to SW and caches; set() always rejects | packages/app/src/ports.ts → SettingsStore | packages/extension-chrome/src/adapters/message-relay-settings-store.ts |
| StorageAreaLike | IN | Minimal interface (get/set/remove) that both ChromeKvStore and ChromeStorageStore accept; enables testability without Chrome type overloads | Module boundary for test fakes | packages/extension-chrome/src/adapters/chrome-kv-store.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| ChromeStorageStore.get() leaks apiKey into PublicSettings | Any change to the get() projection or defaults() shape | Test "apiKey is never exposed" fails | packages/extension-chrome/src/adapters/chrome-storage-store.test.ts |
| ChromeKvStore adds an adapter-side key prefix | Editing getItem/setItem/removeItem to prepend a namespace | Test "round-trips with exact key" fails; domain cache/history breaks | packages/extension-chrome/src/adapters/chrome-kv-store.test.ts |
| ChromeFloatingTrigger dismiss logic breaks shadow-DOM events | Changing composedPath() check or DISMISS_EVENTS list | Tests "does NOT dismiss inside bubble" and "dismisses outside" fail | packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts |
| MessageRelaySettingsStore.set() stops rejecting (content writes settings) | Modifying set() to forward over the wire | Test "set() is rejected" fails; violates rule-api-key-isolation | packages/extension-chrome/src/adapters/message-relay-settings-store.test.ts |
| Port interface drift (Storage/SettingsStore/TriggerUI/ResultRenderer) | Upstream port signature changes in packages/app/src/ports.ts | TypeScript compile error in adapter classes | bun run --filter @ai-dict/extension-chrome typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests (*.test.ts) | Contract | Test fakes may use simplified StorageAreaLike or RuntimeLike implementations | packages/extension-chrome/src/adapters/chrome-kv-store.test.ts |
| sw.js bundle (uses ChromeKvStore, ChromeStorageStore) | Business Flow | N.A - service worker has no alternate bundle | packages/extension-chrome/src/sw.ts |
| content.js bundle (uses ChromeFloatingTrigger, ChromeSidePanelMirror, MessageRelaySettingsStore) | Business Flow | N.A - content script has no alternate bundle | packages/extension-chrome/src/content.ts |
