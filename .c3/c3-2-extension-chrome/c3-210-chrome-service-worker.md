---
id: c3-210
c3-seal: e7a35793432be4307f88b6988aeecbb041299ed69f32a2c965f6b268a0697407
title: chrome-service-worker
type: component
category: feature
parent: c3-2
goal: 'Act as the extension''s service-worker composition root: wire concrete adapters into the router and guard every inbound message before dispatching.'
uses:
    - ref-dependency-injection
    - rule-api-key-isolation
    - rule-gate-runtime-messages
    - rule-typed-errors
---

## Goal

Act as the extension's service-worker composition root: wire concrete adapters into the router and guard every inbound message before dispatching.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-2 (extension-chrome) |
| Category | Feature |
| Runtime | service worker |
| Public surface | N.A - sw.ts is an entry point; it exports no symbols |
| Bundled into | sw.js (declared as background.service_worker in manifest.json) |
| Depends on | buildRouter (c3-111), GeminiLookupClient + OpenAILookupClient + createLookupClientSelector (c3-114), ChromeStorageStore (c3-201), ChromeKvStore (c3-201), classifyInbound, mapError, WriteQueue, SUPPRESS from @ai-dict/app |
| Build-time define | GEMINI_API_KEY injected by esbuild; declared in packages/extension-chrome/src/build-defines.d.ts |

## Purpose

`sw.ts` is the sole composition root for the service-worker world. It constructs a `GeminiLookupClient` and an `OpenAILookupClient`, wraps both in `createLookupClientSelector` (the provider is read from stored settings per lookup, defaulting to gemini), and gives the Gemini client a `getApiKey` resolver that prefers the build-time constant `__GEMINI_API_KEY__` over the stored key — allowing personal builds that skip the options page entirely. It passes concrete adapters (`ChromeStorageStore`, `ChromeKvStore`, `WriteQueue`) into `buildRouter` to produce a typed message handler. The `chrome.runtime.onMessage` listener runs every inbound message through `classifyInbound` first; only messages classified as `'process'` reach the router, all others are either ignored or answered with a rejection reply. `readFullSettings()` is the **only place** the full `Settings` object (including `apiKey`) is ever read — no other file in the extension bundle receives the raw key. The SW also configures the side panel to open exclusively on toolbar click via `chrome.sidePanel.setPanelBehavior`. This component does NOT render any UI, does NOT own port interface definitions, and does NOT persist data directly (that is delegated to the adapters).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Extension installed; chrome.storage and chrome.runtime available in the service-worker context per manifest.json background declaration | ref-dependency-injection |
| Build-time input | GEMINI_API_KEY string (may be empty) and GEMINI_KEY_FROM_ENV boolean injected by esbuild define; declared in packages/extension-chrome/src/build-defines.d.ts | rule-api-key-isolation |
| Runtime input | chrome.runtime.onMessage events carrying typed wire messages from content scripts and extension pages | rule-gate-runtime-messages |
| Composition | buildRouter({ client, settings, kv, readToggles, queue }) assembles the full router at module load time; packages/extension-chrome/src/sw.ts lines 34-46 | ref-dependency-injection |
| API key resolution | getApiKey lambda in packages/extension-chrome/src/sw.ts lines 37-38 returns ENV_API_KEY if non-empty, else calls readFullSettings().apiKey | rule-api-key-isolation |
| Shared dependency | ChromeStorageStore(chrome.storage.local) and ChromeKvStore(chrome.storage.local) both backed by the same storage area; wired in packages/extension-chrome/src/sw.ts lines 39-40 | c3-201 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every valid inbound wire message is handled by the router and answered; invalid or foreign messages are rejected before reaching the domain | rule-gate-runtime-messages |
| Primary path | classifyInbound(msg, sender.id, chrome.runtime.id) returns { action: 'process', msg }; router(msg) resolves; sendResponse(reply) is called; listener returns true to keep channel open; see packages/extension-chrome/src/sw.ts lines 48-67 | c3-111 |
| Alternate path — ignored | decision.action === 'ignore' (messages not addressed to SW); listener returns false immediately; see packages/extension-chrome/src/sw.ts line 51 | rule-gate-runtime-messages |
| Alternate path — rejected | decision.action === 'reject' (foreign sender or malformed message); sendResponse(decision.reply) called with pre-formed error reply; see packages/extension-chrome/src/sw.ts lines 52-54 | rule-gate-runtime-messages |
| Alternate path — env key | ENV_API_KEY is non-empty (personal build); readFullSettings() is never called for key resolution; options page field is locked | rule-api-key-isolation |
| Failure — router throws | Caught in .catch; mapError({ kind: 'thrown', error: e }) converts to a typed error reply; sendResponse called with ok: false; see packages/extension-chrome/src/sw.ts lines 59-65 | rule-typed-errors |
| Side effect at startup | chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }) called once at module load; error swallowed if API absent; see packages/extension-chrome/src/sw.ts line 70 | c3-212 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-gate-runtime-messages | rule | classifyInbound check before every router() call; sender.id compared to chrome.runtime.id | Mandatory | Prevents foreign pages from invoking the Gemini client |
| ref-dependency-injection | ref | buildRouter(...) is the single composition point for c3-111 and c3-114; no adapter is constructed elsewhere in SW scope | Primary | The lookup clients, selector, and all storage adapters are passed in, not imported by the router |
| rule-api-key-isolation | rule | readFullSettings() is the only call site that reads full Settings including apiKey; no other module in this bundle receives it | Mandatory | getApiKey lambdas are captured in the client closures (Gemini env-define wins for Gemini only; the OpenAI key always comes from stored settings); keys never serialised into a reply |
| rule-typed-errors | rule | Thrown errors are converted via mapError before being sent as wire replies | Mandatory | Ensures content script receives a structured WireReply not a raw exception |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| chrome.runtime.onMessage listener | IN | Receives all runtime messages; delegates to classifyInbound then router; returns true for async responses | Chrome MV3 messaging boundary | packages/extension-chrome/src/sw.ts |
| buildRouter (c3-111) | OUT | Called once at module load with fully wired adapters; returns the router function used in the listener | packages/app/src/lookup-router.ts | packages/extension-chrome/src/sw.ts |
| readFullSettings() | IN/OUT | Private async function; reads full Settings from chrome.storage.local; called by getApiKey and readToggles | Internal to sw.ts | packages/extension-chrome/src/sw.ts |
| GEMINI_API_KEY | IN | Build-time string define; captured as ENV_API_KEY; wins over stored key when non-empty | esbuild define boundary | packages/extension-chrome/src/build-defines.d.ts |
| chrome.sidePanel.setPanelBehavior | OUT | One-time startup call configuring panel to open on toolbar click only | Chrome sidePanel API | packages/extension-chrome/src/sw.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| apiKey leaks into a wire reply | Modifying the router's reply serialisation or readFullSettings result forwarding | TypeScript compile error if reply type widens to include apiKey | bun run --filter @ai-dict/extension-chrome typecheck |
| Foreign messages reach the router | Removing or weakening the classifyInbound gate | E2E message-forgery scenario fails; rule-gate-runtime-messages violated | bun run --filter @ai-dict/extension-chrome e2e |
| buildRouter receives wrong adapter types | Swapping adapter constructors or removing a required key from the options object | TypeScript compile error at the buildRouter(...) call site in sw.ts | packages/extension-chrome/test/manifest.test.ts |
| ENV key override breaks stored-key path | Changing the ENV_API_KEY fallback short-circuit in getApiKey | Stored-key lookup stops working when env is empty; detected by integration run | bun run --filter @ai-dict/extension-chrome test |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| sw.js bundle | Business Flow | Build variant may embed a non-empty GEMINI_API_KEY for personal builds | packages/extension-chrome/src/manifest.json |
| Manifest background entry | Parent Fit | N.A - must match sw.js filename and "type": "module" exactly; MV3 requires module SW | packages/extension-chrome/src/manifest.json |
| build-defines.d.ts type declarations | Contract | N.A - must declare all esbuild define keys used in sw.ts and options.ts or TypeScript errors result | packages/extension-chrome/src/build-defines.d.ts |
