---
id: c3-115
c3-seal: dca7430b1f81d763968ba06cf439c1c971d8da64efe6a86c29ddb3e10c7524dd
title: content-adapters
type: component
category: feature
parent: c3-1
goal: Provide the three content-script-side port adapters that bridge the browser DOM and the Chrome messaging bus to the dependency-free domain core.
uses:
    - ref-core-dependency-rule
    - ref-wire-protocol-validation
---

## Goal

Provide the three content-script-side port adapters that bridge the browser DOM and the Chrome messaging bus to the dependency-free domain core.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | content script |
| Public surface | DomSelectionSource, InlineBottomSheetRenderer, MessageRelayLookupClient, extractSentence, randomId, RuntimeLike |
| Implements ports | SelectionSource (c3-102), ResultRenderer (c3-102), LookupClient (c3-102) |
| Bundled into | packages/app/src/app/ — consumed by chrome content-script (c3-211) and safari content-script (c3-311) |
| Depends on | c3-116 markdown-sanitize (sanitizer DI), c3-117 ui-components (DOM elements mounted by renderer) |

## Purpose

These three classes are the only content-script-side implementations of the port interfaces defined in `packages/app/src/ports.ts`. `DomSelectionSource` listens for `mouseup` and `touchend` events, reads `window.getSelection()`, and emits a `SelectionEvent` carrying the selected text, the surrounding sentence (computed by `extractSentence`), the bounding-rect anchor, and the page URL and title. `InlineBottomSheetRenderer` creates or reuses a `<bottom-sheet>` / `<lookup-card>` pair in the host element's light DOM and drives the card's state via `replaceChildren` (not via the `.state` JS property) to work across the Chrome MV3 isolated-world boundary (Chromium bug 390807). `MessageRelayLookupClient` serialises a `lookup` `WireMessage` containing the request and a UUID, sends it to the service worker via `chrome.runtime.sendMessage`, and resolves or rejects with a typed `LookupResult` or `LookupError`. It does NOT own the lookup business logic, caching, or prompt construction — those live in the service worker (c3-110).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition — selection | A mouseup or touchend event fires on the injected Document; window.getSelection() is non-collapsed and non-whitespace; see packages/app/src/app/dom-selection-source.ts | c3-102 |
| Precondition — renderer host | The composition root (content.ts) has already called registerContentElements() so <bottom-sheet> and <lookup-card> are defined before InlineBottomSheetRenderer.ensureCard() runs | c3-117 |
| Precondition — relay | The service worker is reachable via chrome.runtime.sendMessage; crypto.getRandomValues is available (content scripts run on plain http://, so crypto.randomUUID() is absent); see packages/app/src/app/message-relay-lookup-client.ts | ref-wire-protocol-validation |
| Internal state — renderer | InlineBottomSheetRenderer holds sheet: HTMLElement │ null and card: LookupCard │ null; they are nulled on close() and reused across renderLoading / renderResult / renderError calls; see packages/app/src/app/inline-bottom-sheet-renderer.ts | c3-117 |
| Shared dependency — sanitizer | InlineBottomSheetRenderer receives (md: string) => SafeHtml as a caller-supplied DI parameter defaulting to sanitizeMarkdown; the trust boundary for SafeHtml is owned entirely by c3-116 | c3-116 |
| Wire format | MessageRelayLookupClient sends { type: 'lookup', req: LookupRequest, requestId: string } and accepts WireReply; parse failures reject with mapError({ kind: 'parse' }); see packages/app/src/app/message-relay-lookup-client.ts | ref-wire-protocol-validation |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome — selection | A SelectionEvent (text, sentence, anchor, url, title) is delivered to the registered callback; the teardown function returned by onSelection() removes both listeners; see packages/app/src/app/dom-selection-source.ts | c3-102 |
| Outcome — render | The <bottom-sheet> slides in over the page with the <lookup-card> showing the loading spinner, then the result or an error message; close() removes the sheet from the DOM; see packages/app/src/app/inline-bottom-sheet-renderer.ts | c3-117 |
| Outcome — lookup | MessageRelayLookupClient.lookup() resolves to a LookupResult on success or rejects with a LookupError-shaped Error (with code, message, retryable, nullable retryAfterSec) on failure; see packages/app/src/app/message-relay-lookup-client.ts | ref-wire-protocol-validation |
| Alternate path — abort | When an AbortSignal is passed to lookup(), aborting it sends { type: 'lookup.cancel', requestId } to the service worker before the pending promise settles; see packages/app/src/app/message-relay-lookup-client.ts | ref-wire-protocol-validation |
| Alternate path — null selection | If window.getSelection() is collapsed, empty, or whitespace-only, the defaultReader returns null and no SelectionEvent is emitted; covered by packages/app/test/app/dom-selection-source.test.ts | c3-102 |
| Failure — unexpected SW reply | If the service worker returns ok: true but type !== 'lookup' (e.g. type: 'settings'), the client rejects with a PARSE LookupError; covered by packages/app/test/app/message-relay-lookup-client.test.ts | ref-wire-protocol-validation |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | These adapters implement ports (c3-102) and may import DOM and chrome.* APIs; the domain core they call must never import back | primary | Enforced by the one-directional import structure; composition root injects concrete instances |
| ref-wire-protocol-validation | ref | MessageRelayLookupClient constructs and validates WireMessage / WireReply shapes | primary | WireReply is imported from ../index; parse failures use mapError from the same module |
| c3-117 | example | InlineBottomSheetRenderer mounts <bottom-sheet> and <lookup-card> from the ui-components layer | primary | Elements must be registered (via registerContentElements()) before the renderer is constructed |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| DomSelectionSource implements SelectionSource | IN | Constructor accepts a DocEvents (subset of Document) and a caller-supplied () => SelectionEvent │ null reader (defaults to defaultReader); onSelection(cb) returns a teardown function | Implements SelectionSource from packages/app/src/ports.ts | packages/app/src/app/dom-selection-source.ts — export class DomSelectionSource |
| extractSentence(full, selStart, selEnd): string | OUT | Pure function; returns the sentence surrounding [selStart, selEnd] bounded by ., !, ?; falls back to the full string when no boundary exists | No side effects; used by defaultReader inside DomSelectionSource | packages/app/test/app/dom-selection-source.test.ts — describe('extractSentence') |
| InlineBottomSheetRenderer implements ResultRenderer | IN | Constructor accepts host: HTMLElement and a caller-supplied sanitize: (md: string) => SafeHtml (defaults to sanitizeMarkdown); exposes renderLoading(), renderResult(r), renderError(e), close() | Implements ResultRenderer from packages/app/src/ports.ts; drives card via shared DOM to cross the MV3 isolated-world boundary | packages/app/src/app/inline-bottom-sheet-renderer.ts — export class InlineBottomSheetRenderer |
| MessageRelayLookupClient implements LookupClient | IN | Constructor accepts RuntimeLike and a caller-supplied genId: () => string (defaults to randomId); lookup(req, opts?) resolves LookupResult or rejects with a LookupError-shaped Error | Implements LookupClient from packages/app/src/ports.ts; speaks the WireMessage protocol | packages/app/src/app/message-relay-lookup-client.ts — export class MessageRelayLookupClient |
| randomId(): string | OUT | Returns a v4 UUID built from crypto.getRandomValues (safe on non-secure http:// pages where crypto.randomUUID is undefined) | Used as the defaulted genId in MessageRelayLookupClient | packages/app/test/app/message-relay-lookup-client.test.ts — 'default genId (randomId)' test |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Sentence-boundary regression | Changing TERMINATORS or extractSentence logic | Unit tests for extractSentence fail | bun run --filter @ai-dict/app test packages/app/test/app/dom-selection-source.test.ts |
| Cross-world rendering broken | Switching InlineBottomSheetRenderer.setState from replaceChildren to .state property setter | Tests asserting light-DOM content (not shadow content) fail | bun run --filter @ai-dict/app test packages/app/test/app/inline-bottom-sheet-renderer.test.ts |
| UUID generation failure on http:// | Replacing randomId with crypto.randomUUID() | Regression test 'default genId (randomId)' fails in a non-secure context | bun run --filter @ai-dict/app test packages/app/test/app/message-relay-lookup-client.test.ts |
| WireMessage protocol drift | Changing the { type: 'lookup' } message shape | Type-check errors on WireReply imports and test 'posts {type:lookup, req, requestId}' fails | bun run --filter @ai-dict/app typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit test suite | Contract | Tests may inject fakes for DocEvents, reader, sanitize, and RuntimeLike; the as SafeHtml cast in test stubs is explicitly called out as test-only | packages/app/test/app/dom-selection-source.test.ts, packages/app/test/app/inline-bottom-sheet-renderer.test.ts, packages/app/test/app/message-relay-lookup-client.test.ts |
| Chrome content-script composition root | Contract | Chrome-specific chrome.runtime is injected as RuntimeLike; otherwise identical contract | c3-211 |
| Safari content-script composition root | Contract | Safari WebExtension messaging bridge is injected as RuntimeLike; same port contract, different platform runtime | c3-311 |
