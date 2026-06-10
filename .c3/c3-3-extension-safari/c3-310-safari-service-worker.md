---
id: c3-310
c3-seal: 64d751143e2a48fee34d32f0828a6505a3977e10f6e8da747cfde937700628c7
title: safari-service-worker
type: component
category: feature
parent: c3-3
goal: 'Compose the Safari service-worker runtime: wire Safari adapters and the provider clients (`GeminiLookupClient`/`OpenAILookupClient` behind `createLookupClientSelector`) into the message router, then gate every inbound extension message through `classifyInbound` before dispatching.'
uses:
    - ref-dependency-injection
    - rule-api-key-isolation
    - rule-gate-runtime-messages
    - rule-typed-errors
---

## Goal

Compose the Safari service-worker runtime: wire Safari adapters and the provider clients (`GeminiLookupClient`/`OpenAILookupClient` behind `createLookupClientSelector`) into the message router, then gate every inbound extension message through `classifyInbound` before dispatching.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-3 (extension-safari) |
| Category | Feature |
| Runtime | service worker |
| Public surface | None — module is the entry point sw.js; no exported symbols |
| Bundled into | sw.js (declared as "service_worker" in manifest.json) |
| Depends on | buildRouter (c3-111), GeminiLookupClient + OpenAILookupClient + createLookupClientSelector (c3-114), SafariKvStore (c3-301), SafariStorageStore (c3-301), classifyInbound, mapError, WriteQueue, SUPPRESS from @ai-dict/app |
| Full Settings access | Only this module reads apiKey from storage — all other callers receive PublicSettings only |

## Purpose

Acts as the composition root for the Safari service worker. Instantiates `GeminiLookupClient` and `OpenAILookupClient`, wraps both in `createLookupClientSelector` (provider read from stored settings per lookup, defaulting to gemini), each with a `getApiKey` callback that reads the full `Settings` object (including `apiKey`) directly from `browser.storage.local`, and passes `SafariKvStore` and `SafariStorageStore` to `buildRouter`. Registers a single `browser.runtime.onMessage` listener that applies `classifyInbound` to authenticate and classify each message before routing it; ignores foreign-origin messages and replies synchronously to rejected ones. Keeps the channel open with `return true` for all async dispatches; uses the `SUPPRESS` sentinel to leave the channel open without calling `sendResponse` for fire-and-forget messages. Does NOT manage side-panel, tab, or window state — Safari has no side panel. Does NOT implement any port interface itself — it only wires concrete implementations together.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | Safari ≥ 16.4 per browser_specific_settings in packages/extension-safari/src/manifest.json; browser global declared via var browser: Browser in packages/extension-safari/src/global.d.ts | c3-3 |
| Manifest registration | "background": { "service_worker": "sw.js", "type": "module" } and "permissions": ["storage"] in packages/extension-safari/src/manifest.json grants browser.storage.local to the SW | c3-3 |
| Composition root pattern | buildRouter({client, settings, kv, readToggles, queue, openOptions}) in packages/extension-safari/src/sw.ts — all dependencies injected; no direct domain logic here | ref-dependency-injection |
| API key read locality | readFullSettings() defined and called only inside packages/extension-safari/src/sw.ts; no other extension-safari module reads apiKey | rule-api-key-isolation |
| Message gating | classifyInbound(msg, sender.id, browser.runtime.id) runs before router() in packages/extension-safari/src/sw.ts; returns action: 'ignore', 'reject', or 'process' | rule-gate-runtime-messages |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every legitimate message from the content script receives a typed WireReply; foreign or malformed messages are dropped or rejected before touching the router | c3-111 |
| Primary path | onMessage fires → classifyInbound returns process → router(decision.msg) resolves → sendResponse(reply) if not SUPPRESS (see packages/extension-safari/src/sw.ts) | rule-gate-runtime-messages |
| Ignore path | classifyInbound returns action: 'ignore' → listener returns false immediately, closing the channel (see packages/extension-safari/src/sw.ts) | rule-gate-runtime-messages |
| Reject path | classifyInbound returns action: 'reject' → sendResponse(decision.reply) called synchronously, channel closed with return true (see packages/extension-safari/src/sw.ts) | rule-gate-runtime-messages |
| Open options path | A gated open-options message (relayed by the content script from the UI's composed open-settings event) routes to the injected openOptions dep, which calls browser.runtime.openOptionsPage — the reader's path from the in-page Settings actions to setup (see packages/extension-safari/src/sw.ts) | c3-111 |
| Error path | Router promise rejects → .catch calls sendResponse({ok: false, type: ..., error: mapError({kind: 'thrown', error: e})}) (see packages/extension-safari/src/sw.ts) | rule-typed-errors |
| SUPPRESS path | Router resolves with SUPPRESS sentinel → sendResponse is not called; channel stays open for fire-and-forget semantics (see packages/extension-safari/src/sw.ts) | c3-111 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-gate-runtime-messages | rule | classifyInbound must run before any routing logic; foreign-origin messages must not reach the router | Critical | sender.id compared to browser.runtime.id in classifyInbound |
| ref-dependency-injection | ref | buildRouter receives all dependencies at composition-root time; no service locator or global state | High | Mirrors the same pattern as c3-210 chrome-service-worker |
| rule-api-key-isolation | rule | readFullSettings() is the only site in extension-safari that reads the raw apiKey field | Critical | GeminiLookupClient receives a callback, not a value — key is read lazily per request |
| rule-typed-errors | rule | Caught errors are wrapped with mapError({kind: 'thrown', error: e}) before being sent as WireReply | High | Prevents raw Error objects leaking over the extension message channel |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| browser.runtime.onMessage listener | IN | Accepts any unknown message; returns false (ignore), true synchronously (reject), or true async (process) depending on classifyInbound result | Safari WebExtension runtime boundary | packages/extension-safari/src/sw.ts |
| router(msg) call | OUT | Delegates to buildRouter result (c3-111) with a typed WireMessage; returns Promise<WireReply or SUPPRESS> | Internal composition boundary | packages/extension-safari/src/sw.ts |
| readFullSettings() | IN/OUT | Reads browser.storage.local key "settings", returns full Settings including apiKey; only called inside getApiKey callback and readToggles | Service-worker internal — never exported | packages/extension-safari/src/sw.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Removing classifyInbound gate lets foreign messages reach the router | Refactoring the onMessage handler | No unit test covers sw.ts directly (composition root); gate removal is a structural regression | bun run --filter @ai-dict/extension-safari test packages/extension-safari/src/adapters/safari-storage-store.test.ts |
| readFullSettings moved to a shared module, exposing apiKey outside SW | Extracting settings helper | TypeScript build fails if apiKey type leaks into a non-SW module | bun run --filter @ai-dict/extension-safari typecheck |
| SUPPRESS branch missing return true, closing channel prematurely | Editing the onMessage listener body | Content script receives no reply and times out | bun run --filter @ai-dict/extension-safari test packages/extension-safari/src/adapters/message-relay-settings-store.test.ts |
| Manifest service_worker path changed, breaking SW registration | Editing manifest.json | Extension fails to load in Safari; SW is never registered | bun run --filter @ai-dict/extension-safari test packages/extension-safari/src/adapters/safari-kv-store.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| sw.js bundled output | Business Flow | Tree-shaking of unused router handlers is permitted | packages/extension-safari/src/manifest.json |
| global.d.ts ambient browser type | Foundational Flow | Must remain var (not let/const) for ambient declaration validity | packages/extension-safari/src/global.d.ts |
| Safari manifest browser_specific_settings | Foundational Flow | Must not lower strict_min_version below "16.4" without re-validating browser.* API coverage | packages/extension-safari/src/manifest.json |
