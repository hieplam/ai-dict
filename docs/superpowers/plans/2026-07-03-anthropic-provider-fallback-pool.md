# Anthropic Provider + Fallback Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic (Claude) as a third lookup provider, plus a seamless fallback pool: when the selected provider fails for any reason, silently try the next configured provider; the card shows a provider badge, a subtle fallback note, and a one-shot manual provider picker.

**Architecture:** A new `AnthropicLookupClient` mirrors the OpenAI client (same deps-injection, timeout, typed-error contract). `createLookupClientSelector` becomes a fallback pool that walks configured providers in canonical order. The wire result/request gain optional `provider` fields; `PublicSettings` gains `configuredProviders` so the in-page UI can render the picker without ever seeing keys (S1).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), zod v4 wire schemas, Web Components (shadow DOM, `--ad-*` tokens only), vitest, Playwright e2e harness (bundled Chromium + unpacked extension), bun workspaces.

## Global Constraints

- Worktree: `/Users/home/repos/ai-dict/.claude/worktrees/anthropic-provider-pool` (branch `feat/anthropic-provider-pool`). Run `bun install` once before starting.
- `.c3/` is CLI-only. Shell handle: `c3() { C3X_MODE=agent bash /Users/home/.claude/skills/c3/bin/c3x.sh "$@"; }` (run inside the worktree).
- rule-api-key-isolation (S1): the Anthropic key lives ONLY in SW + options storage; header-only transmission; never in URL/body/logs/wire messages; `PublicSettings` never carries keys.
- rule-typed-errors: rejections are `Object.assign(new Error(msg), lookupError)`.
- rule-domain-purity: `packages/app/src/domain/*` keeps zero imports (domain-internal imports OK).
- rule-sanitize-model-output (S4): Claude markdown flows through the existing `sanitizeMarkdown` path only.
- rule-gate-runtime-messages (S3): wire schemas stay `z.strictObject`.
- UI styling: only `var(--ad-*)`/`var(--adp-*)` tokens; no hex; respect `prefers-reduced-motion`.
- Commits: conventional messages, NO Co-Authored-By lines. Never `--no-verify`.
- Model default: `claude-haiku-4-5-20251001`. Display names: Gemini, ChatGPT, Claude.
- Gates before PR: `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test`, `bun run build:chrome`, `bun run e2e:chrome`.

---

### Task 0: ADR + BEFORE evidence

**Files:** none in src (C3 CLI writes `.c3/adr/...`; screenshots to `/tmp/evidence-a/`)

- [ ] **Step 1: Capture BEFORE screenshots while the worktree is still at master.** `bun install && bun run build:chrome`, then add a temporary spec `packages/extension-chrome/e2e/before-evidence.spec.ts` (copy the structure of `evidence.spec.ts`) that: (1) opens the options page and screenshots to `/tmp/evidence-a/before-settings.png`; (2) runs the canonical lookup (`mockGemini`, `gotoFixture`, `selectWord(page,'t','bank')`, `openTrigger`) and screenshots the card to `/tmp/evidence-a/before-card.png`. Run only this spec: `cd packages/extension-chrome && bunx playwright test before-evidence`. Delete the temp spec afterwards (do not commit it).
- [ ] **Step 2: Create the ADR.** `c3 schema adr` first; read the REJECT IF block. Then `c3 add adr anthropic-provider-fallback-pool --file <body.md>` with a body that satisfies every section: context (2 providers today, c3-114 selector delegates per call), decision (third client + any-failure fallback pool + optional wire provider fields + configuredProviders in PublicSettings + one-shot picker), alternatives (retry-only fallback rejected: user chose any-failure; sticky provider switch rejected: next lookup keeps default), affected entities (c3-101, c3-103, c3-110, c3-111, c3-114, c3-115, c3-117, c3-201, c3-210, c3-212, c3-301, c3-310, c3-312), Parent Delta placeholder. Set `c3 set <adr-id> status accepted`. `c3 check` must pass.
- [ ] **Step 3: Commit** `git add -A .c3 docs/superpowers && git commit -m "docs(adr): accept anthropic provider + fallback pool work order"`

### Task 1: Domain types — Provider union, keys, result metadata, configuredProviders

**Files:**

- Modify: `packages/app/src/domain/types.ts`
- Test: `packages/app/test/types.test.ts`

**Interfaces produced (later tasks rely on these exact names):**

- `type Provider = 'gemini' | 'openai' | 'anthropic'`
- `const PROVIDERS: readonly Provider[]` (canonical order `['gemini','openai','anthropic']`)
- `Settings.anthropicApiKey: string`
- `LookupResult.provider?: Provider`, `LookupResult.fallbackFrom?: Provider`
- `PublicSettings.configuredProviders: Provider[]`
- `configuredProvidersFor(s, opts?): Provider[]`

- [ ] **Step 1: Write failing tests** — append to `packages/app/test/types.test.ts`:

```ts
import { hasKeyFor, configuredProvidersFor, PROVIDERS } from '../src/domain/types';

describe('anthropic provider domain', () => {
  it('canonical order is gemini, openai, anthropic', () => {
    expect(PROVIDERS).toEqual(['gemini', 'openai', 'anthropic']);
  });
  it('hasKeyFor uses anthropicApiKey when anthropic selected', () => {
    expect(hasKeyFor({ provider: 'anthropic', anthropicApiKey: 'sk-ant-x' })).toBe(true);
    expect(hasKeyFor({ provider: 'anthropic' })).toBe(false);
  });
  it('configuredProvidersFor lists only providers with keys, canonical order', () => {
    expect(configuredProvidersFor({ apiKey: 'g', anthropicApiKey: 'a' })).toEqual([
      'gemini',
      'anthropic',
    ]);
    expect(configuredProvidersFor({})).toEqual([]);
  });
  it('configuredProvidersFor counts env gemini key as configured', () => {
    expect(configuredProvidersFor({}, { envGeminiKey: true })).toEqual(['gemini']);
  });
});
```

- [ ] **Step 2: Run** `bun run test packages/app/test/types.test.ts` → FAIL (`configuredProvidersFor` not exported).
- [ ] **Step 3: Implement in `types.ts`:**
  - `export type Provider = 'gemini' | 'openai' | 'anthropic';` (extend union; update its doc comment).
  - `export const PROVIDERS: readonly Provider[] = ['gemini', 'openai', 'anthropic'];`
  - `LookupResult` gains two documented optional fields: `provider?: Provider;` (answering provider; absent on entries stored before this feature) and `fallbackFrom?: Provider;` (set only on live replies when the pool fell back; never persisted).
  - `PublicSettings` gains `configuredProviders: Provider[];` (names only — S1-safe).
  - `Settings` gains `anthropicApiKey: string;`.
  - `hasKeyFor` param type gains `anthropicApiKey?: string`; body:

```ts
export function hasKeyFor(s: {
  provider?: Provider;
  apiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}): boolean {
  const p = s.provider ?? 'gemini';
  if (p === 'openai') return Boolean(s.openaiApiKey);
  if (p === 'anthropic') return Boolean(s.anthropicApiKey);
  return Boolean(s.apiKey);
}
```

- New pure helper (used by both storage-store adapters):

```ts
/** Providers with a usable key, canonical order. envGeminiKey: a build-time
 *  Gemini key (Chrome env define) counts as configured even with no stored key. */
export function configuredProvidersFor(
  s: { apiKey?: string; openaiApiKey?: string; anthropicApiKey?: string },
  opts?: { envGeminiKey?: boolean },
): Provider[] {
  const has: Record<Provider, boolean> = {
    gemini: Boolean(s.apiKey) || Boolean(opts?.envGeminiKey),
    openai: Boolean(s.openaiApiKey),
    anthropic: Boolean(s.anthropicApiKey),
  };
  return PROVIDERS.filter((p) => has[p]);
}
```

- [ ] **Step 4:** `bun run test packages/app/test/types.test.ts` → PASS. If `packages/app/src/index.ts` uses explicit export lists, re-export `PROVIDERS` and `configuredProvidersFor` there (Task 6/8 import them via `../index` / `@ai-dict/app`). Note: `bun run typecheck` will FAIL until Tasks 2/8/9 update wire + adapters — expected mid-flight; do not "fix" by reverting.
- [ ] **Step 5: Commit** `git commit -am "feat(domain): anthropic provider, configuredProviders, result provider metadata"`

### Task 2: Wire schemas — provider fields + configuredProviders

**Files:**

- Modify: `packages/app/src/wire.ts`
- Test: `packages/app/test/wire-schema.test.ts`

**Interfaces produced:** request `provider?: Provider`; result `provider?/fallbackFrom?`; `PublicSettingsSchema.configuredProviders`. Domain `LookupRequest` gains `provider?: Provider` (in `types.ts`, same commit — the `AssertEqual` drift guard forces them to move together).

- [ ] **Step 1: Failing tests** — append to `packages/app/test/wire-schema.test.ts` (follow that file's existing parse-style):

```ts
it('lookup req accepts an optional provider override and rejects unknown providers', () => {
  const base = { word: 'w', context: 'c', url: '', title: '', target: 'vi', outputFormat: 'f' };
  const ok = WireMessageSchema.safeParse({
    type: 'lookup',
    requestId: '1',
    req: { ...base, provider: 'anthropic' },
  });
  expect(ok.success).toBe(true);
  const bad = WireMessageSchema.safeParse({
    type: 'lookup',
    requestId: '1',
    req: { ...base, provider: 'skynet' },
  });
  expect(bad.success).toBe(false);
});
it('lookup result carries optional provider + fallbackFrom; old results still parse', () => {
  const result = {
    markdown: 'm',
    word: 'w',
    target: 'vi',
    model: 'x',
    fromCache: false,
    fetchedAt: 1,
  };
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
  ).toBe(true);
  expect(
    WireReplySchema.safeParse({
      ok: true,
      type: 'lookup',
      requestId: '1',
      result: { ...result, provider: 'anthropic', fallbackFrom: 'gemini' },
    }).success,
  ).toBe(true);
});
it('settings reply includes configuredProviders', () => {
  const r = WireReplySchema.safeParse({
    ok: true,
    type: 'settings',
    settings: {
      targetLang: 'vi',
      outputFormat: 'f',
      hasKey: true,
      theme: 'sepia',
      configuredProviders: ['gemini'],
    },
  });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2:** Run the file → FAIL.
- [ ] **Step 3: Implement.** In `wire.ts` add `const ProviderSchema = z.enum(['gemini', 'openai', 'anthropic']);` then: `LookupRequestSchema` += `provider: ProviderSchema.optional()`; `LookupResultSchema` += `provider: ProviderSchema.optional(), fallbackFrom: ProviderSchema.optional()` (comment: optional so cached/history entries stored before this feature keep validating); `PublicSettingsSchema` += `configuredProviders: z.array(ProviderSchema)`. In `types.ts` add `provider?: Provider;` to `LookupRequest`. If the `AssertEqual` drift guard trips on optional-key inference, align the domain optionals to the zod inference (e.g. `provider?: Provider | undefined`) rather than weakening the schema — the guard staying `[true, true, true, true]` is the acceptance bar.
- [ ] **Step 4:** wire tests PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(wire): optional provider on lookup req/result, configuredProviders in settings"`

### Task 3: Error mapper knows Anthropic

**Files:** Modify `packages/app/src/domain/error-mapper.ts`; Test `packages/app/test/error-mapper.test.ts`

- [ ] **Step 1: Failing test:**

```ts
it('names Claude/Anthropic for anthropic-tagged errors', () => {
  expect(mapError({ kind: 'no-key', provider: 'anthropic' }).message).toBe(
    'Add your Claude API key in Settings.',
  );
  const e = mapError({ kind: 'http', status: 401, provider: 'anthropic' });
  expect(e.code).toBe('INVALID_KEY');
  expect(e.message).toBe('Anthropic rejected the API key.');
});
```

- [ ] **Step 2:** Run → FAIL (`NAMES` misses key). **Step 3:** Add to `NAMES`: `anthropic: { product: 'Claude', vendor: 'Anthropic' },` — no other mapper change (the `Record<Provider, …>` type now compiles again). **Step 4:** PASS. **Step 5: Commit** `git commit -am "feat(domain): anthropic wording in error mapper"`

### Task 4: AnthropicLookupClient

**Files:**

- Create: `packages/app/src/app/anthropic-lookup-client.ts`
- Modify: `packages/app/src/index.ts` (export it — mirror how `OpenAILookupClient` is exported)
- Test: `packages/app/test/app/anthropic-lookup-client.test.ts`

**Interfaces produced:** `class AnthropicLookupClient implements LookupClient`, `interface AnthropicDeps { fetch: FetchLike; getApiKey: () => string | Promise<string>; timeoutMs?: number; model?: string }`.

- [ ] **Step 1: Write the test file** by copying `packages/app/test/app/openai-lookup-client.test.ts` wholesale and adapting: endpoint `https://api.anthropic.com/v1/messages`; OK body `JSON.stringify({ content: [{ type: 'text', text: '## hi' }] })`; header assertions — captured request headers must contain `x-api-key: <key>` and `anthropic-version: '2023-06-01'` and `anthropic-dangerous-direct-browser-access: 'true'`; URL and body must NOT contain the key; body JSON must be `{ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: <prompt> }] }`; parse-failure case uses `{ content: [] }`; http-error case body `{ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }` with status 429 + `retry-after: '7'` header → expect `code: 'RATE_LIMIT'`, `retryAfterSec: 7`, `vendorMessage: 'slow down'`, `vendorStatus: 'rate_limit_error'`; success result must include `provider: 'anthropic'` and `model: 'claude-haiku-4-5-20251001'`. Keep the offline / timeout / caller-cancel / mapped-error-guard cases exactly as in the OpenAI suite.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement** — copy `openai-lookup-client.ts` structure verbatim (AbortController merge, timer, catch-order, `rejectWith`, trailing unreachable return) with these deltas:

```ts
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024; // card is capped at ~200 words; 1024 output tokens is ample

interface AnthropicOkBody {
  content?: { type?: string; text?: string }[];
}
interface AnthropicErrBody {
  type?: string;
  error?: { type?: string; message?: string };
}
```

- fetch call: `headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }`, body `JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] })`.
- !res.ok branch: parse `AnthropicErrBody`; pass `vendorMessage: body.error?.message` AND `vendorStatus: body.error?.type` into the http `ErrorInput`. NOTE: `ErrorInput.http` today has `geminiStatus` for vendorStatus — do NOT reuse `geminiStatus`; instead add an optional `vendorStatus?: string` member to the http variant in `error-mapper.ts` that flows into `diag` exactly like `geminiStatus` does (one-line addition: `...(input.vendorStatus !== undefined ? { vendorStatus: input.vendorStatus } : {})` merged with the existing geminiStatus spread; add a mapper unit test for it).
- success parse: `const text = parsed.content?.find((b) => b?.type === 'text')?.text;` then the same non-empty-string guard; return `{ markdown: text, word: req.word, target: req.target, model, provider: 'anthropic', fromCache: false, fetchedAt: Date.now() }`.
- all `mapError` provider tags: `'anthropic'`.
- [ ] **Step 4:** Anthropic suite PASS; run full `bun run test packages/app/test/app` and mapper tests.
- [ ] **Step 5: Commit** `git commit -am "feat(app): AnthropicLookupClient (claude-haiku-4-5-20251001, messages API)"`

### Task 5: Existing clients stamp their provider

**Files:** Modify `packages/app/src/app/gemini-lookup-client.ts`, `packages/app/src/app/openai-lookup-client.ts`; Tests: both existing client suites.

- [ ] **Step 1: Failing assertions** — in each suite's success test add `expect(out.provider).toBe('gemini' /* or 'openai' */);`.
- [ ] **Step 2:** FAIL. **Step 3:** Add `provider: 'gemini' as const` / `provider: 'openai' as const` to each client's returned `LookupResult`. **Step 4:** PASS. **Step 5: Commit** `git commit -am "feat(app): clients stamp answering provider on results"`

### Task 6: Fallback pool in the selector

**Files:** Modify `packages/app/src/app/lookup-client-selector.ts`; Test `packages/app/test/app/lookup-client-selector.test.ts`

**Interfaces produced:** `LookupClientSelectorDeps` gains `getConfiguredProviders: () => Provider[] | Promise<Provider[]>`. Behavior contract (consumed by both sw.ts files):

1. `requested = req.provider` if it is a key of `clients` AND (configured OR equal to `getProvider()` result); otherwise `await getProvider()`. Simplest correct rule: honor `req.provider` when it's a known provider, else use `getProvider()`.
2. Candidates: `[requested, ...PROVIDERS.filter(p => p !== requested && configured.includes(p))]` — requested runs even if keyless (its NO_KEY error then falls through to the next candidate: pure any-failure semantics).
3. Per candidate try/catch: caller-cancel (`opts?.signal?.aborted` and error is NOT `isLookupError`) → rethrow raw. Device offline (`navigator.onLine === false`) → rethrow (all providers share the network). Otherwise remember the FIRST error and continue.
4. All failed → throw first error. Success from candidate ≠ requested → `{ ...result, fallbackFrom: requested }`.

- [ ] **Step 1: Failing tests** — extend the existing suite (keep the two existing tests; they must stay green with `getConfiguredProviders` added to their deps). Add, following the existing `stubClient` helper style:

```ts
function failingClient(code = 'NETWORK'): LookupClient & { lookup: ReturnType<typeof vi.fn> } {
  return {
    lookup: vi.fn(() =>
      Promise.reject(Object.assign(new Error('boom'), { code, message: 'boom', retryable: true })),
    ),
  };
}
```

Tests: (1) _falls back to next configured provider on any failure and annotates fallbackFrom_ — gemini failing, openai stub, anthropic stub; getProvider 'gemini'; configured `['gemini','openai','anthropic']` → result model `gpt-4o-mini`, `fallbackFrom: 'gemini'`, gemini called once, anthropic never. (2) _skips unconfigured providers_ — configured `['gemini','anthropic']`, gemini fails → anthropic answers. (3) _throws the FIRST (requested) error when all fail_. (4) _req.provider override wins over getProvider and is one-shot input_ — getProvider 'gemini', `selector.lookup({ ...req, provider: 'anthropic' })` → anthropic called first. (5) _caller-cancel rethrows raw without trying next_ — client rejects `new DOMException('x','AbortError')` with an aborted signal → selector rejects with that same error, second client never called. (6) _no fallbackFrom when requested provider succeeds_. (7) _offline stops the chain_: `vi.stubGlobal('navigator', { onLine: false })` (mirror the client suites' stub/unstub pattern), gemini fails → rejects with gemini's error, openai never called.

- [ ] **Step 2:** FAIL (deps type + behavior). **Step 3: Implement** (complete replacement of the selector body):

```ts
import {
  PROVIDERS,
  type LookupClient,
  type LookupRequest,
  type LookupResult,
  type Provider,
} from '../index';

export interface LookupClientSelectorDeps {
  clients: Record<Provider, LookupClient>;
  getProvider: () => Provider | Promise<Provider>;
  /** Providers with a usable key, canonical order; resolved per lookup. */
  getConfiguredProviders: () => Provider[] | Promise<Provider[]>;
}

function isKnownProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

export function createLookupClientSelector(deps: LookupClientSelectorDeps): LookupClient {
  return {
    async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
      const requested = isKnownProvider(req.provider) ? req.provider : await deps.getProvider();
      const configured = await deps.getConfiguredProviders();
      const candidates: Provider[] = [
        requested,
        ...PROVIDERS.filter((p) => p !== requested && configured.includes(p)),
      ];
      let firstError: unknown;
      for (const p of candidates) {
        try {
          const result = await deps.clients[p].lookup(req, opts);
          return p === requested ? result : { ...result, fallbackFrom: requested };
        } catch (err) {
          // User-cancel is not a provider failure — propagate raw so the router suppresses.
          if (opts?.signal?.aborted && !isLookupErrorShape(err)) throw err;
          // Device offline: every provider shares the network; falling through is noise.
          if (navigator.onLine === false) throw err;
          firstError = firstError ?? err;
        }
      }
      throw firstError;
    },
  };
}

function isLookupErrorShape(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}
```

Update the two pre-existing tests to pass `getConfiguredProviders: () => ['gemini','openai']`. Keep the doc comment on the factory: rewrite it to describe the pool (per-call resolution unchanged; any-failure fall-through; offline/cancel stop; first error surfaces).

- [ ] **Step 4:** Suite PASS. **Step 5: Commit** `git commit -am "feat(app): lookup selector becomes any-failure fallback pool"`

### Task 7: Router — cache bypass on override, strip fallbackFrom on persist

**Files:** Modify `packages/app/src/app/router.ts`; Test `packages/app/test/app/router.test.ts`

- [ ] **Step 1: Failing tests** (follow the existing router suite's fake client/kv pattern): (1) _manual provider override skips the cache read_ — seed cache so a normal lookup hits, then send `req` with `provider: 'openai'` → client called, reply `fromCache` false. (2) _fallbackFrom never persists_ — client resolves `{ ..., provider: 'openai', fallbackFrom: 'gemini' }` with cache+history on → reply carries `fallbackFrom`, but the cachePut'd value and the history entry's `result` do NOT have a `fallbackFrom` key (assert `'fallbackFrom' in stored === false`), while `provider: 'openai'` IS persisted.
- [ ] **Step 2:** FAIL. **Step 3: Implement** in `handleLookup`:
  - Cache read gate: `if (cacheEnabled && req.provider === undefined) { …cacheGet… }` (comment: a manual pick must reach the picked provider — the cache key ignores provider, so a hit would echo the old answer back).
  - After `deps.client.lookup(...)`: `const { fallbackFrom: _transient, ...persistable } = result;` use `persistable` for `cachePut` and for the `HistoryEntry.result`; keep replying with the full `result`.
- [ ] **Step 4:** Router suite PASS. **Step 5: Commit** `git commit -am "feat(app): router honors provider override and strips transient fallbackFrom"`

### Task 8: Storage stores + SW wiring + manifests (both shells)

**Files:**

- Modify: `packages/extension-chrome/src/adapters/chrome-storage-store.ts`, `packages/extension-safari/src/adapters/safari-storage-store.ts` (mirror), `packages/extension-chrome/src/sw.ts`, `packages/extension-safari/src/sw.ts`, `packages/extension-chrome/src/manifest.json`, `packages/extension-safari/src/manifest.json`
- Test: `packages/extension-chrome/src/adapters/*.test.ts` if a store test exists (check `ls packages/extension-chrome/src/adapters`); otherwise adapter behavior is covered by the e2e task.

- [ ] **Step 1: Storage stores.** Both `defaults()` gain `anthropicApiKey: ''` and `configuredProviders: []`. Both `get()` return `configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey })` — add a second ctor param `private readonly envGeminiKey = false` to `ChromeStorageStore` (Safari store keeps no env path; pass nothing). Import `configuredProvidersFor` from `@ai-dict/app`.
- [ ] **Step 2: Chrome sw.ts.** `readFullSettings()` fallback object gains `anthropicApiKey: ''` and `configuredProviders: []`. Add `AnthropicLookupClient` to the import list and to the clients record:

```ts
anthropic: new AnthropicLookupClient({
  fetch: (u, i) => fetch(u, i),
  getApiKey: async () => (await readFullSettings()).anthropicApiKey ?? '',
}),
```

Selector deps gain:

```ts
getConfiguredProviders: async () =>
  configuredProvidersFor(await readFullSettings(), { envGeminiKey: Boolean(ENV_API_KEY) }),
```

Settings store construction: `new ChromeStorageStore(chrome.storage.local, Boolean(ENV_API_KEY))`.

- [ ] **Step 3: Safari sw.ts.** Same clients-record + `getConfiguredProviders: async () => configuredProvidersFor(await readFullSettings())` (no env), defaults object gains the two new fields.
- [ ] **Step 4: Manifests.** In BOTH `manifest.json` files add `"https://api.anthropic.com/*"` to `host_permissions` (alongside the existing Gemini/OpenAI hosts — confirm the key name in each file and match its style).
- [ ] **Step 5:** `bun run typecheck` now passes workspace-wide (Tasks 1–8 close the loop). `bun run build:chrome` and `bun run build:safari` succeed.
- [ ] **Step 6: Commit** `git commit -am "feat(shells): wire anthropic client, configured providers, host permissions"`

### Task 9: Settings form + options pages carry the Claude key

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`, `packages/extension-chrome/src/options.ts`, `packages/extension-safari/src/options.ts`
- Test: `packages/app/test/ui/settings-form.test.ts` (check `ls packages/app/test/ui` for the exact file; extend it in its own style)

**Context (read these anchors first):** `settings-form.ts` keeps one `_keys: Record<Provider, string>` stash, a `KEY_LABEL: Record<Provider, string>` map, a `<select id="provider">` with two options, and a `value` getter/setter mapping to `SettingsFormValue { provider, apiKey, openaiApiKey, … }`. `options.ts` maps `Settings` ⇄ `SettingsFormValue` in `toFormValue()` and persists on the form's `save` event via `hasKeyFor(next)`.

**Concurrency note:** another branch adds an "Advanced" prompt section to this same file. Keep every edit additive and localized; do not reorder or reformat existing markup.

- [ ] **Step 1: Failing test** — extend the settings-form UI suite: setting `value` with `{ provider: 'anthropic', anthropicApiKey: 'sk-ant-1', … }` renders the select with `anthropic` chosen and key label `Anthropic API key`; editing the key field and reading `value` back returns `anthropicApiKey: 'sk-ant-1-edited'` while `apiKey`/`openaiApiKey` survive untouched (the per-provider stash contract).
- [ ] **Step 2:** FAIL. **Step 3: Implement:**
  - `SettingsFormValue` gains `anthropicApiKey: string;`.
  - `KEY_LABEL` gains `anthropic: 'Anthropic API key',`.
  - Provider select gains `<option value="anthropic">Claude (Anthropic)</option>`.
  - `_keys` init becomes `{ gemini: '', openai: '', anthropic: '' }`.
  - `value` getter adds `anthropicApiKey: this._keys.anthropic,`; setter adds `anthropic: v.anthropicApiKey ?? ''` to the stash rebuild.
  - Env-lock logic (`isKeyLocked`) is Gemini-only — needs no change; verify the key row re-render path (`#key-label`, stash-before-switch) handles the third provider purely via the Records.
- [ ] **Step 4:** In both `options.ts` files: `DEFAULTS` gains `anthropicApiKey: ''` and `configuredProviders: []`; `toFormValue()` maps `anthropicApiKey: s.anthropicApiKey,`. Chrome and Safari are near-mirrors — apply the same two edits in each.
- [ ] **Step 5:** UI suite PASS; `bun run typecheck` PASS. **Step 6: Commit** `git commit -am "feat(ui): Claude provider option + Anthropic key field in settings"`

### Task 10: Workflow — configured-providers gate + one-shot picker re-lookup

**Files:**

- Modify: `packages/app/src/domain/workflow.ts`, `packages/app/src/ports.ts`
- Test: `packages/app/test/workflow.test.ts`

**Interfaces produced (Task 11 consumes):**

- `ports.ts`: `ResultRenderer.renderResult(r: LookupResult, ctx?: ResultRenderContext): void` and

```ts
export interface ResultRenderContext {
  /** Providers the reader may switch to (>=2 entries or omitted). */
  providers?: Provider[];
  /** Re-run the SAME lookup once with this provider; does not persist. */
  onSwitchProvider?: (p: Provider) => void;
}
```

(import `Provider` into `ports.ts` from `./domain/types`).

- [ ] **Step 1: Failing tests** (extend `workflow.test.ts` using its existing fake deps):
  1. _gates on configuredProviders, not hasKey_: settings `{ hasKey: false, configuredProviders: ['openai'] }` → lookup FIRES (no NO_KEY error).
  2. _renders no-key when nothing configured_: `{ hasKey: false, configuredProviders: [] }` → `renderError` with `code NO_KEY`, client never called.
  3. _passes picker context on success_: settings with `configuredProviders: ['gemini','openai']` → `renderResult` called with a 2nd arg whose `providers` equals that list and whose `onSwitchProvider` is a function.
  4. _switch re-runs same selection with provider override_: capture `ctx.onSwitchProvider` from the first render, call it with `'openai'` → client called again with `req.provider === 'openai'` and same word/context; `renderLoading` shown again; cooldown does NOT block it.
  5. _no picker context with a single configured provider_: `configuredProviders: ['gemini']` → 2nd arg omitted or `providers` undefined.
- [ ] **Step 2:** FAIL. **Step 3: Implement** in `workflow.ts`:
  - Update `PublicSettings` consumers: gate becomes `if (settings.configuredProviders.length === 0) { renderError(no-key); return; }` (replaces the `!settings.hasKey` check; `hasKey` remains for the settings UI).
  - `runLookup(e: SelectionEvent, providerOverride?: Provider)`: build `req` as today, then `if (providerOverride) req.provider = providerOverride;` (with `LookupRequest.provider?` from Task 2).
  - After a successful lookup, render with context:

```ts
const ctx: ResultRenderContext | undefined =
  settings.configuredProviders.length >= 2
    ? {
        providers: settings.configuredProviders,
        onSwitchProvider: (p) => {
          void runLookup(e, p).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        },
      }
    : undefined;
if (!controller.signal.aborted) deps.renderer.renderResult(result, ctx);
```

- The picker path calls `runLookup` directly (bypasses the trigger-click cooldown gate by design — a deliberate switch is not Define-spam; note this in a one-line comment).
- [ ] **Step 4:** Workflow suite PASS (update any existing tests constructing `PublicSettings` to include `configuredProviders`). **Step 5: Commit** `git commit -am "feat(domain): workflow gates on configured providers and offers one-shot provider switch"`

### Task 11: Card UI — badge, fallback note, picker menu

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`, `packages/app/src/app/inline-bottom-sheet-renderer.ts`, `packages/extension-chrome/src/side-panel.ts` (badge only), `packages/app/src/ui/side-panel-view.ts` (only if it forwards CardState types)
- Test: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts` + the ui suite for `renderCardState`

**Design (locked):**

- `CardState` result variant gains `provider?: Provider; fallbackFrom?: Provider; providers?: Provider[];`.
- New UI constant `export const PROVIDER_LABELS: Record<Provider, string> = { gemini: 'Gemini', openai: 'ChatGPT', anthropic: 'Claude' };` in `lookup-card.ts`.
- `renderCardState` appends, after the body div, a light-DOM `<div class="meta-row">` containing:
  - a `<span class="prov-badge">` with text `PROVIDER_LABELS[provider]` (skip the whole row when `provider` is undefined — e.g. entries cached before this feature);
  - when `fallbackFrom` present: `<span class="fallback-note">` with text `` `${PROVIDER_LABELS[fallbackFrom]} unavailable — answered by ${PROVIDER_LABELS[provider]}` ``;
  - when `providers` has ≥2 entries: a `<button class="prov-switch" aria-haspopup="listbox">` labeled `Switch` that toggles an inline `<span class="prov-menu" role="listbox">` of per-provider `<button role="option" data-provider="gemini|openai|anthropic">` entries (current one `aria-selected="true"` and disabled). Each option dispatches `new CustomEvent('switch-provider', { detail: { provider }, bubbles: true, composed: true })`. Keyboard access = native buttons; no custom key handling needed.
- Styling via `::slotted(.meta-row)` etc. in the card's `CSS` constant: muted `var(--ad-ink-faint)`, `font-size: var(--adp-text-2xs)`, badge gets a subtle `border: 1px solid var(--ad-line); border-radius: var(--adp-radius-control); padding: 1px 7px`; `.fallback-note` plain italic; menu buttons reuse the hover pattern `background: var(--ad-surface-raised)`. Tokens ONLY.
- `InlineBottomSheetRenderer.renderResult(r, ctx)`: forward metadata into state — `provider: r.provider, fallbackFrom: r.fallbackFrom, providers: ctx?.providers` (only set keys that are defined — `exactOptionalPropertyTypes`); in `ensureCard()` attach once: `card.addEventListener('switch-provider', (e) => this.onSwitch?.((e as CustomEvent<{ provider: Provider }>).detail.provider))` where `onSwitch` is a private field updated on every `renderResult` from `ctx?.onSwitchProvider`.
- `side-panel.ts` line ~46 builds a result CardState: add `provider: r.provider, fallbackFrom: r.fallbackFrom` (no picker — omit `providers`), guarding undefined keys the same way.

- [ ] **Step 1: Failing tests:** renderer suite — `renderResult` with `{ provider: 'anthropic', fallbackFrom: 'gemini' }` and ctx `{ providers: ['gemini','anthropic'], onSwitchProvider: spy }` produces light DOM containing badge text `Claude`, note text `Gemini unavailable — answered by Claude`, and a `.prov-switch` button; clicking a menu option button fires the spy with `'gemini'`. `renderCardState` unit: result without `provider` renders NO `.meta-row`; result with `providers` of length 1 renders no `.prov-switch`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement per the locked design. **Step 4:** Suites PASS. Also run the FULL unit suite — `bun run test` — to catch CardState consumers. **Step 5: Commit** `git commit -am "feat(ui): provider badge, fallback note, one-shot provider picker on the card"`

### Task 12: e2e — mockAnthropic + badge/fallback/picker specs + seedSettings

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/provider-fallback.spec.ts`
- Reference: `packages/extension-chrome/e2e/provider-selection.spec.ts` (existing patterns for provider e2e), `lookup.spec.ts`

- [ ] **Step 1: helpers.ts additions** (mirror the OpenAI block exactly):

```ts
export const ANTHROPIC_GLOB = 'https://api.anthropic.com/**';
export const ANTHROPIC_OK_BODY = JSON.stringify({
  content: [{ type: 'text', text: '## bank\nA financial institution (via Claude).' }],
});
export async function mockAnthropic(
  context: BrowserContext,
  opts: MockGeminiOpts = {},
): Promise<{ count: number }> {
  /* copy mockOpenAI body, swap GLOB + OK body */
}
```

`SettingsOverrides` gains `anthropicApiKey?: string` and widens `provider` to `'gemini' | 'openai' | 'anthropic'`; `seedSettings` defaults add `anthropicApiKey: ''`.

- [ ] **Step 2: Spec `provider-fallback.spec.ts`** (use the fixtures/`test` export from `./fixtures` like the other specs):
  1. _badge shows answering provider_: seed `{ provider: 'gemini' }`, `mockGemini`, run the canonical lookup (`gotoFixture`, `selectWord`, `openTrigger`), expect card light DOM to contain badge text `Gemini`.
  2. _any-failure fallback with note_: seed `{ provider: 'gemini', anthropicApiKey: 'sk-ant-e2e' }`, `mockGemini(context, { status: 500 })`, `mockAnthropic(context)` → card renders the Claude body, badge `Claude`, note contains `Gemini unavailable`; gemini mock count === 1, anthropic count === 1.
  3. _one-shot picker_: seed `{ provider: 'gemini', openaiApiKey: 'sk-e2e' }`, mock both OK, lookup → badge `Gemini`; click `.prov-switch`, click the `ChatGPT` option → card re-renders with badge `ChatGPT` and openai count === 1; select the word again and lookup → badge `Gemini` again (default restored; cache note: the picker lookup overwrote the cache entry with OpenAI's answer — cover this by asserting the SECOND default lookup serves `fromCache` content with badge `ChatGPT`? NO — keep it deterministic: seed `cacheEnabled: false` for this test).
- [ ] **Step 3:** `bun run build:chrome && bun run e2e:chrome` → all specs green (including the pre-existing suite: `provider-selection.spec.ts` exercises the selector deps — update its seeds if `configuredProviders`-related changes surface).
- [ ] **Step 4: Commit** `git commit -am "test(e2e): anthropic mock, fallback + picker flows"`

### Task 13: C3 docs, AFTER evidence, PR

**Files:** `.c3/` via CLI only; `/tmp/evidence-a/`; PR.

- [ ] **Step 1: C3 updates** (each via `c3 write <id> --section <name>` / `c3 set`): c3-114 goal+body (three providers incl. Anthropic `messages` REST + the fallback-pool selector semantics), c3-101 (Provider union, configuredProviders, result metadata), c3-103 (new optional wire fields), c3-110 (configured-providers gate + picker context), c3-111 (cache bypass on override, fallbackFrom strip), c3-117 (badge/note/picker), c3-210/c3-310 (anthropic wiring + host permission), c3-212/c3-312 (Claude key field). Fill the ADR Parent Delta, `c3 set <adr-id> status implemented`. `c3 check` → 0 errors.
- [ ] **Step 2: AFTER evidence** — reuse the harness: screenshots `after-settings.png` (Claude option visible + key field), `after-card-badge.png`, `after-fallback-note.png`, `after-picker-open.png` into `/tmp/evidence-a/`; record a short video of the fallback + picker flow (see `media-demos.spec.ts` for the repo's recordVideo pattern; save as `provider-fallback.webm`).
- [ ] **Step 3: Evidence hosting** — `git checkout --orphan pr-assets/anthropic-provider-pool && git rm -rf .` (in a TEMP clone or via a second worktree — never disturb the feature branch), commit the PNGs/webm, push. Embed as `https://github.com/<owner>/<repo>/raw/pr-assets/anthropic-provider-pool/<file>` (owner/repo via `gh repo view --json nameWithOwner`). NEVER raw.githubusercontent.com.
- [ ] **Step 4: Final gates** — `bun run lint && bun run format:check && bun run typecheck && bun run test && bun run build:chrome && bun run build:safari && bun run e2e:chrome` all green.
- [ ] **Step 5: PR** — push `feat/anthropic-provider-pool`, `gh pr create` to master: summary; fallback semantics (any failure → next configured, offline/cancel stop the chain, first error surfaces, manual pick one-shot + cache-bypassed); S1 note (key header-only, configuredProviders is names-only); Before/After evidence; test plan. Do NOT merge.
