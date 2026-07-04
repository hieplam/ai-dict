# ADR-001: Anthropic (Claude Haiku 4.5) as Third Provider + Silent Fallback Pool

**Date:** 2026-07-03
**Status:** Accepted
**Components:** c3-114 lookup-clients, c3-101 domain-types, c3-102 ports, c3-103 wire-protocol, c3-110 lookup-workflow, c3-210/c3-211/c3-212 Chrome shell, c3-301/c3-310/c3-311/c3-312 Safari shell

## Context

Users configure one AI provider (Gemini, OpenAI) to power lookups. If that provider fails — due to rate limits, quota exhaustion, transient network errors, or key expiry — the extension shows an error and the lookup fails. Users who hold keys for multiple providers have no automatic recourse.

We add Anthropic Claude Haiku 4.5 as a third provider and introduce a silent fallback pool: when the primary provider fails for any recoverable reason, the extension silently retries with the next configured provider, delivering a result with a subtle "via [Provider]" attribution note rather than an error.

## Decision

### New provider: `anthropic`

- **Model:** `claude-haiku-4-5-20251001`
- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Required headers:**
  - `x-api-key: <key>` (key ONLY here — never in URL, body, logs, or wire)
  - `anthropic-version: 2023-06-01`
  - `anthropic-dangerous-direct-browser-access: true` (required for direct browser fetch)
- **Request body:** `{ model, max_tokens: 1024, messages: [{ role: 'user', content: <prompt> }] }`
- **Parse:** `response.content[0].text`

### Type changes

- `Provider = 'gemini' | 'openai' | 'anthropic'` in `domain/types.ts`
- `Settings` gains `anthropicApiKey: string` (SW + options only, never on wire per S1)
- `PublicSettings` gains `configuredProviders: Provider[]` (names only — no keys per S1); computed by `hasKeyFor` logic at read time
- `LookupResult` gains `fallbackFrom?: Provider` (wire only — stripped before `cachePut`/`historyAppend` in the router, so cache/history entries always reflect the requested provider)

### Fallback pool ordering

Given `requested` provider and `configured = settings.configuredProviders`:

```
candidates = [requested, ...PROVIDERS.filter(p => p !== requested && configured.includes(p))]
```

Iteration: try each candidate in order. On failure, skip to next unless the error code is `offline` or `caller-cancel` (those stop the chain immediately — offline means no provider can succeed; cancel means the user aborted). On success, set `fallbackFrom = candidate` if `candidate !== requested`, then break.

### UI

- The result card badge shows the answering provider model name (existing behavior via `result.model`)
- A subtle inline note ("Answered by Anthropic — Gemini was unavailable") appears in the card when `fallbackFrom` is set; phrasing lives in the renderer, not domain

### Security (S1 invariant preserved)

- `anthropicApiKey` follows identical isolation to `apiKey` (Gemini) and `openaiApiKey`: stored only in `chrome.storage.local` inside the service worker and options page; transmitted only via the `x-api-key` request header; never placed in URL, request body, logs, or any wire message
- `PublicSettings` (the shape sent to content scripts over `chrome.runtime.sendMessage`) never carries any key — only `configuredProviders: Provider[]` (names only) is added
- `z.strictObject` in `wire.ts` enforces no extra fields, so a key cannot accidentally leak via the wire schema

## Alternatives Considered

**Hard-fail on primary provider failure** — rejected. When a user has backup keys configured, forcing them to manually switch providers degrades UX and defeats the purpose of multi-provider setup.

**Round-robin regardless of failure** — rejected. Rotating providers on every request leaks usage across multiple providers unnecessarily and makes cache behavior unpredictable.

## Consequences

- Users holding keys for 2–3 providers get automatic resilience against single-provider outages
- Cache key is unchanged (does not include provider), so fallback results can be served from cache on subsequent lookups using the original requested provider once it recovers
- Manual provider picks in the one-shot picker (≥2 providers configured) must bypass the cache read to ensure the explicitly-chosen provider is actually called; this is enforced by omitting `req.provider` from the cache lookup when a manual pick is active

## C3 Parent Delta

No change to c3-1 container responsibility. c3-114 lookup-clients expands from 2 to 3 `LookupClient` implementations; the fallback orchestration logic is new and lives in c3-114 (a new `ProviderPool` adapter). c3-101 domain-types gains `'anthropic'` in the `Provider` union and `anthropicApiKey` / `configuredProviders` fields. c3-103 wire-protocol gains `fallbackFrom` on `LookupResult`. No changes to c3-102 ports (the `LookupClient` interface is unchanged).
