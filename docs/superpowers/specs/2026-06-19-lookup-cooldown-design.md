# Lookup cooldown — pace rapid Define clicks to stop Gemini spam errors

**Date:** 2026-06-19
**Status:** Approved (design)
**Component:** `c3-1` app — `packages/app/src/domain/workflow.ts` (+ `domain/error-mapper.ts`)

## Problem

During testing, clicking **Define** rapidly across many words fires a burst of
lookups at Gemini and the provider starts returning errors "a lot" (HTTP 429 /
`RESOURCE_EXHAUSTED`).

Today `runLookupWorkflow` already `abort()`s the previous in-flight request when a
new lookup starts, so it is **not** true concurrency inside one tab. The 429s come
from rapid **sequential** lookups: each aborted request has usually already reached
Google, and they accumulate against Gemini's per-minute quota.

## Goal

Add a ~2-second cooldown so a human spamming Define cannot hammer the provider —
**first come, first served**: the first lookup fires immediately, and a second
lookup that arrives within the window is **blocked with a short message** instead of
firing.

Non-goals (YAGNI): no request queue, no exponential backoff, no user-facing setting,
no global cross-tab coordination.

## Decisions (locked during brainstorming)

| Question         | Decision                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pacing semantics | **Cooldown-reject.** First fires instantly; a follow-up within the window is dropped + a message shown. Nothing is queued. |
| Scope            | **Per tab**, in `runLookupWorkflow` (content-script workflow), next to the existing abort logic.                           |
| Window           | **2000 ms**, a single named constant.                                                                                      |
| Message          | New `mapError` case so error construction stays centralized (`rule-typed-errors`).                                         |

## Design

### Where

The cooldown gate lives in the `lookup-click` handler inside `runLookupWorkflow`,
**before** `runLookup` is invoked. This placement is load-bearing: `runLookup` begins
with `inFlight?.abort()`, so gating _before_ it guarantees a blocked second click does
**not** abort the in-flight first request (preserving first-come-first-served).

### Logic (no timers — a timestamp compare)

Because nothing is queued, no `setTimeout`/scheduling is needed: just compare the
current time to the last time a lookup fired.

```
let lastFireAt = -Infinity            // module-local to the workflow closure

on Define click (e):
  const t = now()
  if (t - lastFireAt < COOLDOWN_MS) {  // too fast
     trigger.hide()                     // dismiss THIS trigger's spinner
     renderer.renderError(mapError({ kind: 'cooldown' }))
     return                             // do NOT fire, do NOT abort the first
  }
  lastFireAt = t                        // record the fire (only on a real fire)
  runLookup(e)                          // unchanged from today
```

`COOLDOWN_MS = 2000`, defined as a named constant at the top of `workflow.ts`.

### The message

Add `{ kind: 'cooldown' }` to `ErrorInput` in `domain/error-mapper.ts`, mapping to:

```ts
{ code: 'RATE_LIMIT', message: 'Slow down — wait a moment before the next lookup.', retryable: true }
```

- Reuses the existing `RATE_LIMIT` code (semantically "you are being rate-limited",
  just locally) so no new `LookupErrorCode` ripples through telemetry / card rendering.
- Uses **distinct wording** from the provider 429 message ("Hit Gemini rate limit.")
  so the reader understands this is pacing, not a Google failure.
- Renders through the existing error-card path (`renderer.renderError`) — no new UI.

### Testability — inject the clock

Add an **optional** `now?: () => number` to `WorkflowDeps`, defaulting to `Date.now`:

```ts
export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
  now?: () => number; // injectable clock; defaults to Date.now
}
```

This lets tests advance time deterministically without `vi.useFakeTimers()`, which
would clash with the existing `setTimeout`+`vi.waitFor` fakes. Because it is optional
with a default, **both composition roots (`extension-chrome/src/content.ts` and
`extension-safari/src/content.ts`) stay untouched** — `Date.now` is the runtime clock.

Domain purity (`rule-domain-purity`) is preserved: `Date.now` is a JS builtin, not
`chrome.*`/`fetch`/DOM, and injecting it as a dep is the more testable, hexagonal choice.

## Behavior / edge cases (all intentional)

1. **First-come-first-served preserved.** The blocked second click never aborts the
   first; the first request completes and its result renders, briefly replacing the
   "slow down" message. Accepted as a transient signal.
2. **Spamming does not extend the lockout.** `lastFireAt` updates only on a real fire,
   never on a blocked attempt — so the window is measured from the last fired lookup,
   and continuous spamming still lets a lookup through once the original 2 s elapses.
3. **Cache hits are also gated.** The content-script gate cannot see the service-worker
   cache, so a rapid repeat of a cached word also shows "slow down". Harmless — it never
   reaches Gemini anyway; the cost of the simple per-tab choice.
4. **No-key clicks count as a fire.** With no API key, the first click shows `NO_KEY`
   and a rapid second shows "slow down" instead. Negligible.
5. **2 s caps throughput at 30 req/min.** If Gemini's free tier (~10 RPM) still 429s,
   it is a one-constant bump — no setting is added.
6. **Consent footer.** In the Chrome shell, `renderError` also calls `maybeShowConsent()`,
   so this message can nudge the error-reporting consent footer once. Left as-is (the user
   declined to special-case it); it appears at most once and is dismissible.

## Testing

### Unit — `packages/app/test/workflow.test.ts` (extend harness with injectable `now`)

- **First lookup always fires** (cooldown does not block the very first click).
- **Blocks a second lookup within the window**: shows a `RATE_LIMIT`-coded error,
  does **not** call the client a second time, and does **not** abort the first signal.
- **Allows a second lookup after the window elapses** (advance `now` past 2000 ms).
- **Blocked attempts do not reset the window**: spam at t=0.5 s and t=1 s, then a real
  fire is allowed at t≥2 s (measured from the original fire, not the blocked clicks).

### Unit — `packages/app/test/error-mapper.test.ts`

- `mapError({ kind: 'cooldown' })` → `code: 'RATE_LIMIT'`, `retryable: true`, and the
  local wording (distinct from the 429 message).

### E2E evidence — `packages/extension-chrome/e2e`

A Playwright spec (project harness, `mockGemini`) that selects a word, clicks Define
twice rapidly, and asserts the second shows the "slow down" message while **only one**
mocked-Gemini request fired. Capture as the PR before/after video evidence.

## Files touched

- `packages/app/src/domain/workflow.ts` — cooldown gate, `COOLDOWN_MS`, optional `now` dep.
- `packages/app/src/domain/error-mapper.ts` — `cooldown` `ErrorInput` kind + mapping.
- `packages/app/test/workflow.test.ts` — harness `now` injection + 4 cases.
- `packages/app/test/error-mapper.test.ts` — 1 case.
- `packages/extension-chrome/e2e/*.spec.ts` — e2e evidence spec.

No composition-root, wire-protocol, or service-worker changes.
