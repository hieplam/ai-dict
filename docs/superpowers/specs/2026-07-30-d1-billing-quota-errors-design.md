# D1 — Correct billing/quota-exhaustion errors for OpenAI & Anthropic (design)

**Card:** D1 (`docs/ROADMAP.md` §4, Category D). **P0 bug fix**, added 2026-07-30, dispatched
directly (not via full roadmap ideation). Decision Log entries: `docs/ROADMAP.md` §8, 4 entries
dated 2026-07-30 (new `BILLING` code; onboarding rollback — **corrected 2026-07-30**, see below;
no CTA; no change to `lookup-client-selector.ts`).

## 1. The problem (grounded in code)

Today, `packages/app/src/domain/error-mapper.ts`'s `mapError` (`http` arm, lines 70-98) has no
case for billing/quota exhaustion:

- **Anthropic**, a valid-but-unfunded key: `HTTP 400` + body
  `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too
low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase
credits."}}`. No arm matches (`status===400` only fires when `geminiStatus==='INVALID_ARGUMENT'`,
  a Gemini-shaped field never populated by the Anthropic client) → falls to line 97's
  `return { code: 'UNKNOWN', message: sanitize('HTTP 400'), retryable: false }`. The user reads
  the literal string **"HTTP 400."**
- **OpenAI**, same account state: `HTTP 429` + body `{"error":{"message":"You exceeded your
current quota...","type":"insufficient_quota","code":"insufficient_quota"}}`. The `status ===
429` arm (line 88) matches unconditionally → `{ code: 'RATE_LIMIT', message: 'Hit OpenAI rate
limit.', retryable: true }`. **Actively wrong**: a dead quota can never succeed on retry, yet
  `retryable: true` invites one.
- **Contrast** (proves the keys are fine, this is not an `INVALID_KEY` case): a genuinely bad key
  gets `401` on both providers (`"API key is invalid."` / `error.code: 'invalid_api_key'`) — a
  different, already-correct shape (`INVALID_KEY`, mapper lines 77-87).
- **Plumbing gap:** `packages/app/src/app/openai-lookup-client.ts`'s `parseErr` (lines 38-41)
  forwards only `error.message` as `vendorMessage` — it drops `error.code`, so the mapper cannot
  see `insufficient_quota` even once it has an arm for it. Anthropic's client already forwards
  `error.type` as `vendorStatus` (`anthropic-lookup-client.ts:44-49`); OpenAI needs the same.
- **UI consequence** (`packages/extension-chrome/src/options.ts`'s `mountOnboarding`, lines
  254-349): the unconditional rollback (`chrome.storage.local.set({ settings: cur })`, line 298)
  fires on every non-ok `connection.test` reply. The escape hatch on top of it —
  `view.showSaveAnyway(true)` — is gated to `r.error.code === 'NETWORK'` only (line 300), so today
  a billing failure both rolls back the just-tested, verified-valid key **and** offers no way to
  keep it: the user is stranded on the onboarding screen reading "HTTP 400" with no forward path
  (retrying "Save & activate" will fail again — billing never resolves by itself).

## 2. The fix — new `LookupErrorCode: 'BILLING'`

A billing/quota-exhaustion classification, detected per-provider from the verified shapes above,
that (a) tells the truth instead of "HTTP 400" or a bogus retryable rate limit, and (b) lets a
verified-valid key survive onboarding.

### 2.1 Wire protocol (ordinary evolution, not an E1/E2-style escalation)

- `packages/app/src/domain/types.ts:112-118` — add `'BILLING'` to the `LookupErrorCode` union.
- `packages/app/src/wire.ts:11` — add `'BILLING'` to `LookupErrorSchema`'s `code` enum.
- `packages/app/wire-schema.snapshot.json` — regenerated (the snapshot test uses
  `toMatchFileSnapshot`; running the suite with `-u` rewrites it).
- Decision Log ruling (2026-07-30): this is an error-code enum on an in-flight reply, not
  persisted user data — same reasoning as the 2026-07-10 ruling on optional wire fields. No
  escalation.

### 2.2 Detection — pure, in `domain/error-mapper.ts` (the pure core; no new dependency)

Two independent, provider-specific checks, both evaluated before the existing `INVALID_KEY`/
`RATE_LIMIT` arms so a quota-exhaustion response is never miscaught by them:

1. **OpenAI — unambiguous, use directly:** `vendorStatus === 'insufficient_quota'` (OpenAI's
   `error.code`, forwarded by the client per §2.3). No status check needed — the code alone is
   unambiguous.
2. **Anthropic — status + type alone are NOT sufficient** (the card's own warning: `400` +
   `invalid_request_error` also fires for ordinary malformed requests). Detection requires the
   message content too: `status === 400 && vendorStatus === 'invalid_request_error' &&
/credit balance|billing/i.test(vendorMessage)`. The regex is anchored to the two phrases the
   verified real message actually contains ("credit balance", "Plans & Billing"), so an unrelated
   400 (e.g. a genuinely malformed request) does not false-positive into `BILLING`.

Both arms return `{ code: 'BILLING', retryable: false, message: <honest, provider-named copy> }`
— never "HTTP 400", never rate-limit wording. `retryable: false` is the load-bearing fix for
OpenAI: a dead quota can never succeed on retry.

Message wording (code-owned, not vendor free text, so it is not passed through `sanitize()` —
consistent with every other hand-written arm in the file):
`${product} account has no credits or billing set up. Add credits with ${vendor}, then try
again.` (`product`/`vendor` are the existing per-provider `NAMES` table entries, e.g. `Claude`/
`Anthropic`, `OpenAI`/`OpenAI`.)

### 2.3 Plumbing — `openai-lookup-client.ts` forwards `error.code`

`parseErr` currently returns only `{ vendorMessage }`. Widen it to match Anthropic's existing
pattern (`vendorStatus` from the provider-native field, `vendorMessage` from the free-text
field):

```ts
parseErr: (json) => {
  const err = (json as OpenAIErrBody).error;
  return {
    ...(err?.code !== undefined ? { vendorStatus: err.code } : {}),
    ...(err?.message !== undefined ? { vendorMessage: err.message } : {}),
  };
},
```

No change needed to `anthropic-lookup-client.ts` — it already forwards `error.type` as
`vendorStatus` (line 47), which is exactly what §2.2's Anthropic check reads.

### 2.4 Onboarding — `options.ts`'s `mountOnboarding` (CORRECTED per the Shaman's 2026-07-30 note)

**What is actually true in the code today** (verified, not assumed): the rollback
(`chrome.storage.local.set({ settings: cur })`, line 298) is **unconditional** — it fires for
every non-ok `connection.test` reply, NETWORK included. What is NETWORK-only is the escape hatch
_on top of it_: `view.showSaveAnyway(true)` (line 305), gated by `r.error.code === 'NETWORK'`
(line 300). Every other code — `BILLING` included — falls to the bare
`view.setStatus(r.error.message, 'error')` else-branch (line 307) with the key already discarded.

**The fix (my How call, picking the smaller/cleaner of the two options the correction offered):**
for `BILLING` specifically, **skip the rollback entirely** — the just-tested key (already
optimistically persisted before `connection.test`, per the existing comment at lines 270-273)
simply stays in `chrome.storage.local` — and still show the same `showSaveAnyway` escape-hatch
button (reused, not duplicated) so the user has a clear way to move into the Settings screen,
with billing-specific copy making clear the key **was already saved** and just needs billing set
up. This satisfies the corrected acceptance test directly: immediately after a `BILLING` failure,
`settings.anthropicApiKey` / `settings.openaiApiKey` in `chrome.storage.local` still holds the
pasted value — no click required.

Clicking "Save anyway" after a `BILLING` failure re-persists the identical value (idempotent —
harmless) and transitions to the Settings screen, exactly like the NETWORK path today. To keep
that transition's confirmation copy honest (not "Saved without testing — the connection could not
be reached", which is false for `BILLING` — the connection _was_ reached), `mountOnboarding` tracks
which reason opened the escape hatch (`'NETWORK' | 'BILLING' | null`, a closure variable local to
one `mountOnboarding` call) and picks the matching confirmation string. `NETWORK`'s existing exact
copy is preserved byte-for-byte (an existing e2e spec, `c2-verified-activation.spec.ts:68`, asserts
a substring of it) — only a new `BILLING` branch is added alongside it.

A genuine `INVALID_KEY` (or any other) failure is unaffected: the rollback still fires
unconditionally and no escape hatch appears — a bad key should never linger.

### 2.5 `lookup-card.ts` — no code change, verified by test

`lookup-card.ts`'s error-state renderer (lines 269-282) only special-cases `NO_KEY` (setup invite)
and `INVALID_KEY` (adds the "Fix key in Settings" CTA). Every other code, `BILLING` included,
already falls through to the generic `return [h, p]` — heading + message, no CTA. This is exactly
the card's "no CTA button" requirement, satisfied by the existing default with zero new code. A
regression-guard test is added to `lookup-card.test.ts` to make this explicit and pin it against
future drift.

### 2.6 Explicitly untouched (scope fence, restated)

- `lookup-client-selector.ts` — its any-failure fallback-pool semantics are unchanged; a `BILLING`
  failure on the user's explicitly chosen provider is still silently maskable by a successful
  fallback, exactly as today. Separate, later card.
- No new CTA / clickable billing-URL link anywhere.
- No telemetry/diag field changes — `httpStatus`/`vendorStatus`/`vendorMessage` already exist and
  already cross the wire; `BILLING` reuses them as-is.

## 3. Pure core / impure edges

- **Pure core:** `mapError`'s new `BILLING` detection is pure — same inputs, same output, no I/O,
  no clock, no randomness. It takes the already-parsed `{ status, vendorStatus, vendorMessage,
provider }` shape and returns a `LookupError` value. This is the one piece of "decision logic"
  this card adds, and it lives entirely in `domain/`.
- **Impure edges:** `openai-lookup-client.ts`/`anthropic-lookup-client.ts` (the HTTP fetch +
  response-body parsing — already impure, no change to that boundary, only to which fields
  `parseErr` extracts) and `options.ts` (the composition root owning `chrome.storage.local` I/O
  and the `connection.test` wire round-trip) — both already impure, no new decision logic is added
  to either beyond the existing `if/else` dispatch on `r.error.code`, which is edge-level flow
  control (branching on an already-computed value), not business logic.
- No new outside-world dependency is introduced by this card at all — no new port, no new
  abstraction needed.

## 4. Testing strategy

Every test is **mocked-fetch only**, using the card's exact verified response bodies as fixtures
(real account state, no keys inside — safe to commit). No live network call to any provider,
ever. The owner's real keys in `.env.local` are never read.

- `packages/app/test/error-mapper.test.ts` — pure `mapError` unit tests: both `BILLING` fixtures
  (Anthropic 400, OpenAI 429-with-code) classify `BILLING`/`retryable:false`/honest message; both
  `INVALID_KEY` fixtures (Anthropic 401, OpenAI 401) are **unchanged** (regression proof); an
  ordinary malformed-400 case (no "credit balance"/"billing" in the message) stays `UNKNOWN`,
  proving the Anthropic detection isn't a bare `400 + invalid_request_error` match.
- `packages/app/test/app/openai-lookup-client.test.ts` — end-to-end through the real client:
  the 429 `insufficient_quota` fixture → `BILLING`; the 401 `invalid_api_key` fixture → unchanged
  `INVALID_KEY`; a bare 429 with no body (existing test) stays `RATE_LIMIT` (regression).
- `packages/app/test/app/anthropic-lookup-client.test.ts` — end-to-end through the real client:
  the 400 credit-balance fixture → `BILLING`; the 401 fixture → unchanged `INVALID_KEY`. (No
  production change needed in this file's subject — `anthropic-lookup-client.ts` already forwards
  the needed fields; this test proves the mapper change alone is sufficient end-to-end.)
- `packages/app/test/wire-schema.test.ts` + regenerated `wire-schema.snapshot.json` — `BILLING`
  is a valid `WireReplySchema` error code; the snapshot is stable.
- `packages/app/test/ui/lookup-card.test.ts` — a `BILLING` error state renders the message with
  no CTA button (regression guard for §2.5).
- `packages/extension-chrome/e2e/d1-billing-quota-errors.spec.ts` (new) — the project's Playwright
  harness (mocked `mockOpenAI`/`mockAnthropic` routes, per `CLAUDE.md`'s browser-testing
  convention), covering the corrected acceptance test end-to-end: pasting a key that gets a
  `BILLING`-classified `connection.test` reply (a) shows the honest per-provider message (never
  "HTTP 400"/rate-limit wording), (b) leaves the pasted key present in `chrome.storage.local`
  immediately (no click needed), (c) still offers "Save anyway", which transitions to the Settings
  screen with honest (non-"connection could not be reached") copy.

## 5. Risk / rollback

Blast radius is small and additive: one new enum value threaded through 3 files + a snapshot, one
new `if` arm in a pure function, one widened object literal in `openai-lookup-client.ts`, and one
new `else if` branch (plus a small closure variable) in `options.ts`. No existing arm's condition
is weakened — the new `BILLING` checks are strictly additive guards evaluated before the existing
ones, and every existing fixture/behavior this card touches has an explicit regression test.
Revert is a straightforward `git revert` of the merge commit; nothing downstream (cache, history,
saved words, backups) ever stores a `LookupError`, so there is no persisted-data migration
concern either direction.
