---
id: adr-20260610-sidepanel-delete-cached-word
c3-seal: 0b99e1c46e0a8633879f18cbefbe1e7dc97c3a74ed1f10bb7c35b506a3402bb4
title: sidepanel-delete-cached-word
type: adr
goal: 'Add a per-entry **delete** affordance to the Chrome side panel''s "Recent" list so the reader can remove one looked-up word from persistence. Deleting an entry removes both the stored history row (`history:<id>`) and the cached definition (`cache:<hash>` derived from the entry''s `word`/`context`/`result.target`), so the next lookup of that exact selection misses the cache and re-queries Gemini with the *current* prompt template. The motivating use case: a reader edits the prompt template in Settings and wants to see the new definition for a word that is already cached — today the cache (LRU, cap 1000) keeps serving the old answer until "Clear cache" wipes everything.'
status: implemented
date: "2026-06-10"
---

## Goal

Add a per-entry **delete** affordance to the Chrome side panel's "Recent" list so the reader can remove one looked-up word from persistence. Deleting an entry removes both the stored history row (`history:<id>`) and the cached definition (`cache:<hash>` derived from the entry's `word`/`context`/`result.target`), so the next lookup of that exact selection misses the cache and re-queries Gemini with the *current* prompt template. The motivating use case: a reader edits the prompt template in Settings and wants to see the new definition for a word that is already cached — today the cache (LRU, cap 1000) keeps serving the old answer until "Clear cache" wipes everything.

## Context

The side panel (`packages/extension-chrome/src/side-panel.ts`, c3-212) renders `<side-panel-view>` (c3-117 surface in `packages/app/src/ui/side-panel-view.ts`) with a focus region plus a scrollable "Recent" section listing `HistoryEntry` rows fetched via the `history.list` wire message. Each row is a single `<button class="recent-item">` that re-shows the stored result; there is no per-entry removal anywhere — the only invalidation tools are the options page's whole-store `cache.clear` / `history.clear` buttons.

Caching lives entirely in the dependency-free domain (`packages/app/src/domain/cache-policy.ts`, c3-112): `deriveCacheKey({word, context, target})` → FNV-1a hash → `cache:<hash>` value plus an LRU `cache:index`. History lives in `history-policy.ts` (same component): `history:<id>` values plus a newest-first `history:index`. The service worker router (`packages/app/src/app/router.ts`, c3-111) is the only writer, and every inbound frame is schema-gated (`WireMessageSchema` in `packages/app/src/wire.ts`, ref-wire-protocol-validation / rule-gate-runtime-messages).

Constraints: the domain must stay platform-free (rule-domain-purity); all key layout stays in the domain (ref-kv-storage-prefixes); any new message must be added to the zod discriminated union and the `MessageTypeEnum` or the SW drops it; Safari has no side panel (c3-311) so this is Chrome-shell UI only, but domain/wire/router changes land in the shared core both shells consume.

A history row's stored `result` is itself a snapshot of the old definition, so deleting only the cache entry would leave a row that still re-shows the stale answer when clicked — the deletion must remove both stores to be coherent.

## Decision

One new wire message, `{ type: 'history.delete', id: string }`, handled by the shared router; the router resolves the entry server-side and deletes both stores. Concretely:

1. **Domain (c3-112):** add `historyGet(deps, id)` and `historyDelete(deps, id)` to `history-policy.ts` (remove `history:<id>` + prune `history:index`), and `cacheDelete(deps, req)` to `cache-policy.ts` (remove `cache:<deriveCacheKey(req)>` + prune `cache:index`). Pure KV operations, mirroring the existing `*Clear` style.
2. **Wire:** add `history.delete` to `WireMessageSchema` and `MessageTypeEnum`. Reply is the existing `ack` (or `ok:false` envelope). The frame carries only the opaque history id — the router derives the cache key from the *stored* entry (`word`, `context`, `result.target`), so a client cannot ask the SW to delete an arbitrary cache key it never proved exists.
3. **Router (c3-111):** `case 'history.delete'` → `historyGet`; if found, `cacheDelete({word, context, target: entry.result.target})` then `historyDelete(id)`, both through the existing `WriteQueue` (index read-modify-write must not interleave with `cachePut`/`historyAppend`). Missing id is a no-op ack (idempotent delete).
4. **UI (c3-117 `side-panel-view.ts`):** restructure `recentRow` — the `<li>` becomes a flex row holding the existing select button plus a separate icon button (nesting a button inside the existing row `<button>` is invalid HTML), labelled `Delete <word> from history and cache`, dispatching a composed `delete` CustomEvent `{id}`.
5. **Chrome shell (c3-212 `side-panel.ts`):** listen for `delete`, send `{type:'history.delete', id}` via `chrome.runtime.sendMessage`, then `refreshRecent()`. The focus region is left untouched (it is a transient mirror, not a store).

Why this shape wins: a single id-carrying message keeps the wire surface minimal and the trust boundary server-side; deleting both stores matches the user-visible mental model ("remove that word"); domain-level `*Delete` functions keep all key layout in c3-112 per ref-kv-storage-prefixes; Safari needs zero shell changes because the handler lives in the shared router and no Safari surface emits the event.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-112 | component | Gains cacheDelete, historyGet, historyDelete — new public-surface rows beside the existing get/put/clear policies | c3-112#n864@v1:sha256:38b5a0e1d46b8ecac7d6868cd530910a240286b5fb8cd88bd0d045836c61a791 "Provide pure, KV-backed domain policies for result caching (LRU, cap 1000) and lookup history (FIFO, cap 500) that the service-worker router can invoke without " | rule-domain-purity (no platform imports), ref-kv-storage-prefixes (key layout stays here) |
| c3-111 | component | New history.delete dispatch case orchestrating the two domain deletes via WriteQueue | c3-111#n803@v1:sha256:0312128582ffe1336c08965a9b04d0b4207d4e73cc35c96488fa48d2129045b2 "orchestrate cache and history persistence policies" | rule-gate-runtime-messages, rule-typed-errors (failure → toLookupError envelope) |
| c3-117 | component | <side-panel-view> recent rows gain a delete icon button and a composed delete CustomEvent | c3-117#n1150@v1:sha256:7c0219e85896f07f8fa10553cd4d3a3989f86577598fd794d738920794e23fec "Provide the complete set of framework-free custom elements and their supporting utilities that render the extension's in-page and options-page UI." | ref-web-components-shadow-dom (shadow-DOM, CSP-safe, composed events) |
| c3-212 | component | side-panel.ts wires the delete event to the new wire message and refreshes Recent on ack | c3-212#n1424@v1:sha256:34ef6dc4d9930fbd4c40bd9877c434d5a70b32f265f74c687a0611f5e99a7c77 "Provide the options page for persisting user settings and the side-panel page for displaying lookup results inside the Chrome extension UI." | ref-wire-protocol-validation (message matches schema), rule-api-key-isolation (no key surface touched) |
| c3-1 | container | Component-level deltas only; container responsibilities/membership unchanged — Parent Delta review required | c3-1#n548@v1:sha256:6a7590288584cbb1b3ef4e26491291ccdaf9ebd9aa0b05fdeffa5ac1026ba117 "The portable core of ai-dict: all lookup logic, the message contract, the persistence policies, and the shared UI — written once and bundled verbatim into bot" | Parent Delta: record updated-or-none with evidence |
| c3-2 | container | Component-level delta in c3-212 only; shell topology unchanged — Parent Delta review required | c3-2#n1218@v1:sha256:c820f0149f01cb95bbcdf6c162ae7833e40259f30adccc7ccfb000c74863f2ea "Package the ai-dict core as a Chrome Manifest V3 extension — a service worker, a content script, an options page, and a side panel — plus the Chrome-specifi" | Parent Delta: record updated-or-none with evidence |
| c3-3 | container | No side panel exists on Safari; the shared router gains the handler but no Safari surface sends the message | c3-3#n1485@v1:sha256:964fb0410a2aef92d49d92daa44a76e29a0fe106c29f1961c0a45c5fa49ebf21 "Package the ai-dict core as a Safari/iOS Manifest V3 web extension wrapped in an Xcode project — a service worker, a content script, and an options page — p" | No-delta evidence recorded in ADR |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-wire-protocol-validation | Adding a wire message requires updating the single authoritative zod union + MessageTypeEnum so the SW gate accepts it and error envelopes can name it | ref-wire-protocol-validation#n1776@v1:sha256:41648562e09cf88e96c5db74310339217ae9141873d4e7692381b58e31251d7f "validated at the boundary" | comply |
| ref-kv-storage-prefixes | Single-entry deletion touches cache:/history: key layout and their index keys — that layout is owned by domain policies, never by adapters or shells | ref-kv-storage-prefixes#n1756@v1:sha256:92cd41e633976cbc4833a33a7ebc5c2e7af9d071d38ee3bb949cb5b97a43f411 "domain owns reserved key prefixes" | comply |
| ref-dependency-injection | New domain fns take deps.storage like their siblings; router keeps receiving kv via RouterDeps — no global reaches | ref-dependency-injection#n1746@v1:sha256:609f1e1fcf6f6ff8cfda598bf6f56529476b6c5321ac363d0833bf5f76de3af8 "Every unit receives its ports" | comply |
| ref-web-components-shadow-dom | The delete button renders inside <side-panel-view>'s shadow tree, styled via the adopted constructable stylesheet (CSP-safe), event dispatched composed | ref-web-components-shadow-dom#n1766@v1:sha256:24e42949c63057e2b5886574165c255ab7694539db9d67154052ec3877126744 "Native custom elements in" | comply |
| ref-core-dependency-rule | All new logic lands in packages/app core; the Chrome shell only wires events to messages — dependency direction unchanged | ref-core-dependency-rule#n1733@v1:sha256:46eed452e95113074d0173cbd61d7fa39426de41c896c1f6216827d62e78512a "always pointing inward toward the domain" | review (no new ports; confirm direction only) |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-domain-purity | cacheDelete/historyGet/historyDelete live in packages/app/src/domain/ and must import nothing but ports/types | rule-domain-purity#n1804@v1:sha256:956ecf8ca8e807f94702b98c31d0f88b6325f691d3a0261e7de13b5a60da9837 "import only from" | comply |
| rule-gate-runtime-messages | The SW only acts on schema-valid frames; history.delete must be in WireMessageSchema or it is dropped — no ad-hoc message sniffing in the shell | rule-gate-runtime-messages#n1822@v1:sha256:09e20f9f35a9a662afe712b5b6c1651a6dfa841d5b0d7be2307c2f931cb46845 "and acts only when the decision is" | comply |
| rule-typed-errors | Router failure path for the new case must return the {ok:false, type:'history.delete', error} envelope through toLookupError, never throw raw | rule-typed-errors#n1856@v1:sha256:d5f82bbbd50529541e89c94a4efe838afea6cee7fc8e2191b85ddb01059d482a "flatten to a plain enumerable object before replying" | comply |
| rule-api-key-isolation | No settings/key surface is touched; the new message carries only a history id | rule-api-key-isolation#n1786@v1:sha256:f0c9317ff161e47f3ffb3561c4a122e0d112419b89309fbab6affb2d4cb5d85f "never enters a content script; only the service worker and the options page read or hold it." | review (confirm untouched) |
| rule-sanitize-model-output | Deletion renders no model markdown; existing focus rendering paths unchanged | rule-sanitize-model-output#n1839@v1:sha256:8e579f83ecbe8423ca8e017dc09c27d76823a54acd3191a5197d517e46f3f9db "no other code casts a string to" | N.A - no new markdown rendering path |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Domain tests first | Extend packages/app/test/cache-policy.test.ts (cacheDelete removes value + index row, no-op on miss) and packages/app/test/history-policy.test.ts (historyGet hit/miss, historyDelete removes value + index id, idempotent) | TDD per repo practice; existing suites cover the *Clear siblings |
| Domain impl | cacheDelete in packages/app/src/domain/cache-policy.ts; historyGet/historyDelete in packages/app/src/domain/history-policy.ts; export via packages/app/src/index.ts | mirrors cacheClear/historyClear shape |
| Wire schema | Add history.delete object to WireMessageSchema + MessageTypeEnum in packages/app/src/wire.ts; extend packages/app/test/wire-schema.test.ts | drift guard _checks unaffected (no domain type change) |
| Router | New case in packages/app/src/app/router.ts using WriteQueue; tests in packages/app/test/app/router.test.ts: deletes both stores, idempotent on unknown id, next lookup of deleted word calls client again | router orchestrates persistence per c3-111 |
| UI component | recentRow restructure + delete-button styles + delete event in packages/app/src/ui/side-panel-view.ts; tests in packages/app/test/ui/side-panel-view.test.ts (button renders per row, click dispatches delete with id, does NOT trigger select) | side panel view is the Recent list owner |
| Chrome shell | view.addEventListener('delete', …) in packages/extension-chrome/src/side-panel.ts → sendMessage history.delete → refreshRecent() | mirrors existing select listener wiring |
| C3 docs | Update c3-112 public surface, c3-111 message handling text, c3-117/c3-212 behavior text; record Parent Delta rows for c3-1/c3-2/c3-3 | Phase 3a contract cascade |
| Evidence | Before/After screenshots of side panel Recent rows via bundled Chromium; PR with same-origin github.com raw URLs on a pr-assets branch | repo CLAUDE.md conventions |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - this ADR changes application code and C3 entity docs only; no c3x CLI commands, validators, schemas, templates, hints, or CLI tests are touched | N.A - no underlay surface affected | N.A - c3 check green is the only required C3 evidence |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run test (vitest) | New unit tests fail if delete leaves the value, leaves the index row, breaks idempotency, or the UI stops dispatching delete | packages/app/test/{cache-policy,history-policy,wire-schema}.test.ts, test/app/router.test.ts, test/ui/side-panel-view.test.ts |
| WireMessageSchema gate in sw.ts | Any malformed history.delete frame (extra keys, missing id) is rejected before the router sees it | rule-gate-runtime-messages golden pattern |
| bun run typecheck + eslint only-throw-error | Router case must produce typed envelopes; domain fns must not import platform code (import-x boundaries) | repo lint/typecheck scripts |
| c3 check | Component doc edits must validate against canvases; Parent Delta recorded | C3 audit phase |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Delete cache entry only, keep the history row | The row's stored result is a snapshot of the stale definition — clicking it after deletion would still show the old answer, defeating the stated purpose (verify a new template) and reading as a bug |
| Wire message carries {word, context, target} from the client instead of the history id | Duplicates trust: the panel would assert cache-key parts the SW can't verify; id-only keeps the SW deriving the key from its own stored entry and matches the row the user actually clicked |
| Reuse cache.clear (tell users to wipe everything from Settings) | Already exists and is the current workaround; destroys all 1000 cached definitions and the whole point of the request is surgical invalidation while iterating on a template |
| Add a "bypass cache" re-lookup button instead of deletion | Would need a new lookup flag through wire + router + workflow and leaves the stale entry both in cache and Recent; bigger surface for the same outcome |
| Put the delete button on the focus card header | The focus card mirrors transient lookups (often not yet cached or from another page); the Recent row is the durable representation of "a word that is defined" the user scrolls — matches the request literally |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Index/value desync if delete interleaves with cachePut/historyAppend (SW writes are queued) | Router runs both deletes inside deps.queue.run(...) like every other write | router.test.ts asserts deletes go through the queue (order with a concurrent put) |
| Clicking delete accidentally triggers the row's select (re-shows the entry being deleted) | Delete is a sibling button, not nested; UI test asserts a delete click dispatches no select | side-panel-view.test.ts |
| Same word cached under a different context/target is NOT removed and still serves the old template's answer | Accepted scope: key = exact selection; documented in component doc + PR description so it isn't reported as a bug | manual e2e check in evidence flow (re-select same word/sentence) |
| Stale recent array in panel memory after delete | Shell always calls refreshRecent() after the ack | side panel manual evidence + code review |
| Safari shell silently gains an unused handler | Handler is inert without a sender; documented as no-delta for c3-3 | c3-311 doc unchanged; lint/typecheck cover shared code |

## Verification

| Check | Result |
| --- | --- |
| bun run test — all suites including new cache/history/wire/router/side-panel-view cases | PASS — 34 files, 320 tests (2026-06-10) |
| bun run typecheck && bun run lint | PASS — all three packages typecheck clean; eslint clean |
| bun run build:chrome | PASS — dist/side-panel.js 414.8kb |
| c3 check green after doc updates | PASS — only pre-existing c3-0 Goal warning remains (present before this ADR) |
| Playwright e2e (bundled Chromium, --headless=new): full suite incl. new side-panel-delete.spec.ts | PASS — 49 tests |
| Manual e2e flow proven by side-panel-delete.spec.ts: lookup → Recent row → delete → row gone → same selection re-queries Gemini (calls.count 1→2) and both stores empty | PASS |
| Before/After screenshots + flow GIF captured via e2e evidence specs; embedded in PR via same-origin github.com raw URLs on pr-assets branch | PASS — before-recent-no-delete.png / after-recent-with-delete.png / after-row-deleted.png / after-delete-flow.gif |
| Parent Delta | none for c3-1, c3-2, c3-0: component membership, container responsibilities, and topology unchanged — all deltas were component-internal (c3-111/c3-112/c3-117/c3-212 sections updated); none for c3-3: Safari ships no side panel and sends no history.delete |
