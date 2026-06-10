---
id: adr-20260610-add-provider-selection
c3-seal: 750d736d170734d90c330da72cb50b56a61e3593a2e1e119b137f3734a03646d
title: add-provider-selection
type: adr
goal: Let the user choose which AI provider answers lookups — Gemini (current, default) or OpenAI (ChatGPT) — via a new `provider` setting surfaced in the options page. The selected provider's `LookupClient` implementation is chosen per lookup in the service worker; each provider has its own locally-stored API key. The change adds an `OpenAILookupClient` adapter beside the existing `GeminiLookupClient` behind the unchanged `LookupClient` port (c3-102), so the domain core, router, wire protocol shape, and content script are untouched except for widening the `model` field from a Gemini literal to a string.
status: implemented
date: "2026-06-10"
---

## Goal

Let the user choose which AI provider answers lookups — Gemini (current, default) or OpenAI (ChatGPT) — via a new `provider` setting surfaced in the options page. The selected provider's `LookupClient` implementation is chosen per lookup in the service worker; each provider has its own locally-stored API key. The change adds an `OpenAILookupClient` adapter beside the existing `GeminiLookupClient` behind the unchanged `LookupClient` port (c3-102), so the domain core, router, wire protocol shape, and content script are untouched except for widening the `model` field from a Gemini literal to a string.

## Context

Today the provider is hard-wired: `c3-114 gemini-client` is the only `LookupClient` implementation, both composition roots (`packages/extension-chrome/src/sw.ts`, `packages/extension-safari/src/sw.ts`) instantiate it directly, `Settings` (`packages/app/src/domain/types.ts`) has a single `apiKey` understood to be a Gemini key, the wire schema (`packages/app/src/wire.ts:24`) pins `model: z.literal('gemini-2.5-flash')`, and the error mapper (`packages/app/src/domain/error-mapper.ts`) hard-codes Gemini/Google wording plus a Gemini-shaped (`AIza…`) key scrubber. The settings form (`packages/app/src/ui/settings-form.ts`) exposes one "Gemini API key" field, with an env-baked-key lock (`__GEMINI_API_KEY__`).

The user wants to pick other providers (explicitly: ChatGPT). The architecture was built for exactly this: `LookupClient` is a port, adapters are injected at the composition roots (ref-dependency-injection), and the key never crosses the wire (rule-api-key-isolation). Constraints: stored settings of existing users must keep working (no `provider`/`openaiApiKey` present → behave as Gemini), the env-key build path applies to Gemini only, and OpenAI output must flow through the same sanitize boundary (rule-sanitize-model-output) — which it does automatically because the result is the same `LookupResult.markdown` rendered by c3-116.

## Decision

Add a second `LookupClient` adapter plus a tiny selector, all inside the app core's adapter layer, and make the provider a stored setting:

1. **Domain (c3-101)**: `export type Provider = 'gemini' | 'openai'`. `Settings` gains `provider: Provider` and `openaiApiKey: string` (each provider keeps its own key; switching back and forth never wipes a key). `LookupResult.model` widens from the `'gemini-2.5-flash'` literal to `string`. `PublicSettings` is unchanged — `hasKey` now means "the *selected* provider has a key".
2. **Error mapper (c3-101)**: `ErrorInput` variants gain an optional `provider` tag so messages name the right vendor ("OpenAI rejected the API key." vs "Google rejected the API key."); defaults preserve current Gemini wording. The sanitizer additionally scrubs `sk-…` (OpenAI-shaped) tokens.
3. **New adapter (c3-114)**: `packages/app/src/app/openai-lookup-client.ts` — `OpenAILookupClient implements LookupClient`, POSTs to `https://api.openai.com/v1/chat/completions` with the key only in the `Authorization: Bearer` header, default model `gpt-4o-mini` (overridable via deps), and mirrors the Gemini client's timeout/abort/typed-error contract exactly (20 s internal AbortController merged with caller signal, offline short-circuit, `rejectWith(Object.assign(new Error, lookupError))`).
4. **Selector (c3-114)**: `packages/app/src/app/lookup-client-selector.ts` — `createLookupClientSelector({ clients, getProvider })` returns a `LookupClient` that resolves `getProvider()` per call and delegates. c3-114 is retitled from `gemini-client` to `lookup-clients` and owns all three files.
5. **Wire (c3-103)**: `model: z.string().min(1)` — the literal would reject OpenAI results at the trust boundary.
6. **Composition roots (c3-210, c3-310)**: build both clients, wrap in the selector; `getProvider` reads `settings.provider ?? 'gemini'` (backward compatible). The `__GEMINI_API_KEY__` build define keeps overriding only the Gemini key.
7. **Settings storage adapters (c3-201, c3-301)**: defaults gain `provider: 'gemini'`, `openaiApiKey: ''`; `hasKey` derives from the selected provider's key.
8. **Settings UI (c3-117 settings-form + c3-212/c3-312 options pages)**: the Connection section gains an "AI provider" select; the key row switches label/value between the Gemini and OpenAI keys as the select changes, both keys are kept in the form state, and `SettingsFormValue` gains `provider` + `openaiApiKey`. The env-key lock applies only while Gemini is selected. Onboarding stays Gemini-first [ASSUMED — provider switching lives in Settings; onboarding redesign is out of scope].

This wins because it is the minimum change that uses the existing port seam as designed: no router, workflow, content-script, or wire-protocol *shape* changes, and every provider-specific concern (endpoint, auth header, parse shape, error vocabulary) stays inside one adapter file per provider.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-101 | component | Adds Provider, Settings.provider, Settings.openaiApiKey; widens LookupResult.model; error-mapper provider tag + sk- scrub | rule-domain-purity (no new imports), rule-api-key-isolation (key fields stay out of PublicSettings), rule-typed-errors |
| c3-103 | component | model literal → z.string().min(1) | ref-wire-protocol-validation (schema stays strict; apiKey still rejected by strictObject) |
| c3-114 | component | Gains sibling OpenAILookupClient + createLookupClientSelector; retitled; codemap extended | ref-dependency-injection (deps injected), rule-api-key-isolation (Bearer header only), rule-typed-errors (rejectWith pattern) |
| c3-117 | component | settings-form gains provider select + per-provider key handling | rule-api-key-isolation (keys only inside trusted options page), rule-sanitize-model-output (status text via textContent — unchanged pattern) |
| c3-201 | component | chrome-storage-store defaults + provider-aware hasKey | rule-api-key-isolation (PublicSettings still strips both keys) |
| c3-210 | component | sw.ts composes both clients + selector | ref-dependency-injection, rule-api-key-isolation (env define stays SW-side) |
| c3-212 | component | options.ts persists provider + openaiApiKey, provider-aware hasKey | rule-api-key-isolation |
| c3-301 | component | safari-storage-store same delta as chrome | rule-api-key-isolation |
| c3-310 | component | sw.ts same delta as chrome (no env key path) | ref-dependency-injection |
| c3-312 | component | options.ts same delta as chrome | rule-api-key-isolation |
| c3-1 | container | Owns c3-114 whose title/goal/codemap change; Components listing must reflect the retitle | Contract cascade gate in Phase 3a |
| c3-2 | container | Its composition root (c3-210), adapters (c3-201) and options page (c3-212) change behavior | Contract cascade gate in Phase 3a |
| c3-3 | container | Its composition root (c3-310), adapters (c3-301) and options page (c3-312) change behavior | Contract cascade gate in Phase 3a |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-dependency-injection | New OpenAI client and selector must receive fetch/getApiKey/getProvider injected, never reach for globals; composition roots supply concretes | comply |
| ref-core-dependency-rule | New adapter files live in packages/app/src/app/, import only from the core barrel/ports — no chrome.* or platform imports | comply |
| ref-wire-protocol-validation | model field change must keep the reply schema authoritative and strict (z.string().min(1), strictObject untouched) | comply |
| ref-kv-storage-prefixes | The settings blob lives in the same flat KV store both platforms expose; the new fields must stay inside the existing settings key with no new prefixes or eviction logic | review |
| ref-web-components-shadow-dom | settings-form changes stay inside the existing shadow-DOM component pattern (adoptStyles, no inline styles) | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | A second secret (OpenAI key) now exists; it must follow the same isolation: stored only in settings blob, stripped from PublicSettings, never on the wire (strictObject already rejects extras), sent only in the Authorization header | comply |
| rule-typed-errors | OpenAI client failures must throw Object.assign(new Error(msg), lookupError) via the same rejectWith pattern so the router serializes them | comply |
| rule-sanitize-model-output | OpenAI markdown is attacker-influenceable the same way Gemini's is; it flows through the existing markdown-sanitize boundary unchanged — verify no new render path bypasses it | review |
| rule-domain-purity | domain/types.ts and domain/error-mapper.ts changes add no imports beyond domain | comply |
| rule-gate-runtime-messages | No new wire message types are introduced; the provider switch must not add ungated message paths — review confirms classifyInbound gating is untouched | review |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Domain types | Provider type; Settings.provider/openaiApiKey; LookupResult.model: string; hasKeyFor helper in packages/app/src/domain/types.ts | typecheck + packages/app/test/types.test.ts |
| Error mapper | Provider-aware wording + sk- scrub in packages/app/src/domain/error-mapper.ts | packages/app/test/error-mapper.test.ts (provider-aware wording describe block) |
| OpenAI client | New packages/app/src/app/openai-lookup-client.ts mirroring Gemini client contract | packages/app/test/app/openai-lookup-client.test.ts covering success/http/parse/offline/timeout/cancel/header-isolation |
| Selector | New packages/app/src/app/lookup-client-selector.ts | packages/app/test/app/lookup-client-selector.test.ts |
| Barrel | Export new symbols from packages/app/src/index.ts | typecheck |
| Wire | model: z.string().min(1) in packages/app/src/wire.ts | packages/app/test/wire-schema.test.ts (snapshot updated) |
| Settings form | Provider select + per-provider key field in packages/app/src/ui/settings-form.ts; SettingsFormValue gains fields | packages/app/test/ui/settings-form.test.ts (provider selection describe block) + e2e-evidence/provider-selection screenshots |
| Chrome shell | sw.ts selector composition; options.ts save/load provider; chrome-storage-store.ts defaults + hasKeyFor | unit tests + packages/extension-chrome/e2e/provider-selection.spec.ts |
| Safari shell | Same three files on Safari side | typecheck + unit tests |
| Manifest CSP (scope amendment) | connect-src in both manifests must also allow https://api.openai.com — discovered when the e2e OpenAI lookup was blocked by the extension-pages CSP and mapped to NETWORK | packages/extension-chrome/src/manifest.json, packages/extension-safari/src/manifest.json; proven by e2e/provider-selection.spec.ts (OpenAI endpoint hit, Gemini count 0) |
| E2E coverage | New packages/extension-chrome/e2e/provider-selection.spec.ts (persist provider+key, OpenAI lookup path, legacy-settings Gemini path); helpers.ts gains OPENAI_GLOB/mockOpenAI; evidence.spec.ts captures provider screenshots | e2e run output |
| C3 docs | Retitled c3-114 → lookup-clients (goal/body/codemap); c3-1 Components/Responsibilities/Complexity; c3-101, c3-117, c3-210, c3-310, c3-212, c3-312, c3-201, c3-301, c3-113 bodies synced | c3 check clean |
| Evidence + PR | Before/After screenshots of options page (bundled Chromium via the repo's evidence.spec pattern), assets on pr-assets/ branch, PR with same-origin URLs, squash merge | PR merged |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - this ADR changes application code and C3 entity content only; no C3 CLI commands, validators, schemas, templates, hints, or tests are touched | N.A - no underlay change | N.A - c3 check passes post-edit |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run --filter @ai-dict/app test | Unit tests for OpenAI client error/timeout/abort/header contract, selector delegation, error mapper wording, wire schema | test run output |
| bun run --filter @ai-dict/app typecheck + chrome/safari typecheck | Port conformance: OpenAILookupClient implements LookupClient; Settings shape propagated to both shells | typecheck output |
| packages/extension-chrome/e2e/*.spec.ts | Existing lookup/options flows stay green with default provider gemini | e2e run output |
| Wire strictObject on settings replies | Both apiKey and openaiApiKey rejected from crossing the wire | existing wire tests + S1 rule |
| c3 check | Docs/codemap stay consistent with the new files | check output |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| One generic LookupClient with per-provider config objects (endpoint/header/parse-path templates) | The two APIs differ in auth header, body shape, response path, and error vocabulary; a config-driven generic client would smear provider specifics across config and code, harder to test than two small adapters behind the existing port — this repo deliberately flattened abstraction (lean dependency rule) |
| Reuse the single apiKey field for whichever provider is selected | Switching providers would silently invalidate/overwrite the user's other key; Gemini env-key builds (GEMINI_API_KEY) would become ambiguous about which provider the baked key belongs to |
| Provider choice resolved at composition time (rebuild router on settings change) | The MV3 service worker would need a settings listener + router rebuild; per-call getProvider() matches the existing per-call getApiKey() pattern (sw.ts already reads settings per lookup) at no extra cost |
| Branch inside GeminiLookupClient on a provider flag | Violates single-responsibility of the adapter and the documented c3-114 contract; mixes two vendors' error mapping in one file |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Existing users' stored settings lack provider/openaiApiKey → undefined reads | Every read site falls back: provider ?? 'gemini', openaiApiKey ?? ''; defaults updated in both storage stores and both sw.ts/options.ts | unit test: store without new fields behaves as Gemini |
| OpenAI key leaks (URL, logs, wire) | Key only in Authorization header; sanitizer scrubs sk-…; strictObject wire schema rejects extra keys | header-capture unit test + wire test |
| Widening model to string weakens validation | z.string().min(1) still rejects absent/empty; model is display-only metadata | wire schema test |
| Env-key lock UX wrong when OpenAI selected | Lock applied only when provider select = gemini | settings-form unit/browser check |
| OpenAI response shape drift (choices[].message.content) | Parse failure maps to typed PARSE LookupError, surfaced like Gemini parse errors | parse-failure unit test |

## Verification

| Check | Result |
| --- | --- |
| bun install && bun run typecheck (workspace: app, extension-chrome, extension-safari) | PASS — zero TS errors |
| bun run --filter @ai-dict/app test | PASS — 24 files, 287 tests (incl. new openai-lookup-client, lookup-client-selector, provider wording, hasKeyFor, settings-form provider suites) |
| bun run --filter @ai-dict/extension-chrome test / @ai-dict/extension-safari test | PASS — 23 + 21 tests |
| bun run lint + bun run format:check | PASS |
| Chrome e2e (bunx playwright test, GEMINI_API_KEY unset so the env-key define stays off) | PASS — incl. new provider-selection.spec.ts: provider+key persist; OpenAI lookup hits api.openai.com (Gemini count 0); pre-provider settings blob still looks up via Gemini |
| c3 check | PASS — 0 issues across 43 entities |
| Parent Delta | UPDATED — c3-1 Components row (c3-114 retitled lookup-clients), Responsibilities, Complexity Assessment rewritten; c3-2/c3-3 component bodies (c3-210, c3-212, c3-310, c3-312, c3-201, c3-301) synced; context topology unchanged |
| Browser evidence | e2e-evidence/provider-selection/*.png — Connection section with the AI-provider picker in both Gemini and OpenAI states, attached to the PR |
