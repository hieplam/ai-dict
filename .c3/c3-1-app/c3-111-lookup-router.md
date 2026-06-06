---
id: c3-111
c3-seal: cb25b580299105c1be379fc6389dfd6e30f111607f4a073d0fc9e1a1568540c8
title: lookup-router
type: component
category: feature
parent: c3-1
goal: Dispatch validated `WireMessage` frames to the appropriate handler inside the service worker, orchestrate cache and history persistence policies, manage in-flight request cancellation, and normalize errors to plain objects before they cross the chrome.runtime message boundary.
uses:
    - ref-dependency-injection
    - ref-wire-protocol-validation
    - rule-gate-runtime-messages
    - rule-typed-errors
---

## Goal

Dispatch validated `WireMessage` frames to the appropriate handler inside the service worker, orchestrate cache and history persistence policies, manage in-flight request cancellation, and normalize errors to plain objects before they cross the chrome.runtime message boundary.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | buildRouter, WriteQueue, SUPPRESS, RouterDeps, RouterReply |
| Bundled into | packages/app/src/app/router.ts + composition roots sw.ts |
| Depends on | c3-112 persistence-policies (cacheGet, cachePut, cacheClear, historyAppend, historyList, historyClear) |
| Companion | inbound.ts classifyInbound — gates messages before they reach the router |

## Purpose

`buildRouter(deps: RouterDeps)` returns a single async dispatch function that accepts a `WireMessage` and returns a `RouterReply | SUPPRESS`. It owns the in-flight `Map<requestId, AbortController>` and a `Set<requestId>` for cancellations, ensures the `AbortController` is registered synchronously before any `await` to close the pre-inflight race window, delegates persistence to `c3-112` via the serialized `WriteQueue` (preventing lost-update races on concurrent history appends), and normalizes any caught error through `toLookupError` — which re-spreads all fields into a fresh plain object so that the non-enumerable `Error.message` property survives JSON serialization across the chrome.runtime boundary. It does NOT parse or validate incoming messages (that is `classifyInbound`'s job), does NOT hold API keys, and does NOT render any UI.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Message has already passed classifyInbound (sender guard + Zod schema parse) in packages/app/src/app/inbound.ts | rule-gate-runtime-messages |
| Input | WireMessage — a discriminated union validated by WireMessageSchema, defined in packages/app/src/app/router.ts line 58 | c3-103 |
| Internal state | inflight: Map<string, AbortController>, cancelled: Set<string>, WriteQueue.tail: Promise<unknown> — all in packages/app/src/app/router.ts | c3-1 |
| Shared dependencies | RouterDeps — client: LookupClient, settings: SettingsStore, kv: Storage, readToggles, queue: WriteQueue injected by composition root | ref-dependency-injection |
| Persistence orchestration | cacheGet/cachePut/cacheClear, historyAppend/historyList/historyClear from packages/app/src/index.ts — delegated to c3-112 | c3-112 |
| Write serialization | WriteQueue.run(task) in packages/app/src/app/router.ts chains each write onto a promise tail, preventing concurrent RMW races on c3-112 storage | c3-112 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary path (lookup hit) | readToggles → cacheGet hit → return {ok:true, result:{...hit, fromCache:true}} without calling client; covered in packages/app/test/app/router.test.ts (lookup cache hit) | c3-112 |
| Primary path (lookup miss) | readToggles → cacheGet miss → client.lookup → cachePut + historyAppend via queue → return {ok:true, result}; see handleLookup in packages/app/src/app/router.ts | c3-112 |
| Cancellation path | lookup.cancel finds controller in inflight, adds to cancelled, calls controller.abort(); if cancelled contains requestId at any checkpoint the handler returns SUPPRESS; tested in packages/app/test/app/router.test.ts | rule-typed-errors |
| Pre-inflight cancel window | AbortController registered synchronously before first await so a cancel arriving during readToggles still populates cancelled and returns SUPPRESS; regression test in packages/app/test/app/router.test.ts | rule-gate-runtime-messages |
| Failure path | Any thrown error is caught; if cancelled contains requestId → SUPPRESS; otherwise → toLookupError(err) → {ok:false, type:'lookup', error, requestId}; in packages/app/src/app/router.ts catch block | rule-typed-errors |
| Wire-boundary normalization | toLookupError spreads code/message/retryable/retryAfterSec into a plain object so Error.message (non-enumerable) survives JSON serialization; regression test in packages/app/test/app/router.test.ts | ref-wire-protocol-validation |
| Other message types | settings.get, history.list, history.clear, cache.clear, connection.test, lookup.cancel each handled by a dedicated internal function in the switch in packages/app/src/app/router.ts | c3-103 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-wire-protocol-validation | ref | All WireMessage entering the router have been Zod-validated by classifyInbound before dispatch | high | The router trusts the message shape; it does not re-parse |
| ref-dependency-injection | ref | RouterDeps interface — all external collaborators (client, settings, kv, readToggles, queue) are injected; no singleton imports | high | Composition roots (sw.ts) assemble the concrete graph |
| rule-gate-runtime-messages | rule | classifyInbound must run before buildRouter's dispatch function; the router never receives unvalidated or foreign-origin messages | high | Sender guard enforces same-extension-only origin |
| rule-typed-errors | rule | toLookupError normalizes every error to a plain LookupError-shaped object before it crosses the chrome.runtime JSON boundary | high | Non-enumerable Error.message would be lost without this |
| c3-112 | example | buildRouter orchestrates cacheGet/cachePut/cacheClear/historyAppend/historyList/historyClear per readToggles flags | medium | Persistence toggle logic lives in the router, not in the policies themselves |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| buildRouter(deps: RouterDeps) | IN | Accepts injected collaborators; returns (msg: WireMessage) => Promise<RouterReply> | service-worker composition root | packages/app/src/app/router.ts line 58 |
| RouterReply (WireReply │ SUPPRESS) | OUT | Callers must check for SUPPRESS symbol and drop the reply silently; all other values are sent back via chrome.runtime | chrome.runtime message channel | packages/app/src/app/router.ts lines 19-20 |
| WriteQueue | IN/OUT | Exported class; composition root constructs one instance and passes it in RouterDeps; run<T>(task) serializes writes | service-worker internal | packages/app/test/app/router.test.ts (WriteQueue serializes RMW) |
| SUPPRESS | OUT | Unique Symbol('suppress') sentinel; returned instead of a WireReply when the requestId was cancelled; caller must not forward it to the content script | chrome.runtime message channel | packages/app/test/app/router.test.ts (cancellation suppresses) |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Pre-inflight cancellation race regression | Moving inflight.set(requestId, controller) to after any await | A cancel during readToggles would not be detected; the lookup result would be returned instead of SUPPRESS | bun run --filter @ai-dict/app test packages/app/test/app/router.test.ts |
| toLookupError drops non-enumerable message | Changing the normalization to return the raw Error object | wire.error.message becomes undefined after JSON.parse(JSON.stringify(reply)) | bun run --filter @ai-dict/app test packages/app/test/app/inbound.test.ts |
| WriteQueue removed or bypassed | Calling historyAppend directly without queue | Concurrent lookups lose one history entry (lost-update race) | packages/app/test/app/router.test.ts |
| Type-safety breakage | Changing RouterDeps or WireMessage shape | TypeScript compiler catches mismatches at compilation | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests | Contract | Test doubles for LookupClient, Storage, and toggles; fakeStorage from test fakes | packages/app/test/app/router.test.ts |
| Inbound gate companion | Foundational Flow (Precondition row — classifyInbound must run before dispatch) | Sender id and runtimeId come from the chrome.runtime messaging event | packages/app/test/app/inbound.test.ts |
| Chrome SW composition root | Contract (wires RouterDeps and passes dispatch function to chrome.runtime.onMessage) | Chrome-specific getApiKey, Storage, SettingsStore adapters injected by c3-201 | packages/extension-chrome/src/sw.ts |
