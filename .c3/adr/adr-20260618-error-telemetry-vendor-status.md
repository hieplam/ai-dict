---
id: adr-20260618-error-telemetry-vendor-status
c3-seal: cf5062dc0d2a1ccf22cdd1c79467b326ac33af32fab57c2c6c6ebae561c1d577
title: error-telemetry-vendor-status
type: adr
goal: 'Enrich the opt-in error telemetry so a captured `extension_error` event carries the *provider''s own* failure signature — the HTTP status (e.g. `503`), the vendor status enum (e.g. `UNAVAILABLE`), and a privacy-scrubbed vendor message — instead of collapsing every 5xx into the single opaque `code: NETWORK` / `"Gemini server error. Retry."` pair. The decision authorizes threading three new optional fields (`httpStatus`, `vendorStatus`, `vendorMessage`) from the provider error body, through the typed `LookupError`, the wire flatten/validation boundary, and the SW capture path, into the GA4 Measurement Protocol payload as `http_status`, `vendor_status`, and `vendor_msg` event params.'
status: accepted
date: "2026-06-18"
---

## Goal

Enrich the opt-in error telemetry so a captured `extension_error` event carries the *provider's own* failure signature — the HTTP status (e.g. `503`), the vendor status enum (e.g. `UNAVAILABLE`), and a privacy-scrubbed vendor message — instead of collapsing every 5xx into the single opaque `code: NETWORK` / `"Gemini server error. Retry."` pair. The decision authorizes threading three new optional fields (`httpStatus`, `vendorStatus`, `vendorMessage`) from the provider error body, through the typed `LookupError`, the wire flatten/validation boundary, and the SW capture path, into the GA4 Measurement Protocol payload as `http_status`, `vendor_status`, and `vendor_msg` event params.

## Context

PR #69 shipped consent-gated, PII-scrubbed error reporting to GA4. In production it works, but `error-mapper.ts` maps every `status >= 500` to a canned `{ code: 'NETWORK', message: 'Gemini server error. Retry.' }`, discarding the `error.code`/`error.status`/`error.message` that the Gemini client already parses (`gemini-lookup-client.ts`). Result: a real user hit two Gemini 5xx errors, but GA4 cannot distinguish `503 UNAVAILABLE` (model overloaded, transient) from `500 INTERNAL`, so the operator cannot triage without reproducing locally. The capture path is non-obvious: `sw.ts` captures from the *flattened* `reply.error` produced by `router.ts` (post-wire-shape), not the thrown error — so any new field must survive the `router.ts` flatten and the `wire.ts` strict schema. Affected topology: `c3-101 domain-types` (the typed error model), `c3-114 lookup-clients` (the producers), and the app/shell telemetry plumbing (`ga4-payload`, `error-report`, `router`, `wire`, `sw`).

## Decision

Add three optional fields to `LookupError` and carry them end-to-end. The clients parse the structured vendor body (`error.code` → number, `error.status` → enum string, `error.message` → free text). The mapper attaches `httpStatus` + `vendorStatus` verbatim (safe Google enums/numbers) and a `scrubSecrets`-cleaned, capped `vendorMessage` to every HTTP-derived `LookupError`; `router.ts` copies the new fields into the flattened wire object; `wire.ts` adds them as optional schema keys; `sw.ts` forwards them to `reporter.capture`; `toErrorRecord` re-applies `redactPII`+`scrubSecrets`+cap to `vendorMessage`; `ga4-payload` emits the three params. `code` stays in the closed `LookupErrorCode` set (UI unchanged). This wins because it keeps the *structured* signal (status/enum) lossless while routing the *free-text* message through the existing two-layer privacy scrub, and it reuses the established typed-error + wire-flatten contract rather than inventing a parallel telemetry channel.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-101 | component | LookupError gains 3 optional fields; error-mapper attaches them; error-report records/scrubs them | rule-typed-errors, rule-domain-purity |
| c3-114 | component | Gemini/OpenAI clients parse the vendor error body and pass vendorMessage to mapError | rule-typed-errors |
| c3-103 | component | LookupErrorSchema (wire) gains the 3 fields as optional strict keys | ref-wire-protocol-validation |
| c3-111 | component | router.ts toLookupError flattens the new fields so they survive the wire | rule-typed-errors |
| c3-210 | component | sw.ts capture destructures + forwards the new fields from reply.error | rule-gate-runtime-messages |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-wire-protocol-validation | New error fields cross chrome.runtime; the LookupErrorSchema strictObject would reject them unless explicitly added as optional keys | comply |
| ref-core-dependency-rule | error-mapper/error-report/types are domain; new code imports only ./ + ports (uses domain/pii.ts) | comply |
| ref-dependency-injection | Clients keep injected fetch; vendor-body parse adds no new global/side-effect | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-typed-errors | New fields must be enumerable on the flattened plain object (router) so they survive JSON across the wire; code stays in the closed set | comply |
| rule-domain-purity | error-mapper/error-report/types stay import-pure; scrubbing via existing domain/pii.ts only | comply |
| rule-api-key-isolation | vendorMessage is free text that could echo a key; scrubSecrets runs in the mapper before it crosses the wire | comply |
| rule-sanitize-model-output | The vendor error message is untrusted provider text; it is scrubbed + length-capped before storage/transmission | comply |
| rule-gate-runtime-messages | The SW capture reads reply.error after classifyInbound gating; the gating path itself is unchanged — only the post-gate destructure adds three fields | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| domain/types.ts | LookupError += httpStatus?: number; vendorStatus?: string; vendorMessage?: string | unit: types compile + wire/mapper tests |
| domain/error-mapper.ts | ErrorInput.http += vendorMessage?; attach httpStatus/vendorStatus/scrubbed vendorMessage to every http-mapped error | error-mapper.test.ts |
| domain/error-report.ts | CaptureInput.error + ErrorRecord += 3 fields; toErrorRecord redacts+caps vendorMessage | error-report.test.ts |
| app/ga4-payload.ts | toEvent emits http_status, vendor_status, vendor_msg (capped) | ga4-payload.test.ts |
| app/gemini-lookup-client.ts | Parse error.code/status/message; pass vendorMessage to mapError | gemini-lookup-client.test.ts |
| app/openai-lookup-client.ts | Parse error.message; pass vendorMessage to mapError | openai-lookup-client.test.ts |
| app/router.ts | toLookupError flattens the 3 new optional fields | router.test.ts |
| wire.ts | LookupErrorSchema += 3 optional keys | wire.test.ts |
| extension-chrome/src/sw.ts | Capture destructures + forwards the 3 fields from reply.error | e2e + build |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - application-code change only; no C3 CLI/validator/schema/help surface is modified | none | c3 check stays green after c3 set of ADR status |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test (packages/app) | Unit tests assert mapper attaches status, payload emits params, vendorMessage is scrubbed | green run |
| scripts/check-dep-direction.mjs | Build gate fails if domain imports outward | bun run build:chrome |
| eslint only-throw-error | Fails if a producer throws a non-Error | bun run lint |
| wire.test.ts | Strict schema accepts the new optional fields, rejects unknowns | green run |
| chrome e2e consent spec | Error-reporting happy path still passes with the enriched record | bun run e2e:chrome |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Encode detail into the code value (e.g. NETWORK_503_UNAVAILABLE) | Breaks the closed LookupErrorCode enum shared by wire.ts and the UI; less queryable in GA than discrete params |
| Log the raw vendor error body verbatim | Free text risks leaking PII/secrets and exceeds GA4's 100-char param cap; violates rule-sanitize-model-output / rule-api-key-isolation |
| Capture richer data in the SW before the router flatten | Capture architecturally reads the post-router reply.error; bypassing it would duplicate mapping logic and diverge from the established path |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| vendorMessage leaks a key or PII | scrubSecrets in mapper (pre-wire) + redactPII+scrubSecrets+cap in toErrorRecord | error-mapper.test + error-report.test assert masked output |
| New field silently dropped at the wire | router.ts flatten copies each field; wire.ts schema allows them | router.test + wire.test |
| GA4 truncates long values | vendor_status/vendor_msg capped to GA4_PARAM_MAX (100) | ga4-payload.test asserts slice |

## Verification

| Check | Result |
| --- | --- |
| cd packages/app && bun test | all green incl. new assertions |
| bun run lint (dep-direction + eslint) | green |
| bun run build:chrome | dist builds |
| bunx playwright test e2e/error-reporting*.spec.ts | consent happy path green |
