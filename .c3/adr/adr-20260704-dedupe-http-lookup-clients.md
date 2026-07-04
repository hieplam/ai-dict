---
id: adr-20260704-dedupe-http-lookup-clients
c3-seal: b8a371a01401bfeec745843cc3dbc0aec71e9785aac301a229a00388fc250cee
title: dedupe-http-lookup-clients
type: adr
goal: |-
    Extract the identical HTTP request/timeout/abort/typed-error skeleton shared by the three
    `LookupClient` implementations (`gemini-lookup-client.ts`, `openai-lookup-client.ts`,
    `anthropic-lookup-client.ts`) into one internal helper `packages/app/src/app/http-lookup-client.ts`
    (`runHttpLookup`), and re-point all three clients at it as thin per-provider config. This removes
    the near-duplicate client bodies so SonarCloud `new_duplicated_lines_density` drops from 4.7% to
    under the 3% quality-gate threshold, while keeping every public class, `*Deps` interface, default
    model, and behavioural contract byte-for-byte unchanged.
status: implemented
date: "2026-07-04"
---

## Goal

Extract the identical HTTP request/timeout/abort/typed-error skeleton shared by the three
`LookupClient` implementations (`gemini-lookup-client.ts`, `openai-lookup-client.ts`,
`anthropic-lookup-client.ts`) into one internal helper `packages/app/src/app/http-lookup-client.ts`
(`runHttpLookup`), and re-point all three clients at it as thin per-provider config. This removes
the near-duplicate client bodies so SonarCloud `new_duplicated_lines_density` drops from 4.7% to
under the 3% quality-gate threshold, while keeping every public class, `*Deps` interface, default
model, and behavioural contract byte-for-byte unchanged.

## Context

PR #89 added `anthropic-lookup-client.ts` by copying `openai-lookup-client.ts` verbatim (the same
shape Gemini/OpenAI already shared). SonarCloud's copy-paste detector now flags the new Anthropic
file as duplicating OpenAI: the quality gate is ERROR on exactly one condition,
`new_duplicated_lines_density = 4.7%` (threshold ≤ 3%); all other conditions (coverage 96.6%,
reliability/security/maintainability A) pass. All three clients contain an identical ~40-line block:
`rejectWith` / `isThrownLookupError`, the AbortController + caller-signal merge, the timeout timer +
`timedOut` flag, the `try/catch/finally`, and the final unreachable `rejectWith`. The only real
per-provider differences are endpoint, default model, headers, request body, ok/err JSON parsing,
and the `provider` literal. Affected topology: component `c3-114 lookup-clients` in container
`c3-1 app`. Note pre-existing C3 drift — `anthropic-lookup-client.ts` is uncharted and `c3-114`
still documents only Gemini + OpenAI; this ADR also reconciles that.

## Decision

Create one internal module `http-lookup-client.ts` exporting `runHttpLookup(spec, deps, req, opts)`
plus the shared fetch abstraction types (`FetchLike`/`FetchInit`/`ResponseLike`) and `HttpLookupDeps`.
`runHttpLookup` owns the whole skeleton and maps every failure through `mapError` → `rejectWith`.
Each provider passes a small `spec`: `provider`, `endpoint`, resolved `model`, `headers(apiKey)`,
`body(prompt, model)`, `parseOk(json)→string|undefined`, `parseErr(json)→{geminiStatus?,vendorStatus?,vendorMessage?}`.
All three clients (including Gemini) are folded in — not just OpenAI/Anthropic — because leaving
Gemini's copy inline would let SonarCloud flag the new helper as duplicating Gemini and keep the gate
red. `GeminiLookupClient`/`OpenAILookupClient`/`AnthropicLookupClient`, their `*Deps`, default models
(`gpt-4o-mini`, `claude-haiku-4-5-20251001`), and the `FetchLike` import path
(`src/app/gemini-lookup-client`) stay unchanged so `sw.ts` and the existing test suites are untouched.
Passing `provider:'gemini'` to `mapError` is behaviourally identical to omitting it (mapError defaults
absent provider to Gemini wording), so Gemini messages do not change.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-114 | component | Three client bodies replaced by thin config delegating to a new shared runHttpLookup; component now also charts Anthropic + the helper | Re-verify rule-api-key-isolation, rule-typed-errors, ref-dependency-injection, ref-core-dependency-rule still hold; update component contract + codemap |
| c3-1 | container | Owns c3-114; gains an internal http-lookup-client.ts module (not exported from the barrel) | Parent Delta: no change to container responsibilities (still "shared adapters"); record no-delta with evidence |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | The helper and all three clients must still implement the LookupClient port and depend inward on ports.ts/index, never outward on chrome APIs | comply |
| ref-dependency-injection | deps.fetch and deps.getApiKey remain injected into runHttpLookup; no globalThis.fetch or hard-coded key access is introduced | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | S1 — the secret key must reach the network only via the provider headers(apiKey) builder, never in URL/body/logs; the extraction must not move it | comply (header-capture + url/body assertions in the client success tests) |
| rule-typed-errors | Every failure must still throw Object.assign(new Error(msg), lookupError); rejectWith is now centralized in the helper and must keep that form | comply (only-throw-error lint + isLookupError assertions in all three suites) |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| New helper | packages/app/src/app/http-lookup-client.ts: runHttpLookup, HttpLookupDeps, and FetchLike/FetchInit/ResponseLike (moved here, the shared fetch abstraction) | file added |
| Gemini client | Reduce to config delegating to runHttpLookup; re-export FetchLike/ResponseLike from the helper for the existing test import path | gemini-lookup-client.ts diff |
| OpenAI client | Reduce to config (OpenAIDeps extends HttpLookupDeps + model?); default gpt-4o-mini unchanged | openai-lookup-client.ts diff |
| Anthropic client | Reduce to config (AnthropicDeps extends HttpLookupDeps + model?); default claude-haiku-4-5-20251001, anthropic-version/direct-browser headers, max_tokens:1024 unchanged | anthropic-lookup-client.ts diff |
| C3 model | c3 set c3-114 codemap patterns to include the anthropic + http-lookup files; rewrite the c3-114 contract to describe three providers + the shared helper | c3 check clean |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - this ADR changes application code and C3 model DATA (component doc + code-map) authored through the c3x CLI; it does not modify the c3x underlay (CLI files, validators, schemas, hints, templates, or their tests) | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| SonarCloud quality gate | new_duplicated_lines_density must be ≤ 3% once the duplicate bodies collapse into one helper | curl .../qualitygates/project_status?...&pullRequest=<PR#> returns OK |
| Vitest client suites | gemini/openai/anthropic-lookup-client.test.ts are the behavioural contract and must stay green untouched | bun run test |
| ESLint @typescript-eslint/only-throw-error + scripts/check-dep-direction.mjs | Enforce typed errors and inward-only dependency direction on the new file | bun run lint |
| Header-capture assertions | Prove the key travels only in provider headers, never URL/body (S1) | client success tests |
| knip | No unused exports introduced by the new module | bun run knip (CI) |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Extract from OpenAI + Anthropic only (the handoff plan's literal scope) | Leaves Gemini's identical inline skeleton, so SonarCloud can flag the new helper as duplicating Gemini and keep new_duplicated_lines_density above 3% — likely forcing a second PR |
| Add sonar.cpd.exclusions for the client files | Hides the duplication instead of removing it; contradicts the stated goal and the repo precedent of excluding only the design-token DATA table |
| Collapse all three into a single class keyed by a provider→config map | Destroys the per-provider public classes (GeminiLookupClient/OpenAILookupClient/AnthropicLookupClient) and *Deps that sw.ts and the test suites import — a breaking API change for a pure dedupe |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Behavioural drift in a provider (e.g. Gemini geminiStatus/400-INVALID_ARGUMENT, Anthropic vendorStatus) | Keep all three client test suites byte-for-byte untouched as the contract; helper builds the http mapError input generically to preserve each path | bun run test all green |
| S1 key leak if header construction is refactored wrongly | Key enters only via spec.headers(apiKey); url/body never see it | header-capture + not.toContain(key) url/body assertions in success tests |
| Gate still red if the thin clients duplicate each other | Per-provider configs differ (endpoint/headers/body/parse), so identical contiguous runs stay under SonarCloud's 10-line CPD threshold | SonarCloud new_duplicated_lines_density ≤ 3% on the PR |
| knip unused-export regression | Export only runHttpLookup/HttpLookupDeps (imported cross-file) and fetch types (used in-file + re-exported for tests) | bun run knip green |

## Verification

| Check | Result |
| --- | --- |
| bun run lint && bun run format:check && bun run typecheck | 0 errors |
| bun run test | all suites green, incl. the three untouched client suites |
| bun run build:chrome | dist builds |
| cd packages/extension-chrome && bunx playwright test provider-fallback | green |
| c3 check | no drift (c3-114 + code-map reconciled) |
| SonarCloud new_duplicated_lines_density on the PR | ≤ 3% → quality gate OK |
