---
id: ref-wire-protocol-validation
c3-seal: 272f1eccebc975d5c5749b12f6e57363991db1d35a1a5065cae29ffadba4c706
title: wire-protocol-validation
type: ref
goal: The content script and service worker run in separate JavaScript realms and can only exchange JSON-serialized messages. Standardize that channel so every message has one authoritative, validated shape, and the domain types cannot silently drift away from what crosses the wire.
---

## Goal

The content script and service worker run in separate JavaScript realms and can only exchange JSON-serialized messages. Standardize that channel so every message has one authoritative, validated shape, and the domain types cannot silently drift away from what crosses the wire.

## Choice

A single source-of-truth **zod `discriminatedUnion`** — `WireMessageSchema` (requests) and `WireReplySchema` (replies) in `packages/app/src/wire.ts` — validated at the boundary, plus a **compile-time `AssertEqual` guard** that fails the build if the inferred schema types diverge from the domain types.

## Why

A `chrome.runtime` message is JSON across a process boundary: a shape mismatch or a renamed field fails *silently* at runtime, in production, with no type error. `zod` gives runtime validation **and** inferred static types from one declaration, and the `_checks` tuple turns domain-vs-wire drift into a compile error instead of a field that quietly disappears in transit. The team explicitly accepted shipping `zod` (~250 kB) in the browser bundle "in exchange for a single, un-duplicated validation schema" (`README.md` → *Known tradeoffs*), rather than maintaining a hand-written zero-dependency validator that could drift from the types.

## How

Literal from `packages/app/src/wire.ts`:

```ts
// REQUIRED: one discriminated union keyed on `type`
export const WireMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookup'), req: LookupRequestSchema, requestId: z.string() }),
  z.object({ type: z.literal('lookup.cancel'), requestId: z.string() }),
  // settings.get / history.list / history.clear / cache.clear / connection.test …
]);

// REQUIRED: compile-time drift guard — domain types must equal schema-inferred types
const _checks: [
  AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest>,
  AssertEqual<z.infer<typeof LookupResultSchema>, LookupResult>,
  AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>,
  AssertEqual<z.infer<typeof HistoryEntrySchema>, HistoryEntry>,
] = [true, true, true, true];
```

OPTIONAL but used: `z.strictObject(...)` for payloads that must reject extra keys (see `rule-api-key-isolation`).
