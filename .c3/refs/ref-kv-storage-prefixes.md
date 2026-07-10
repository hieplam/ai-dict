---
id: ref-kv-storage-prefixes
c3-seal: 7ba59369c3ab844cc766a37312547b7c038ee40b2fb234c176940bd1e69f910b
title: kv-storage-prefixes
type: ref
goal: Both platforms expose one flat key-value store. Standardize persistence so all key layout and eviction logic lives in the (testable) domain and the platform adapters stay dumb string stores — one cache/history implementation for both extensions.
---

## Goal

Both platforms expose one flat key-value store. Standardize persistence so all key layout and eviction logic lives in the (testable) domain and the platform adapters stay dumb string stores — one cache/history implementation for both extensions.

## Choice

A single `Storage` string-KV **port** with four methods (`getItem` / `setItem` / `removeItem` / `keys(prefix?)`); the **domain owns reserved key prefixes** — `cache:<hash>`, `history:<…>`, `saved:<word>`, and `nudge:<word>` (B7) plus index keys `cache:index` / `history:index` / `saved:index`. Adapters never interpret keys.

## Why

`chrome.storage.local` (Chrome) and the Safari equivalent are both flat maps, so putting the LRU index, hashing, and eviction in the domain means the logic is unit-tested once with a fake `Storage` and reused verbatim on both platforms. Prefixes give cheap namespaced enumeration (`keys('cache:')`) for bulk clears without a separate scan. Alternative rejected: per-platform storage logic — duplicated, and untestable without a browser.

## How

Literal from `packages/app/src/domain/cache-policy.ts`:

```ts
const INDEX_KEY = 'cache:index';                  // REQUIRED: reserved index key
await deps.storage.setItem(`cache:${hash}`, ...); // REQUIRED: every key is prefixed

export async function cacheClear(deps: CacheDeps): Promise<void> {
  for (const k of await deps.storage.keys('cache:')) await deps.storage.removeItem(k);
}
```

The `Storage` port (`packages/app/src/ports.ts`) is the only contract an adapter implements; see `ref-core-dependency-rule`.
