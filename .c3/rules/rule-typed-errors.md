---
id: rule-typed-errors
c3-seal: 70346a72a05f4d3cc0788558f43de3e9dd2d695c60273789caa6acef7b62ebaf
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

**Enforcement (mechanical, two surfaces — added by `adr-20260803-verification-loop-doc`):**

1. **Throw form:** ESLint's `@typescript-eslint/only-throw-error` (part of `tseslint.configs.recommendedTypeChecked` in `eslint.config.mjs`), run by `bun run lint`.
2. **Flatten form:** locked by the `packages/app/test/wire-schema.test.ts` `describe('typed-errors: wire-flatten contract (rule-typed-errors)')` block, run by `bun run --filter @ai-dict/app test wire-schema`. It pins that every error-reply shape the router produces survives the `chrome.runtime` JSON round-trip with `message` intact, plus a negative control proving a raw, un-flattened `Error` loses it.
