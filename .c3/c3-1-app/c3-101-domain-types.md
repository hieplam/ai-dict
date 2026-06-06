---
id: c3-101
c3-seal: fd5cb58db7f13584edacffaa3555af5da10fca781de4fc835166412334eb2f7f
title: domain-types
type: component
category: foundation
parent: c3-1
goal: Define the shared domain vocabulary and typed error model that every layer of ai-dict depends on.
uses:
    - ref-core-dependency-rule
    - rule-api-key-isolation
    - rule-typed-errors
---

## Goal

Define the shared domain vocabulary and typed error model that every layer of ai-dict depends on.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Foundation |
| Runtime | both |
| Public surface | AnchorRect, SelectionEvent, LookupRequest, LookupResult, LookupError, LookupErrorCode, HistoryEntry, PublicSettings, Settings, isLookupError, ErrorInput, mapError |
| Bundled into | packages/app/src/domain/types.ts and packages/app/src/domain/error-mapper.ts |
| Depends on | Nothing — no external imports; error-mapper.ts imports only ./types |

## Purpose

Owns all shared domain interfaces and the canonical error pipeline. `types.ts` declares every cross-layer data shape: selection geometry (`AnchorRect`), user selection events (`SelectionEvent`), lookup inputs and outputs (`LookupRequest`, `LookupResult`), the typed error sum type (`LookupError` / `LookupErrorCode`), history records (`HistoryEntry`), and the critical two-tier settings split (`PublicSettings` vs `Settings`). `error-mapper.ts` provides the single conversion point from raw failure inputs — HTTP status codes, offline signals, timeouts, parse failures, thrown exceptions, and missing-key conditions — into typed `LookupError` values. This component does NOT perform network calls, storage access, DOM interaction, or any platform-specific operation. It does NOT validate schemas over the wire; that is owned by `c3-103` (wire-protocol).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | No external dependencies; the module tree is bootstrapped before any adapter imports | ref-core-dependency-rule |
| Inputs | Raw error signals: ErrorInput discriminated union (no-key, offline, timeout, parse, http, thrown) defined in packages/app/src/domain/error-mapper.ts | rule-typed-errors |
| Internal state | Stateless — mapError is a pure function; isLookupError is a pure type guard; both defined in packages/app/src/domain/types.ts | rule-domain-purity |
| Settings split | Settings extends PublicSettings; apiKey, cacheEnabled, saveHistory exist only on Settings | rule-api-key-isolation |
| Key scrubbing | sanitize() in packages/app/src/domain/error-mapper.ts redacts AIza… tokens and caps messages at 200 chars before returning LookupError.message | rule-typed-errors |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Callers receive a fully typed LookupError with a code, human message, retryable flag, and caller-supplied retryAfterSec when the server provides a Retry-After value | rule-typed-errors |
| Primary path | Adapter catches a failure, constructs an ErrorInput, calls mapError(input) from packages/app/src/domain/error-mapper.ts, and forwards the returned LookupError up the call chain | c3-114 |
| Alternate path — rate limit with Retry-After | http input with status 429 and retryAfterSec produces RATE_LIMIT with retryAfterSec present; without it the field is absent (not undefined) as verified in packages/app/test/error-mapper.test.ts | rule-typed-errors |
| Failure behavior | Unmapped HTTP statuses fall through to UNKNOWN; thrown non-Error values are stringified; no exception is ever thrown from mapError (see packages/app/src/domain/error-mapper.ts) | rule-typed-errors |
| Type guard | isLookupError(e) narrows unknown to LookupError for catch-site discrimination; defined in packages/app/src/domain/types.ts | c3-110 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-api-key-isolation | rule | Settings/PublicSettings split — apiKey absent from PublicSettings | High | The type-level separation originates here; enforced at the wire boundary by c3-103 |
| rule-typed-errors | rule | LookupError, isLookupError, mapError | High | Every error-producing path must produce a LookupError via mapError |
| ref-core-dependency-rule | ref | Zero outward imports from domain/** | High | types.ts has no imports; error-mapper.ts imports only ./types |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Settings | OUT | Extends PublicSettings; adds apiKey: string, cacheEnabled: boolean, saveHistory: boolean | Trusted contexts only (options page, storage adapter) | packages/app/src/domain/types.ts:74 |
| PublicSettings | OUT | { targetLang: string; promptTemplate: string; hasKey: boolean } — no apiKey field | Safe for wire and port boundaries | packages/app/test/types.test.ts — [type-level] apiKey is NOT a key of PublicSettings |
| mapError | OUT | Pure function (ErrorInput) => LookupError; never throws; retryAfterSec absent (not undefined) when not provided by the server | Adapters (chrome, safari) only | packages/app/test/error-mapper.test.ts — HTTP 429 without retryAfterSec → retryAfterSec field is ABSENT |
| isLookupError | OUT | Type guard (unknown) => e is LookupError; checks code, message, retryable presence | All catch sites in the codebase | packages/app/src/domain/types.ts:63 |
| LookupErrorCode | OUT | Enum union: NO_KEY, INVALID_KEY, RATE_LIMIT, NETWORK, PARSE, UNKNOWN | Mirrored verbatim in WireMessageSchema error arm in c3-103 | packages/app/src/domain/types.ts:34 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Adding a field to PublicSettings leaks into the wire schema | Any new property added to PublicSettings | Compile-time: AssertEqual drift guard in wire.ts fails | bun run --filter @ai-dict/app typecheck |
| Adding apiKey to PublicSettings breaks isolation | Accidental widening of PublicSettings | Type-level test in packages/app/test/types.test.ts fails; z.strictObject in wire rejects it | packages/app/test/types.test.ts |
| New LookupErrorCode value not handled by mapError | Extension of LookupErrorCode union | mapError switch is exhaustive; TypeScript exhaustiveness check catches missing arm | bun run --filter @ai-dict/app test |
| retryAfterSec present as undefined instead of absent | Changing spread logic in mapError | Dedicated test HTTP 429 without retryAfterSec → retryAfterSec field is ABSENT fails | packages/app/test/error-mapper.test.ts |
| sanitize() regex change exposes API keys in error messages | Modifying AIza... redaction regex | Dedicated test scrubs key-like tokens fails | bun run --filter @ai-dict/app test packages/app/test/error-mapper.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| LookupErrorSchema in wire.ts | Contract — LookupErrorCode enum values | None — must mirror enum values exactly | packages/app/src/wire.ts:4-9 — z.enum(['NO_KEY','INVALID_KEY','RATE_LIMIT','NETWORK','PARSE','UNKNOWN']) |
| PublicSettingsSchema in wire.ts | Contract — PublicSettings interface shape | None — AssertEqual drift guard enforces exact structural match | packages/app/src/wire.ts:102-107 |
| packages/app/test/types.test.ts | Contract — Settings and PublicSettings surface | Test may add helper assertions; interface shape is fixed | packages/app/test/types.test.ts |
| packages/app/test/error-mapper.test.ts | Contract — mapError and ErrorInput surface | Fixture-driven tests may expand; mapError branch table is fixed | packages/app/test/error-mapper.test.ts |
