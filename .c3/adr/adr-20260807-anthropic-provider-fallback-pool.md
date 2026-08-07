---
id: adr-20260807-anthropic-provider-fallback-pool
c3-seal: 50e31bb33b69653c5968963830e872bd96003fc7d8d5cbe91fdd112cedecbe23
title: anthropic-provider-fallback-pool
type: adr
goal: |-
    Add Anthropic (Claude Haiku 4.5, model `claude-haiku-4-5-20251001`) as the third lookup
    provider and introduce a silent fallback pool: when the requested provider fails for a
    recoverable reason, the lookup silently retries the next configured provider and delivers the
    result with a "via [Provider]" attribution instead of an error. (Historical import: decided and
    accepted 2026-07-03 as `docs/adr/ADR-001`, implemented and shipped; relocated into `.c3/adr/`
    by the 2026-08-07 docs audit so ADRs have one home.)
status: done
date: "2026-08-07"
---

# anthropic-provider-fallback-pool

## Goal

Add Anthropic (Claude Haiku 4.5, model `claude-haiku-4-5-20251001`) as the third lookup
provider and introduce a silent fallback pool: when the requested provider fails for a
recoverable reason, the lookup silently retries the next configured provider and delivers the
result with a "via [Provider]" attribution instead of an error. (Historical import: decided and
accepted 2026-07-03 as `docs/adr/ADR-001`, implemented and shipped; relocated into `.c3/adr/`
by the 2026-08-07 docs audit so ADRs have one home.)

## Context

Users configure one AI provider (Gemini, OpenAI) to power lookups. If that provider fails —
rate limits, quota exhaustion, transient network errors, key expiry — the extension shows an
error and the lookup fails. Users who hold keys for multiple providers have no automatic
recourse. The provider-client seam already exists (`LookupClient` port, one implementation per
provider in c3-114 lookup-clients), so a third provider plus a pool orchestrator fits the
existing topology without new ports. The S1 invariant (API keys never leave the service worker

- options page) constrains every new settings field and wire shape this change adds.

## Decision

New `anthropic` provider: `POST https://api.anthropic.com/v1/messages` with headers
`x-api-key: <key>` (key ONLY here — never in URL, body, logs, or wire),
`anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true`
(required for direct browser fetch); body
`{ model, max_tokens: 1024, messages: [{ role: 'user', content: <prompt> }] }`; parse
`response.content[0].text`.

Type changes: `Provider = 'gemini' | 'openai' | 'anthropic'` in `domain/types.ts`; `Settings`
gains `anthropicApiKey` (SW + options only, never on wire per S1); `PublicSettings` gains
`configuredProviders: Provider[]` (names only — no keys); `LookupResult` gains
`fallbackFrom?: Provider` (wire only — stripped before `cachePut`/`historyAppend` in the
router, so cache/history entries always reflect the requested provider).

Fallback pool ordering: `candidates = [requested, ...PROVIDERS.filter(p => p !== requested &&
configured.includes(p))]`. Try each in order; on failure skip to the next unless the error code
is `offline` or `caller-cancel` (those stop the chain — offline means no provider can succeed;
cancel means the user aborted). On success set `fallbackFrom = candidate` when it differs from
`requested`. The orchestration lives in a new `ProviderPool` adapter in c3-114; the
`LookupClient` port is unchanged.

UI: the result card badge keeps showing the answering model (`result.model`); a subtle inline
note ("Answered by Anthropic — Gemini was unavailable") renders when `fallbackFrom` is set;
phrasing lives in the renderer, not domain.

Consequences accepted with the decision: the cache key is unchanged (no provider component), so
fallback results serve later cache hits for the originally requested provider; manual provider
picks in the one-shot picker bypass the cache read so the explicitly-chosen provider is actually
called.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | System-level product behavior changes: lookups survive single-provider outages via the silent fallback pool; the third provider becomes part of the product promise | c3-0#n2@v1:sha256:d141dc4219590f2e7be18a105ed26d33cdfbd271de0a806d6814bcbcfd9cedb1 | c3 check after import; no system-shape change |
| c3-1 | container | The portable core hosts every code change of this decision (types, wire, workflow, clients) across its components listed below | c3-1#n1481@v1:sha256:6a7590288584cbb1b3ef4e26491291ccdaf9ebd9aa0b05fdeffa5ac1026ba117 | rule-domain-purity (core stays chrome-free); ref-core-dependency-rule |
| c3-114 | component | Gains the AnthropicClient implementation and the new ProviderPool fallback orchestrator (2 → 3 LookupClient implementations) | c3-114#n1923@v1:sha256:68e420aba47086ac21259dfde7631f24bf675edaea3e11f6f9b03710b7221c3d | rule-api-key-isolation (key only in x-api-key header); ref-dependency-injection (pool injected at composition roots) |
| c3-101 | component | Provider union gains 'anthropic'; Settings gains anthropicApiKey; PublicSettings gains configuredProviders | c3-101#n1507@v1:sha256:3ebee20d2a933b186db7b2899b405c5964be5a62c8b2ce2f3fad5c0d0ca9f581 | rule-domain-purity (types stay dependency-free) |
| c3-103 | component | LookupResult gains fallbackFrom?: Provider on the wire; z.strictObject keeps keys off the wire | c3-103#n1626@v1:sha256:d6144c522f0309586560504cffc5ac2ddd8374436245168fabb0292978574b5b | ref-wire-protocol-validation; rule-api-key-isolation (S1) |
| c3-110 | component | Lookup workflow routes through the pool and strips fallbackFrom before persistence | c3-110#n1684@v1:sha256:2bf4da151e3d75c680bb25401adf0cf599a03c1f008ad69f6aeb5a148b25332c | rule-domain-purity |
| c3-2 | container | Chrome options page gains Anthropic key entry; SW composition root wires the pool | c3-2#n2231@v1:sha256:c820f0149f01cb95bbcdf6c162ae7833e40259f30adccc7ccfb000c74863f2ea | rule-api-key-isolation (key stays in SW + options page) |
| c3-3 | container | Safari shell mirrors the same wiring and options surface | c3-3#n2499@v1:sha256:964fb0410a2aef92d49d92daa44a76e29a0fe106c29f1961c0a45c5fa49ebf21 | rule-api-key-isolation |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hard-fail on primary provider failure (status quo) | When a user has backup keys configured, forcing a manual provider switch degrades UX and defeats the purpose of multi-provider setup |
| Round-robin across providers regardless of failure | Rotating providers on every request leaks usage across providers unnecessarily and makes cache behavior unpredictable |

## Verification

| Check | Result |
| --- | --- |
| bun run lint — incl. scripts/hard-rule/check-key-isolation.mjs proving anthropicApiKey stays in SW + options page (S1) | 6/6 scanners pass, eslint clean (standing commit + CI gate) |
| bun run --filter @ai-dict/app test wire-schema — wire schema strips keys, accepts fallbackFrom | Passing in CI (wire-schema contract suite) |
| bun run --filter @ai-dict/app test — pool ordering, offline/caller-cancel short-circuit, fallbackFrom stripping before cache/history | Passing in CI (unit suite) |
