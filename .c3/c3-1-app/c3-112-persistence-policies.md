---
id: c3-112
c3-seal: db29d66205b7d91ed3b19e84e0fc7a0db82ba82549a185cead97e790f2e06c4a
title: persistence-policies
type: component
category: feature
parent: c3-1
goal: Provide pure, KV-backed domain policies for result caching (LRU, cap 1000) and lookup history (FIFO, cap 500) that the service-worker router can invoke without any platform dependency.
uses:
    - ref-dependency-injection
    - ref-kv-storage-prefixes
    - rule-domain-purity
---

## Goal

Provide pure, KV-backed domain policies for result caching (LRU, cap 1000) and lookup history (FIFO, cap 500) that the service-worker router can invoke without any platform dependency.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | cacheGet, cachePut, cacheClear, CacheDeps, deriveCacheKey, fnv1a64Hex (cache-policy); historyAppend, historyList, historyClear, HistoryDeps, HistoryPage (history-policy) |
| Bundled into | packages/app/src/domain/cache-policy.ts and packages/app/src/domain/history-policy.ts |
| Depends on | c3-102 Storage port; c3-101 LookupResult and HistoryEntry types |
| Consumed by | c3-111 (lookup-router) which calls these functions after a successful lookup |

## Purpose

Owns the KV key-space under `cache:*` and `history:*` prefixes over the `Storage` port, implementing LRU eviction (access-time index at `cache:index`) for the result cache and newest-first FIFO eviction (id index at `history:index`) for the history log. It does NOT perform network calls, does NOT touch `chrome.storage` directly (the `Storage` port abstracts that), and does NOT govern settings or API-key storage.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A CacheDeps or HistoryDeps struct with a concrete Storage implementation must be supplied by the router | ref-dependency-injection |
| Cache key derivation | deriveCacheKey (in packages/app/src/domain/cache-policy.ts) normalises word (trim + lowercase) and context (trim), pipes them as word│context│target then hashes with fnv1a64Hex (FNV-1a 64-bit, BigInt) | ref-kv-storage-prefixes |
| Cache index | cache:index stores a JSON array of {key, atime} entries sorted ascending by atime; LRU is the head element; written by cachePut and read by cacheGet in packages/app/src/domain/cache-policy.ts | ref-kv-storage-prefixes |
| History index | history:index stores a JSON array of entry ids newest-first; append prepends the new id; written and read by functions in packages/app/src/domain/history-policy.ts | ref-kv-storage-prefixes |
| Determinism injection | CacheDeps.now (() => number) and CacheDeps.cap are injected so tests can control timestamps and cap without real time or storage | ref-dependency-injection |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Cache hit | cacheGet hashes the request, reads cache:<hash>, on hit updates atime in the index and returns the stored result with fromCache: true (verified in packages/app/test/cache-policy.test.ts) | ref-kv-storage-prefixes |
| Cache miss | cacheGet returns null; the router then calls the Gemini client and follows with cachePut (verified in packages/app/test/cache-policy.test.ts) | c3-111 |
| LRU eviction | After cachePut with 1001 entries (default cap 1000), the entry with the smallest atime is removed from storage and dropped from the index (verified in packages/app/test/cache-policy.test.ts) | rule-domain-purity |
| Cache clear | cacheClear calls storage.keys('cache:') and removes every matching key including cache:index (verified in packages/app/test/cache-policy.test.ts) | ref-kv-storage-prefixes |
| History append | historyAppend writes history:<id>, prepends the id to the index, and pops the oldest id when the index exceeds cap (default 500) (verified in packages/app/test/history-policy.test.ts) | ref-kv-storage-prefixes |
| History paginate | historyList reads the index newest-first, slices by limit from cursor position; returns nextCursor when more entries remain (verified in packages/app/test/history-policy.test.ts) | c3-111 |
| Stale cursor | A cursor that no longer appears in the index (evicted or cleared) returns an empty page without error (verified in packages/app/test/history-policy.test.ts) | c3-1 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-kv-storage-prefixes | ref | Domain owns cache: and history: key prefixes over the Storage port; no other component writes these prefixes | high | cache:index and history:index are sub-entries within those namespaces |
| ref-dependency-injection | ref | CacheDeps.now and CacheDeps.cap are injected for determinism; HistoryDeps.cap likewise | high | Lets tests supply a monotonic counter for now and a small cap |
| rule-domain-purity | rule | Both files import only ../ports (Storage) and ./types; no chrome.*, no fetch, no DOM | high | Verified: imports in cache-policy.ts and history-policy.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| cacheGet(deps, req) | OUT | Returns LookupResult with fromCache: true on hit, null on miss; updates atime in index | Service worker / router | packages/app/src/domain/cache-policy.ts — export async function cacheGet |
| cachePut(deps, req, result) | IN | Writes result under cache:<hash>, appends to index, evicts LRU entries beyond cap | Service worker / router | packages/app/src/domain/cache-policy.ts — export async function cachePut |
| cacheClear(deps) | IN | Removes all cache:* keys including cache:index | Extension options page or router | packages/app/src/domain/cache-policy.ts — export async function cacheClear |
| historyAppend(deps, entry) | IN | Persists HistoryEntry under history:<id>, maintains newest-first index, evicts oldest beyond cap | Service worker / router | packages/app/src/domain/history-policy.ts — export async function historyAppend |
| historyList(deps, opts) | OUT | Returns HistoryPage with entries and caller-supplied cursor for pagination; reads index newest-first | Extension options / popup page | packages/app/src/domain/history-policy.ts — export async function historyList |
| historyClear(deps) | IN | Removes all history:* keys including history:index | Extension options page | packages/app/src/domain/history-policy.ts — export async function historyClear |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| DEFAULT_CAP regression (cache) | Changing the 1000 constant in cache-policy.ts | Test evicts at the default cap of 1000 catches the old entry as non-null | bun run --filter @ai-dict/app test packages/app/test/cache-policy.test.ts |
| DEFAULT_CAP regression (history) | Changing the 500 constant in history-policy.ts | Test default cap is 500 expects exactly 500 entries after 501 appends | bun run --filter @ai-dict/app test packages/app/test/history-policy.test.ts |
| Key-prefix collision | Renaming cache: or history: prefixes | cacheClear and historyClear leave orphan keys; other components pollute the namespace | bun run --filter @ai-dict/app typecheck |
| fromCache flag logic | Altering the flag handling in cacheGet/cachePut | Round-trip test round-trips put → get with fromCache flipped true fails | packages/app/test/cache-policy.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Cache unit tests | Contract | In-memory Storage stub used instead of real chrome.storage | packages/app/test/cache-policy.test.ts |
| History unit tests | Contract | In-memory Storage stub; cap kept small for speed | packages/app/test/history-policy.test.ts |
| Chrome storage adapter | Contract | Chrome-specific chrome.storage.local implementation | c3-201 |
