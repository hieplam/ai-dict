---
id: c3-114
c3-seal: b59b19bef87f9644315f8365492bffb8bdaab9375b928cb28c6809130e2c943f
title: gemini-client
type: component
category: feature
parent: c3-1
goal: Implement the `LookupClient` port by calling the Gemini 2.5 Flash `generateContent` REST endpoint, enforcing a 20-second timeout, short-circuiting when offline, and mapping every HTTP/parse/offline/timeout failure to a typed `LookupError` that the service-worker router can serialize and forward to the content script.
uses:
    - ref-core-dependency-rule
    - ref-dependency-injection
    - rule-api-key-isolation
    - rule-typed-errors
---

## Goal

Implement the `LookupClient` port by calling the Gemini 2.5 Flash `generateContent` REST endpoint, enforcing a 20-second timeout, short-circuiting when offline, and mapping every HTTP/parse/offline/timeout failure to a typed `LookupError` that the service-worker router can serialize and forward to the content script.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | GeminiLookupClient, GeminiDeps, FetchLike, FetchInit, ResponseLike |
| Implements port | LookupClient (c3-102) via GeminiLookupClient implements LookupClient |
| Bundled into | packages/app/src/app/gemini-lookup-client.ts |
| Depends on | c3-113 (renderTemplate for prompt construction), ref-dependency-injection (GeminiDeps.fetch/getApiKey) |

## Purpose

`GeminiLookupClient implements LookupClient` receives a `LookupRequest`, resolves the API key via the injected `GeminiDeps.getApiKey()` (never embedded in source or transmitted on a URL), builds the prompt via `renderTemplate` (`c3-113`), and POSTs to the Gemini 2.5 Flash endpoint with the key in the `X-Goog-Api-Key` header. It creates an internal `AbortController` that merges a 20-second timer abort with any caller-supplied `signal`, then maps all failure modes (HTTP error status, unparsable response body, offline, timeout, generic fetch throw) to `LookupError` instances via `mapError` and throws them with `rejectWith(Object.assign(new Error(msg), lookupError))` — making the thrown value both an `Error` instance (satisfying `@typescript-eslint/only-throw-error`) and `isLookupError`-recognizable downstream. Caller-cancel aborts that are NOT already-mapped `LookupError`s are re-thrown raw so the router can distinguish user-cancel (suppress) from server errors (show). It does NOT cache results, does NOT write to storage, and does NOT know about `requestId` or the chrome.runtime message channel.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | GeminiDeps.getApiKey() resolves to a non-empty string; navigator.onLine !== false — checked at packages/app/src/app/gemini-lookup-client.ts lines 51-55 before any fetch | rule-api-key-isolation |
| Input | LookupRequest (word, context, target, url, title, promptTemplate) + caller-supplied { signal: AbortSignal } merged with internal timeout controller | c3-102 |
| Key isolation | getApiKey injected via GeminiDeps; key placed only in X-Goog-Api-Key header at packages/app/src/app/gemini-lookup-client.ts line 83 — never in URL params or request body | rule-api-key-isolation |
| Prompt construction | renderTemplate(req.promptTemplate, {word, context, target_lang, url, title}) called at packages/app/src/app/gemini-lookup-client.ts lines 57-63 | c3-113 |
| Timeout | Internal AbortController fires after configurable timeoutMs (default 20000 ms) via setTimeout at packages/app/src/app/gemini-lookup-client.ts lines 66-77; merged with caller signal | ref-dependency-injection |
| Fetch abstraction | GeminiDeps.fetch: FetchLike is injected — allows test doubles without patching globals | ref-dependency-injection |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary path | getApiKey → online check → renderTemplate → fetch(ENDPOINT, {POST, headers:{X-Goog-Api-Key, Content-Type}, body, signal}) → parse candidates[0].content.parts[0].text → return LookupResult; tested in packages/app/test/app/gemini-lookup-client.test.ts (success → LookupResult) | c3-102 |
| HTTP error path | !res.ok → read nullable error.status from JSON body + retry-after header → mapError({kind:'http', status, geminiStatus?, retryAfterSec?}) → rejectWith; see packages/app/src/app/gemini-lookup-client.ts lines 87-105 | rule-typed-errors |
| Parse failure path | res.json() throws or candidates[0].content.parts[0].text is not a non-empty string → rejectWith(mapError({kind:'parse'})); tested in packages/app/test/app/gemini-lookup-client.test.ts (HTTP 200 but unparsable body) | rule-typed-errors |
| Offline short-circuit | navigator.onLine === false before fetch → rejectWith(mapError({kind:'offline'})), fetch is never called; tested in packages/app/test/app/gemini-lookup-client.test.ts (navigator.onLine === false) | rule-typed-errors |
| Timeout path | Timer fires → ac.abort(new DOMException('timeout','TimeoutError')) → timedOut=true → catch block → rejectWith(mapError({kind:'timeout'})); tested in packages/app/test/app/gemini-lookup-client.test.ts (timeout aborts → NETWORK) | rule-typed-errors |
| Caller-cancel propagation | opts.signal aborts AND caught error is NOT already a mapped LookupError → re-throw raw so router sees AbortError and returns SUPPRESS; tested in packages/app/test/app/gemini-lookup-client.test.ts (our-cancel signal abort propagates raw) | c3-111 |
| Already-mapped LookupError guard | If signal.aborted is true but caught error IS a LookupError (raced res.json() in !res.ok branch) → fall through to isThrownLookupError re-throw; tested in packages/app/test/app/gemini-lookup-client.test.ts (signal aborted while err is already a mapped LookupError) | rule-typed-errors |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-dependency-injection | ref | GeminiDeps.fetch and GeminiDeps.getApiKey are injected; no globalThis.fetch or hard-coded key access | high | Composition roots (sw.ts) supply the concrete implementations |
| rule-typed-errors | rule | rejectWith always throws Object.assign(new Error(msg), lookupError) — satisfies only-throw-error lint rule and makes the value isLookupError-recognizable | high | All mapError paths go through rejectWith |
| rule-api-key-isolation | rule | API key delivered only via X-Goog-Api-Key header; never in URL, body, or logs; injected via getApiKey — not stored in the class | high | Verified by the header-capture assertion in the success test |
| ref-core-dependency-rule | ref | GeminiLookupClient implements the LookupClient port (c3-102); it depends inward on ports.ts interfaces, not outward on chrome APIs | high | The port is the only coupling point between domain and this adapter |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| GeminiLookupClient.lookup(req, opts?) | IN | Implements LookupClient.lookup; accepts LookupRequest + caller-supplied {signal?: AbortSignal}, returns Promise<LookupResult>, throws LookupError-shaped Error on failure | LookupClient port (c3-102) | packages/app/src/app/gemini-lookup-client.ts line 50 |
| GeminiDeps | IN | Injected via constructor; fetch: FetchLike, getApiKey: () => string │ Promise<string>, configurable timeoutMs?: number (defaults to 20000 ms) | composition root | packages/app/src/app/gemini-lookup-client.ts lines 28-32 |
| Thrown LookupError | OUT | Every rejection is Object.assign(new Error(msg), {code, message, retryable, retryAfterSec?}); isLookupError(err) returns true; caller-cancel raw AbortError is re-thrown unwrapped | c3-111 (buildRouter catch block) | packages/app/test/app/gemini-lookup-client.test.ts (thrown LookupError is an Error instance) |
| Raw AbortError passthrough | OUT | When opts.signal.aborted && !isThrownLookupError(err) the original error is re-thrown unmapped so the router can identify user-cancel vs. server error | c3-111 router SUPPRESS logic | packages/app/test/app/gemini-lookup-client.test.ts (our-cancel signal abort propagates raw) |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| API key leaks into URL or body | Refactoring header construction to use a query param | Key visible in network logs; rule-api-key-isolation violated | bun run --filter @ai-dict/app test packages/app/test/app/gemini-lookup-client.test.ts |
| Timeout branch removed | Deleting timedOut flag or the setTimeout block | Hung fetches never reject; capturedSignal.reason.name === 'TimeoutError' assertion fails | packages/app/test/app/gemini-lookup-client.test.ts |
| Caller-cancel guard reordered | Moving the isThrownLookupError check after the signal.aborted check | Already-mapped LookupError re-thrown as raw AbortError, hiding server errors from the router | bun run --filter @ai-dict/app test packages/app/test/app/inbound.test.ts |
| Type contract with LookupClient port | Changing LookupRequest or LookupResult in c3-102 | TypeScript compilation error | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests | Contract | FetchLike test doubles; vi.stubGlobal for navigator.onLine; configurable small timeoutMs for timer tests | packages/app/test/app/gemini-lookup-client.test.ts |
| Chrome SW adapter wiring | Contract | Chrome-specific getApiKey from chrome.storage.local; fetch is globalThis.fetch | packages/extension-chrome/src/sw.ts |
| Safari SW adapter wiring | Contract | Safari WebExtension browser.storage.local for getApiKey | packages/extension-safari/src/sw.ts |
