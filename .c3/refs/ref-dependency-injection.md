---
id: ref-dependency-injection
c3-seal: c348432f3cee53408468f14cbfbfb7c660512456e9cc63c017495067b561db7b
title: dependency-injection
type: ref
goal: 'Keep the core pure and every side effect substitutable, so the same units run in a content script, a service worker, and a plain-Node test. The recurring need: no unit reaches for a global (`chrome`, `fetch`, the clock) directly.'
---

## Goal

Keep the core pure and every side effect substitutable, so the same units run in a content script, a service worker, and a plain-Node test. The recurring need: no unit reaches for a global (`chrome`, `fetch`, the clock) directly.

## Choice

**Constructor / parameter injection through an explicit `Deps` object.** Every unit receives its ports *and* its ambient capabilities (`now`, `fetch`, `getApiKey`) as arguments — `WorkflowDeps`, `RouterDeps`, `GeminiDeps`, `CacheDeps` — with production defaults applied only at the edge.

## Why

The core has to be deterministic in three environments that are hostile to test (DOM, MV3 service worker, Node). Injecting ports plus the clock and I/O lets a test pass fakes and assert on recorded calls instead of mocking globals (`docs/knowledge-base/hexagonal-architecture.md` → *Why it helps testing*). Reaching for `Date.now()` or `fetch` inside a policy would make it non-deterministic and couple it to a platform, breaking `ref-core-dependency-rule`.

## How

Literal from `packages/app/src/domain/cache-policy.ts` — inject the clock, default it at the boundary:

```ts
export interface CacheDeps {
  storage: Storage;     // REQUIRED: a port, never chrome.storage directly
  cap?: number;         // OPTIONAL: production default applied below
  now?: () => number;   // REQUIRED for determinism: tests pass a fake clock
}
const now = deps.now ?? Date.now; // default only at the edge
```

And `packages/app/src/app/gemini-lookup-client.ts`: `GeminiDeps { fetch, getApiKey, timeoutMs? }` — the real `fetch` and key lookup are injected by `sw.ts`, while tests pass a fake `fetch`.
