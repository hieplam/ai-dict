---
paths:
  - 'packages/app/src/app/**/*.ts'
  - 'packages/app/src/domain/error-mapper.ts'
  - 'packages/extension-chrome/src/sw.ts'
  - 'packages/extension-safari/src/sw.ts'
---

# typed-errors

Failures are typed `LookupError` values that satisfy `@typescript-eslint/only-throw-error` and survive JSON across the wire.
Canonical rule: `.c3/rules/rule-typed-errors.md`.

## NEVER

- Throw plain objects (violates `@typescript-eslint/only-throw-error`).
- Send a raw `Error` over the wire (`message` is non-enumerable → dropped by JSON).

## Error handling

- Throw only `Error` instances — attach `LookupError` via `Object.assign(new Error(msg), lookupError)`.
- Flatten `LookupError` to a plain enumerable object before replying over the wire.
