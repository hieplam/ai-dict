---
id: c3-114
c3-seal: 659eded368ad34af40ae2eb6db94934640a1bd3bf21ac6cddacb14f30afe6ba4
title: lookup-clients
type: component
category: feature
parent: c3-1
goal: Implement the `LookupClient` port once per supported AI provider — Gemini 2.5 Flash (`generateContent` REST), OpenAI ChatGPT (`chat/completions` REST), and Anthropic Claude (`messages` REST) — plus `createProviderPool`, the any-failure fallback pool that tries the selected (or one-shot picked) provider first and silently falls through to the next configured provider. Every client enforces a 20-second timeout, short-circuits when offline, stamps the answering `provider` on the result, and maps every HTTP/parse/offline/timeout failure to a typed `LookupError`.
uses:
    - ref-core-dependency-rule
    - ref-dependency-injection
    - rule-api-key-isolation
    - rule-typed-errors
---

## Goal

Implement the `LookupClient` port once per supported AI provider — Gemini 2.5 Flash (`generateContent` REST) and OpenAI ChatGPT (`chat/completions` REST) — plus the per-call selector that picks the client for the provider stored in settings. Every client enforces a 20-second timeout, short-circuits when offline, and maps every HTTP/parse/offline/timeout failure to a typed `LookupError` that the service-worker router can serialize and forward to the content script.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | GeminiLookupClient, GeminiDeps, OpenAILookupClient, OpenAIDeps, createLookupClientSelector, LookupClientSelectorDeps, FetchLike, FetchInit, ResponseLike |
| Implements port | LookupClient (c3-102) via GeminiLookupClient / OpenAILookupClient / the selector wrapper |
| Bundled into | packages/app/src/app/gemini-lookup-client.ts, packages/app/src/app/openai-lookup-client.ts, packages/app/src/app/lookup-client-selector.ts |
| Depends on | c3-113 (renderTemplate for prompt construction), ref-dependency-injection (deps.fetch/getApiKey/getProvider) |

## Purpose

Both provider clients follow the same contract. `GeminiLookupClient implements LookupClient` receives a `LookupRequest`, resolves the API key via the injected `GeminiDeps.getApiKey()` (never embedded in source or transmitted on a URL), builds the prompt via `renderTemplate` (`c3-113`), and POSTs to the Gemini 2.5 Flash endpoint with the key in the `X-Goog-Api-Key` header. `OpenAILookupClient` mirrors it exactly against `https://api.openai.com/v1/chat/completions`, with the key only in the `Authorization: Bearer` header, a configurable model (`OpenAIDeps.model`, default `gpt-4o-mini`), and provider-tagged `mapError` inputs so messages name OpenAI. Each client creates an internal `AbortController` that merges a 20-second timer abort with any caller-supplied `signal`, then maps all failure modes (HTTP error status, unparsable response body, offline, timeout, generic fetch throw) to `LookupError` instances via `mapError` and throws them with `rejectWith(Object.assign(new Error(msg), lookupError))` — making the thrown value both an `Error` instance (satisfying `@typescript-eslint/only-throw-error`) and `isLookupError`-recognizable downstream. Caller-cancel aborts that are NOT already-mapped `LookupError`s are re-thrown raw so the router can distinguish user-cancel (suppress) from server errors (show).

`createLookupClientSelector({ clients, getProvider })` wraps both clients in a single `LookupClient` that resolves `getProvider()` per call and delegates — mirroring the per-call `getApiKey()` pattern, so a provider change in settings applies to the next lookup without a router rebuild or settings listener. The clients do NOT cache results, do NOT write to storage, and do NOT know about `requestId` or the chrome.runtime message channel.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | deps.getApiKey() resolves to a non-empty string; navigator.onLine !== false — checked in each client before any fetch | rule-api-key-isolation |
| Input | LookupRequest (word, context, target, url, title, promptTemplate) + caller-supplied { signal: AbortSignal } merged with internal timeout controller | c3-102 |
| Provider selection | createLookupClientSelector resolves getProvider() per lookup and delegates to clients[provider]; packages/app/src/app/lookup-client-selector.ts | ref-dependency-injection |
| Key isolation | Gemini: key only in X-Goog-Api-Key header; OpenAI: key only in Authorization: Bearer header — never in URL params or request body | rule-api-key-isolation |
| Prompt construction | renderTemplate(req.promptTemplate, {word, context, target_lang, url, title}) in both clients | c3-113 |
| Timeout | Internal AbortController fires after configurable timeoutMs (default 20000 ms) via setTimeout; merged with caller signal — identical in both clients | ref-dependency-injection |
| Fetch abstraction | deps.fetch: FetchLike is injected — allows test doubles without patching globals | ref-dependency-injection |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary path (gemini) | getApiKey → online check → renderTemplate → fetch(ENDPOINT, …) → parse candidates[0].content.parts[0].text → return LookupResult; tested in packages/app/test/app/gemini-lookup-client.test.ts | c3-102 |
| Primary path (openai) | getApiKey → online check → renderTemplate → fetch(chat/completions, {model, messages}) → parse choices[0].message.content → return LookupResult with the configured model id; tested in packages/app/test/app/openai-lookup-client.test.ts | c3-102 |
| Selector path | selector.lookup resolves getProvider() per call, forwards req + signal untouched, propagates rejections untouched; tested in packages/app/test/app/lookup-client-selector.test.ts | c3-102 |
| HTTP error path | !res.ok → status (+ Gemini error.status / retry-after header) → mapError({kind:'http', …, provider}) → rejectWith; provider tag selects OpenAI wording | rule-typed-errors |
| Parse failure path | res.json() throws or expected text path is not a non-empty string → rejectWith(mapError({kind:'parse', provider})); tested in both client suites | rule-typed-errors |
| Offline short-circuit | navigator.onLine === false before fetch → rejectWith(mapError({kind:'offline'})), fetch is never called; tested in both client suites | rule-typed-errors |
| Timeout path | Timer fires → ac.abort(new DOMException('timeout','TimeoutError')) → timedOut=true → catch → rejectWith(mapError({kind:'timeout'})); tested in both client suites | rule-typed-errors |
| Caller-cancel propagation | opts.signal aborts AND caught error is NOT already a mapped LookupError → re-throw raw so router sees AbortError and returns SUPPRESS; tested in both client suites | c3-111 |
| Already-mapped LookupError guard | If signal.aborted is true but caught error IS a LookupError → fall through to isThrownLookupError re-throw; tested in both client suites | rule-typed-errors |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-dependency-injection | ref | deps.fetch, deps.getApiKey, and the selector's getProvider are injected; no globalThis.fetch or hard-coded key access | high | Composition roots (sw.ts) supply the concrete implementations |
| rule-typed-errors | rule | rejectWith always throws Object.assign(new Error(msg), lookupError) — satisfies only-throw-error lint rule and makes the value isLookupError-recognizable | high | All mapError paths in both clients go through rejectWith |
| rule-api-key-isolation | rule | Keys delivered only via provider-appropriate headers (X-Goog-Api-Key / Authorization: Bearer); never in URL, body, or logs; injected via getApiKey — not stored in the class | high | Verified by header-capture assertions in both client success tests |
| ref-core-dependency-rule | ref | Both clients and the selector implement/return the LookupClient port (c3-102); they depend inward on ports.ts interfaces, not outward on chrome APIs | high | The port is the only coupling point between domain and these adapters |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| GeminiLookupClient.lookup(req, opts?) / OpenAILookupClient.lookup(req, opts?) | IN | Implements LookupClient.lookup; accepts LookupRequest + caller-supplied {signal?: AbortSignal}, returns Promise<LookupResult>, throws LookupError-shaped Error on failure | LookupClient port (c3-102) | packages/app/src/app/gemini-lookup-client.ts, packages/app/src/app/openai-lookup-client.ts |
| GeminiDeps / OpenAIDeps | IN | Injected via constructor; fetch: FetchLike, getApiKey: () => string │ Promise<string>, timeoutMs?: number (default 20000 ms); OpenAIDeps adds model?: string (default gpt-4o-mini) | composition root | packages/app/src/app/openai-lookup-client.ts |
| createLookupClientSelector(deps) | IN | clients: Record<Provider, LookupClient>, getProvider: () => Provider │ Promise<Provider>; returns a LookupClient delegating per call | composition root | packages/app/src/app/lookup-client-selector.ts |
| Thrown LookupError | OUT | Every rejection is Object.assign(new Error(msg), {code, message, retryable, retryAfterSec?}); isLookupError(err) returns true; caller-cancel raw AbortError is re-thrown unwrapped | c3-111 (buildRouter catch block) | packages/app/test/app/openai-lookup-client.test.ts |
| Raw AbortError passthrough | OUT | When opts.signal.aborted && !isThrownLookupError(err) the original error is re-thrown unmapped so the router can identify user-cancel vs. server error | c3-111 router SUPPRESS logic | packages/app/test/app/gemini-lookup-client.test.ts, packages/app/test/app/openai-lookup-client.test.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| API key leaks into URL or body | Refactoring header construction to use a query param or body field | Key visible in network logs; rule-api-key-isolation violated | bun run --filter @ai-dict/app test (header-capture + url/body assertions in both client suites) |
| Timeout branch removed | Deleting timedOut flag or the setTimeout block in either client | Hung fetches never reject; capturedSignal.reason.name === 'TimeoutError' assertion fails | packages/app/test/app/gemini-lookup-client.test.ts, packages/app/test/app/openai-lookup-client.test.ts |
| Caller-cancel guard reordered | Moving the isThrownLookupError check after the signal.aborted check | Already-mapped LookupError re-thrown as raw AbortError, hiding server errors from the router | bun run --filter @ai-dict/app test |
| Selector bypassed or provider hard-wired | Composition root instantiating a single client directly again | Provider setting silently ignored; selector tests still green but sw wiring drifts | packages/app/test/app/lookup-client-selector.test.ts + sw.ts review |
| Type contract with LookupClient port | Changing LookupRequest or LookupResult in c3-102 | TypeScript compilation error | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests | Contract | FetchLike test doubles; vi.stubGlobal for navigator.onLine; configurable small timeoutMs for timer tests | packages/app/test/app/gemini-lookup-client.test.ts, packages/app/test/app/openai-lookup-client.test.ts, packages/app/test/app/lookup-client-selector.test.ts |
| Chrome SW adapter wiring | Contract | Both clients built once, wrapped in createLookupClientSelector; getApiKey from chrome.storage.local (env define wins for Gemini); getProvider reads settings.provider ?? 'gemini' | packages/extension-chrome/src/sw.ts |
| Safari SW adapter wiring | Contract | Same composition against browser.storage.local (no env key path) | packages/extension-safari/src/sw.ts |
