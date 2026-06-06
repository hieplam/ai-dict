---
id: rule-typed-errors
c3-seal: 87e021ce26eea03cb21cfd2581d626bb260b4352c5f288e16c961692ba2a2104
title: typed-errors
type: rule
goal: Enforce that failures are represented as typed `LookupError` values that satisfy the `@typescript-eslint/only-throw-error` lint rule and survive JSON serialization across the message wire.
---

## Goal

Enforce that failures are represented as typed `LookupError` values that satisfy the `@typescript-eslint/only-throw-error` lint rule and survive JSON serialization across the message wire.

## Rule

Throw only `Error` instances; attach a `LookupError` via `Object.assign(new Error(msg), lookupError)`, and flatten to a plain enumerable object before replying over the wire.

## Golden Example

Literal from `packages/app/src/app/gemini-lookup-client.ts` (produce) and `packages/app/src/app/router.ts` (flatten for transit):

```ts
// gemini-lookup-client.ts — REQUIRED: throw an Error that also carries LookupError fields
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e); // satisfies only-throw-error; isLookupError() still matches
}

// router.ts — REQUIRED: normalise to a PLAIN object before crossing the chrome.runtime boundary
return {
  code: e.code, message: e.message, retryable: e.retryable,
  ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}),
}; // Error.message is non-enumerable and would be dropped by JSON otherwise
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| throw { code: 'NETWORK', ... } (plain object) | throw Object.assign(new Error(msg), lookupError) | Violates @typescript-eslint/only-throw-error; loses stack/prototype |
| Sending the raw Error over the wire | Spread fields into a plain object first | message is non-enumerable → silently dropped by JSON, card shows an empty error |
| Inventing ad-hoc error strings | Map through mapError(...) to a LookupErrorCode | Keeps error codes a closed, typed set |

## Scope

Error producers (`gemini-client`, `error-mapper`) and the wire boundary (`router`, `sw`). Both extensions.

## Override

None for the throw form (lint-enforced). The flatten step is required wherever a `LookupError` crosses `chrome.runtime`.
