---
id: c3-118
c3-seal: da5b9383e79d00aa03974171674ca31c7e960a34fbcdafece36b27722b9fe704
title: saved-words-policy
type: component
category: feature
parent: c3-1
goal: |-
    Provide a pure, KV-backed domain policy for saving/unsaving individual words into a permanent,
    independent vocabulary (B1) using the owner-ratified `SavedWordEntry` shape (escalation E1), so
    the router can invoke it without any platform dependency.
uses:
    - ref-dependency-injection
    - ref-kv-storage-prefixes
    - rule-domain-purity
---

## Goal

Provide a pure, KV-backed domain policy for saving/unsaving individual words into a permanent,
independent vocabulary (B1) using the owner-ratified `SavedWordEntry` shape (escalation E1), so
the router can invoke it without any platform dependency.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | service worker |
| Public surface | savedWordUpsert, savedWordDelete, savedWordGet, savedWordsList, savedWordsClear, normalizeWordKey, SavedWordsDeps, SavedWordInput |
| Bundled into | packages/app/src/domain/saved-words-policy.ts |
| Depends on | c3-102 Storage port; c3-101 SavedWordEntry/SavedWordSense/SavedWordStatus types |
| Consumed by | c3-111 (lookup-router) which calls these functions for the saved.save/saved.delete wire messages |

## Purpose

Owns the KV key-space under the `saved:*` prefix over the `Storage` port, independent of
`cache:*` (c3-112's cache half) and `history:*` (c3-112's history half) — clearing history or
cache never touches `saved:*` and vice versa (roadmap B1 scope fence). `word` is the
case-insensitive unique key (`normalizeWordKey` = trim + lowercase), so re-saving an
already-saved word upserts the SAME entry rather than creating a duplicate. It does NOT perform
network calls, does NOT touch `chrome.storage` directly (the `Storage` port abstracts that), and
does NOT implement B14's future multi-sense merge (a re-save REPLACES `senses[0]` — last-write-
wins) or B5's status-lifecycle UI (it only defaults/preserves `status`).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A SavedWordsDeps struct with a concrete Storage implementation must be supplied by the router | ref-dependency-injection |
| Key derivation | normalizeWordKey (in packages/app/src/domain/saved-words-policy.ts) trims and lowercases the word so "Bank" and "bank" collide on the same saved:<key> entry | ref-kv-storage-prefixes |
| Index | saved:index stores a JSON array of normalized keys (new-first), written by savedWordUpsert on first save and pruned by savedWordDelete; read by savedWordsList | ref-kv-storage-prefixes |
| Determinism injection | SavedWordsDeps.now (() => number) is injected so tests can control the savedAt timestamp without real time | ref-dependency-injection |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| First save | savedWordUpsert with no existing saved:<key> entry writes status:'learning', savedAt:now(), senses:[sense], and prepends the key to saved:index (verified in packages/app/test/saved-words-policy.test.ts) | c3-111 |
| Re-save (idempotent upsert) | savedWordUpsert on an existing key preserves status/savedAt from the stored entry but REPLACES senses with the fresh single-entry array (last-write-wins; B14's future job is a real multi-sense merge) (verified in packages/app/test/saved-words-policy.test.ts) | rule-domain-purity |
| Delete | savedWordDelete removes saved:<key> and prunes the key from saved:index; idempotent on an unknown word (verified in packages/app/test/saved-words-policy.test.ts) | ref-kv-storage-prefixes |
| Get / List | savedWordGet reads one entry (null on miss); savedWordsList reads every entry via the index, in index order (verified in packages/app/test/saved-words-policy.test.ts) | c3-111 |
| Clear | savedWordsClear calls storage.keys('saved:') and removes every matching key including saved:index; never invoked by historyClear/cacheClear (scope fence, verified in packages/app/test/app/router.test.ts and packages/extension-chrome/e2e/saved-word.spec.ts) | ref-kv-storage-prefixes |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-kv-storage-prefixes | ref | Domain owns the saved: key prefix (and saved:index sub-entry) over the Storage port; no other component writes this prefix | high | Independent of cache:/history: — the B1 roadmap scope fence |
| ref-dependency-injection | ref | SavedWordsDeps.now is injected for deterministic savedAt in tests | high | Mirrors CacheDeps.now / HistoryDeps.cap |
| rule-domain-purity | rule | saved-words-policy.ts imports only ../ports (Storage) and ./types; no chrome.*, no fetch, no DOM | high | Verified: imports in saved-words-policy.ts |
| N.A - owner escalation E1, not a C3 entity | N.A - <reason> | The persisted SavedWordEntry shape (word/status/savedAt/senses[]) is ratified by the owner and non-negotiable; this component is the only writer of it | high | docs/superpowers/specs/2026-07-10-b1-save-word-design.md |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| savedWordUpsert(deps, input) | IN | Writes saved:<normalizeWordKey(word)>, preserves status/savedAt on re-save, replaces senses; returns the persisted SavedWordEntry | Service worker / router (saved.save) | packages/app/src/domain/saved-words-policy.ts — export async function savedWordUpsert |
| savedWordDelete(deps, word) | IN | Removes the single saved:<key> and prunes it from saved:index; no-op when absent | Service worker / router (saved.delete) | packages/app/src/domain/saved-words-policy.ts — export async function savedWordDelete |
| savedWordGet(deps, word) | OUT | Returns the stored SavedWordEntry, or null when missing | Future consumer (e.g. B4 hover-recall) | packages/app/src/domain/saved-words-policy.ts — export async function savedWordGet |
| savedWordsList(deps) | OUT | Returns every saved entry via the index | Future consumer (B6 Words page) | packages/app/src/domain/saved-words-policy.ts — export async function savedWordsList |
| savedWordsClear(deps) | IN | Removes all saved:* keys including saved:index | Future consumer (e.g. a settings "clear saved words" action) | packages/app/src/domain/saved-words-policy.ts — export async function savedWordsClear |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Ratified schema drift | Renaming/adding/dropping a field on SavedWordEntry or SavedWordSense | Compile-time AssertEqual guard in packages/app/src/wire.ts fails; z.strictObject rejects extra keys | bun run --filter @ai-dict/app typecheck; bun run --filter @ai-dict/app test packages/app/test/wire-schema.test.ts |
| Key-prefix collision | Renaming the saved: prefix or its index key | savedWordsClear leaves orphan keys; historyClear/cacheClear scope-fence regression test fails | packages/app/test/app/router.test.ts — 'history.clear and cache.clear never touch saved:*' |
| Re-save silently resets status/savedAt | Changing savedWordUpsert to always overwrite status/savedAt instead of preserving them | Test 'upsert on an existing word preserves savedAt/status' fails | packages/app/test/saved-words-policy.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests | Contract | In-memory Storage stub used instead of real chrome.storage | packages/app/test/saved-words-policy.test.ts |
| Router saved.save/saved.delete handlers | Contract | None — router.ts calls these functions directly through the WriteQueue | packages/app/src/app/router.ts |
| Chrome e2e coverage | Contract | Chrome-specific extension build; proves the ratified shape persists correctly in a real chrome.storage.local | packages/extension-chrome/e2e/saved-word.spec.ts |
