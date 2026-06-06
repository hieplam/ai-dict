---
id: c3-103
c3-seal: d65d16038082a91f63ac29651e75184293e843f66d000fe31304e84f032268e1
title: wire-protocol
type: component
category: foundation
parent: c3-1
goal: Own the validated message schemas that govern every message crossing the content-script-to-service-worker boundary.
uses:
    - ref-wire-protocol-validation
    - rule-api-key-isolation
---

## Goal

Own the validated message schemas that govern every message crossing the content-script-to-service-worker boundary.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Foundation |
| Runtime | both |
| Public surface | WireMessageSchema, WireReplySchema, WireMessage (type), WireReply (type), wireJsonSchema, AssertEqual (compile-time type) |
| Bundled into | packages/app/src/wire.ts |
| Depends on | zod (runtime validation); c3-101 (domain-types) for AssertEqual drift guards |
| Tested by | packages/app/test/wire-schema.test.ts |

## Purpose

Provides the single authoritative source of truth for what messages may cross the extension messaging boundary. `WireMessageSchema` is a zod discriminated union over seven inbound message types (`lookup`, `lookup.cancel`, `settings.get`, `history.list`, `history.clear`, `cache.clear`, `connection.test`). `WireReplySchema` is a zod union over four success arms plus a typed error arm. `PublicSettingsSchema` inside the file uses `z.strictObject`, which causes zod to reject — not strip — any extra key (including `apiKey`) from a settings reply payload. Compile-time `AssertEqual` guards enforce that the zod-inferred types stay structurally identical to the domain interfaces in `c3-101`; a drift in either direction causes a TypeScript error at build time. This component does NOT implement the message-passing transport, routing logic, or any platform API. It does NOT own `SettingsStore` — only the schema of what may appear in a settings reply.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | zod must be available; domain types from c3-101 must compile without error; entry point is packages/app/src/wire.ts:1-3 | c3-101 |
| Inputs | Raw unknown values arriving over the Chrome or Safari extension messaging API | ref-wire-protocol-validation |
| Compile-time drift guard | AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest> (and three more) in packages/app/src/wire.ts:102-108 force parity between schemas and domain types | c3-101 |
| z.strictObject scope | Applied only to sub-objects that must not carry extra keys: LookupErrorSchema, LookupRequestSchema, LookupResultSchema, PublicSettingsSchema, HistoryEntrySchema; see packages/app/src/wire.ts:4-41 | rule-api-key-isolation |
| Outer envelope mode | WireMessageSchema arms and WireReplySchema arms use z.object (strip mode) — spurious top-level fields are silently dropped; tested in packages/app/test/wire-schema.test.ts:39-49 | ref-wire-protocol-validation |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Messages arriving from untrusted content-script or service-worker contexts are either validated to a strongly-typed value or rejected with a parse error | ref-wire-protocol-validation |
| Primary path — inbound | Service worker calls WireMessageSchema.safeParse(raw); on success, routes by type discriminant; acceptance verified in packages/app/test/wire-schema.test.ts:6-13 | c3-111 |
| Primary path — outbound | Service worker builds a reply and sends back; WireReplySchema shape defined in packages/app/src/wire.ts:67-88 | c3-210 |
| Alternate path — apiKey in settings sub-object | PublicSettingsSchema is z.strictObject — parse fails immediately, reply is never sent; test at packages/app/test/wire-schema.test.ts:17-24 | rule-api-key-isolation |
| Alternate path — apiKey at envelope level | Outer z.object (strip mode) silently drops it; consumer never sees the key; test at packages/app/test/wire-schema.test.ts:26-38 | rule-api-key-isolation |
| Failure behavior | safeParse returns { success: false }; callers must handle the failure; no exception is thrown; see packages/app/test/wire-schema.test.ts:14-16 | ref-wire-protocol-validation |
| JSON schema export | wireJsonSchema() calls z.toJSONSchema on both schemas and returns a combined object; snapshot tested in packages/app/test/wire-schema.test.ts:131-135 | c3-1 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-wire-protocol-validation | ref | WireMessageSchema and WireReplySchema are the canonical implementation of cross-boundary validation | High | Every message crossing the boundary must pass through one of these two schemas |
| rule-api-key-isolation | rule | PublicSettingsSchema = z.strictObject(...) rejects apiKey at the settings sub-object level | High | The [S1] label in comments and tests refers to this rule |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| WireMessageSchema | IN | Discriminated union — parses inbound messages to WireMessage; rejects unknown type values | Service-worker message handler | packages/app/test/wire-schema.test.ts:6-16 |
| WireReplySchema | OUT | Union — validates outbound replies to WireReply; PublicSettingsSchema arm uses z.strictObject | Content-script reply handler | packages/app/test/wire-schema.test.ts:17-38 |
| wireJsonSchema() | OUT | Returns { WireMessage: unknown, WireReply: unknown } — stable JSON Schema snapshot | External tooling; tested via toMatchFileSnapshot | packages/app/test/wire-schema.test.ts:131-135 and wire-schema.snapshot.json |
| AssertEqual | N.A - compile-time only | Compile-time type equality guard; not callable at runtime | Build step only | packages/app/src/wire.ts:101-108 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Domain type and wire schema drift | Any field added or renamed in LookupRequest, LookupResult, PublicSettings, or HistoryEntry without updating the corresponding zod schema | AssertEqual drift guard fails at compile time | bun run --filter @ai-dict/app typecheck |
| PublicSettingsSchema changed from strictObject to object | Relaxing the strict mode allowing apiKey to pass | [S1] test apiKey inside settings sub-object is rejected in packages/app/test/wire-schema.test.ts fails | bun run --filter @ai-dict/app test |
| New message type added to WireMessageSchema without a handler | Adding a discriminant arm without updating the service-worker router | Runtime: unhandled message type; no compile error | bun run --filter @ai-dict/extension-chrome e2e |
| wireJsonSchema() output changes | Any schema modification | File snapshot test wire-schema.snapshot.json fails to match | bun run --filter @ai-dict/app test packages/app/test/wire-schema.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| wire-schema.snapshot.json | Contract — wireJsonSchema() stable output | None — snapshot must match exactly; update intentionally with bun run test -- -u | packages/app/test/wire-schema.test.ts:131-135 |
| WireMessage and WireReply TypeScript types | Contract — WireMessageSchema and WireReplySchema via z.infer | None — types are derived automatically by zod; do not write them by hand | packages/app/src/wire.ts:90-91 |
| Chrome message-passing glue in c3-210 | Contract — WireMessageSchema and WireReplySchema shapes | Platform transport may differ; schema validation call is required | ref-wire-protocol-validation |
| Safari message-passing glue in c3-310 | Contract — WireMessageSchema and WireReplySchema shapes | Same constraint as chrome | packages/app/src/wire.ts |
