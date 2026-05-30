---
bundle: "02"
title: core
status: DONE
locked_by: ""
locked_at: ""
done_at: "2026-05-30T07:23:05Z"
prereqs: ["01"]
owns_files:
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - packages/core/src/types.ts
  - packages/core/src/ports.ts
  - packages/core/src/prompt-template.ts
  - packages/core/src/cache-policy.ts
  - packages/core/src/history-policy.ts
  - packages/core/src/default-template.ts
  - packages/core/src/wire-schema.ts
  - packages/core/src/error-mapper.ts
  - packages/core/src/workflow.ts
  - packages/core/src/index.ts
  - packages/core/wire-schema.snapshot.json
  - packages/core/test/fakes/**
  - packages/core/test/fixtures/gemini-responses/**
  - packages/core/test/*.test.ts
---

# Bundle 02 — core/ (pure domain)

**Purpose:** The browser-free hexagonal center: port interfaces, domain types, the lookup workflow orchestrator, pure policies (prompt-template, cache-policy LRU, history-policy FIFO), the default prompt template, the Gemini→`LookupError` mapper, and zod wire schemas with a committed JSON-schema snapshot. Ships shared fakes + fixtures consumed by downstream test suites. **Zero IO, zero browser API.** This bundle freezes the contracts the whole monorepo codes against.

## Lock protocol
Verify prereq `01-scaffold.md` has `status: DONE`. Flip this YAML → LOCKED, set `locked_by`/`locked_at`, commit `[02] lock`, `git pull --rebase`, abort on racing lock. Execute.

## Inputs
- Bundle 01 DONE: workspace resolution, `tsconfig.base.json`, eslint hex rules, vitest workspace.
- Spec §5.1, §5.2 (ports), §6.1 (wire/types), §6.9 (error map), §6.11 (cache key), §8.5 (wire snapshot), Appendix A (default template).

## Outputs (frozen contracts — see README contracts table)
- `ports.ts`: `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage`, `PublicSettings`, `Settings` (exactly per §5.2).
- `types.ts`: `LookupRequest`, `LookupResult`, `LookupError`, `SelectionEvent`, `AnchorRect`, `HistoryEntry` (§6.1).
- `workflow.ts`: `runLookupWorkflow(deps)` orchestrating steps [1]–[5] over ports only, incl. NO_KEY short-circuit (§6.7) and loading/result/error rendering.
- `prompt-template.ts`: substitutes only placeholders present in the template (data minimization, Appendix A list).
- `cache-policy.ts`: `deriveCacheKey` (FNV-1a 64-bit hex) + LRU (cap 1000) over `Storage`.
- `history-policy.ts`: append + paged list (`limit`/`cursor`) + clear; newest-first, cap 500 FIFO.
- `default-template.ts`: the Appendix A string.
- `error-mapper.ts`: `mapError` implementing the §6.9 table.
- `wire-schema.ts`: zod schemas for every `WireMessage`/`WireReply` variant + a snapshot exporter; `wire-schema.snapshot.json` committed.
- `test/fakes/**`: fake `SelectionSource`, `TriggerUI`, `ResultRenderer`, `LookupClient`, `SettingsStore`, `Storage`, re-exported as `@ai-dict/core/test/fakes`.
- `test/fixtures/gemini-responses/**`: success, INVALID_KEY (400+403), RATE_LIMIT (429 ±Retry-After), 5xx, malformed JSON, prompt-injection-in-markdown (§8.11).

## Definition of Done
- D1: All port interfaces + types compile and match §5.2 / §6.1 signatures exactly.
- D2: `runLookupWorkflow` happy path, NO_KEY short-circuit, lookup-error rendering, and cancellation (§6.8) covered by tests using fakes. (Cache hit/miss is an SW concern — covered by `cache-policy` tests in Task D and the router tests in Bundles 05/06, not the content workflow.)
- D3: `prompt-template` substitutes only present placeholders; absent placeholders (e.g. `{url}`) are NOT injected (data-minimization test).
- D4: `cache-policy` LRU evicts at cap 1000, `deriveCacheKey` is deterministic + collision-stable on fixtures; pure (no async crypto).
- D5: `history-policy` newest-first ordering, paging via cursor, cap-500 FIFO eviction, clear — all tested.
- D6: `error-mapper` maps every §6.9 row to the correct `code` + `retryable`; messages sanitized to ≤200 chars with key value scrubbed.
- D7: `wire-schema` zod schemas accept valid and reject malformed messages; `wire-schema.snapshot.json` is committed and stable — the core snapshot test passes without `-u` (re-run is identical). (`pnpm wire:check`, owned by Bundle 07, consumes `wireJsonSchema()` later.)
- D8: **[S1 security]** Neither `PublicSettings` nor any `WireReply` variant carries `apiKey`; a test asserts `apiKey` is absent from the `settings` reply schema.
- D9: Package coverage ≥ 90% (spec §8.2). Lint clean: `core/src/**` imports nothing from adapters/ui/extensions.

## Implementation steps

> Internal dependency order: package setup → types/ports → default-template → prompt-template → cache-policy → history-policy → error-mapper → wire-schema (+snapshot) → fakes → workflow. Run `vitest` filtered to this package: `pnpm --filter @ai-dict/core test`. Commit after each task.

### Task A — Package setup + types + ports

**Files:** Create `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/types.ts`, `packages/core/src/ports.ts`, `packages/core/src/index.ts`.

- [ ] **A1: `packages/core/package.json`**

```json
{
  "name": "@ai-dict/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./test/fakes": "./test/fakes/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { "@types/node": "^20.11.0" }
}
```
Then: `pnpm install` (links workspace + adds zod). Note: core ships source `.ts` via `exports` — no build step; each extension's esbuild bundles it. `@types/node` types the universal globals `AbortController`/`TextEncoder` while `lib` stays DOM-free (purity preserved).

- [ ] **A2: `packages/core/tsconfig.json`** (extends DOM-free base)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

- [ ] **A3: `packages/core/vitest.config.ts`** (Node env + 90% coverage gate — spec §8.2)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```

- [ ] **A4: `packages/core/src/types.ts`** (domain types — spec §6.1, §5.2 Settings)

```ts
export interface AnchorRect { x: number; y: number; w: number; h: number; }

export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
}

export interface LookupRequest {
  word: string;
  context: string;
  url: string;
  title: string;
  target: string;
  promptTemplate: string;
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  model: 'gemini-2.5-flash';
  fromCache: boolean;
  fetchedAt: number;
}

export type LookupErrorCode =
  | 'NO_KEY' | 'INVALID_KEY' | 'RATE_LIMIT' | 'NETWORK' | 'PARSE' | 'UNKNOWN';

export interface LookupError {
  code: LookupErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSec?: number;
}

export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
}

export interface PublicSettings {
  targetLang: string;
  promptTemplate: string;
  hasKey: boolean;
}

export interface Settings extends PublicSettings {
  apiKey: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
}

export function isLookupError(e: unknown): e is LookupError {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && 'message' in e && 'retryable' in e
  );
}
```

- [ ] **A5: `packages/core/src/ports.ts`** (port interfaces — spec §5.2, verbatim signatures)

```ts
import type {
  AnchorRect, SelectionEvent, LookupRequest, LookupResult, LookupError, PublicSettings,
} from './types';

export interface SelectionSource {
  onSelection(cb: (e: SelectionEvent) => void): () => void;
}

export interface TriggerUI {
  show(anchor: AnchorRect, onClick: () => void): void;
  hide(): void;
}

export interface ResultRenderer {
  renderLoading(): void;
  renderResult(r: LookupResult): void;
  renderError(e: LookupError): void;
  close(): void;
}

export interface LookupClient {
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult>;
}

export interface SettingsStore {
  get(): Promise<PublicSettings>;
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void>;
}

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}
```

- [ ] **A6: `packages/core/src/index.ts`** (public surface — append exports as each module lands)

```ts
export * from './types';
export * from './ports';
```

- [ ] **A7: Typecheck + commit**

Run: `pnpm --filter @ai-dict/core typecheck` → PASS (no errors).
```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/{types,ports,index}.ts pnpm-lock.yaml
git commit -m "feat(core): package setup, domain types, port interfaces"
```

### Task B — default-template

**Files:** Create `packages/core/src/default-template.ts`, `packages/core/test/default-template.test.ts`.

- [ ] **B1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_TEMPLATE } from '../src/default-template';

describe('DEFAULT_TEMPLATE', () => {
  it('references the minimal placeholders and ordered sections', () => {
    expect(DEFAULT_TEMPLATE).toContain('{word}');
    expect(DEFAULT_TEMPLATE).toContain('{context}');
    expect(DEFAULT_TEMPLATE).toContain('{target_lang}');
  });
  it('does NOT reference {url} or {title} (data minimization — spec P2)', () => {
    expect(DEFAULT_TEMPLATE).not.toContain('{url}');
    expect(DEFAULT_TEMPLATE).not.toContain('{title}');
  });
});
```
Run: `pnpm --filter @ai-dict/core test default-template` → FAIL (module not found).

- [ ] **B2: Implement** `packages/core/src/default-template.ts` (spec Appendix A, verbatim)

```ts
export const DEFAULT_TEMPLATE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"

Output Markdown with sections in this exact order:
1. **IPA**
2. **Part of Speech (POS)**
3. **Eng -> Eng** (learner-style definition in simple English)
4. **Eng -> {target_lang}** (translation)
5. **Example** (one short sentence in English + its {target_lang} translation)

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;
```
Add `export * from './default-template';` to `index.ts`. Run test → PASS. Commit `feat(core): default prompt template`.

### Task C — prompt-template

**Files:** Create `packages/core/src/prompt-template.ts`, `packages/core/test/prompt-template.test.ts`.

- [ ] **C1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/prompt-template';

describe('renderTemplate', () => {
  const vars = { word: 'bank', context: 'river bank', target_lang: 'Vietnamese', source_lang: 'English', url: 'http://x', title: 'T' };

  it('substitutes only placeholders present in the template', () => {
    expect(renderTemplate('Define {word} in {target_lang}', vars)).toBe('Define bank in Vietnamese');
  });
  it('does NOT inject {url}/{title} when the template omits them (data minimization)', () => {
    const out = renderTemplate('{word}|{context}', vars);
    expect(out).toBe('bank|river bank');
    expect(out).not.toContain('http://x');
  });
  it('defaults {source_lang} to English when not supplied', () => {
    expect(renderTemplate('{source_lang}', { word: '', context: '', target_lang: 'vi' })).toBe('English');
  });
  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{nope}', vars)).toBe('{nope}');
  });
});
```
Run → FAIL.

- [ ] **C2: Implement** `packages/core/src/prompt-template.ts`

```ts
export interface TemplateVars {
  word: string;
  context: string;
  target_lang: string;
  source_lang?: string;
  url?: string;
  title?: string;
}

const SUPPORTED = ['word', 'context', 'target_lang', 'source_lang', 'url', 'title'] as const;

export function renderTemplate(template: string, vars: TemplateVars): string {
  const resolved: Record<string, string | undefined> = {
    ...vars,
    source_lang: vars.source_lang ?? 'English',
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!SUPPORTED.includes(name as (typeof SUPPORTED)[number])) return match;
    const value = resolved[name];
    return value ?? match;
  });
}
```
Add export to `index.ts`. Run → PASS. Commit `feat(core): prompt template substitution`.

### Task D — cache-policy (FNV-1a + LRU over Storage)

**Files:** Create `packages/core/src/cache-policy.ts`, `packages/core/test/cache-policy.test.ts`. Uses fake Storage (created in Task H, but tests here use an inline Map-backed fake to stay self-contained).

- [ ] **D1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { fnv1a64Hex, deriveCacheKey, cacheGet, cachePut } from '../src/cache-policy';
import type { Storage, LookupResult } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
    keys: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)),
  };
}
const result = (word: string): LookupResult => ({ markdown: '#', word, target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 });

describe('cache-policy', () => {
  it('fnv1a64Hex is deterministic 16-char hex', () => {
    expect(fnv1a64Hex('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64Hex('abc')).toBe(fnv1a64Hex('abc'));
    expect(fnv1a64Hex('abc')).not.toBe(fnv1a64Hex('abd'));
  });
  it('deriveCacheKey normalizes word case + trims (spec §6.11)', () => {
    const a = deriveCacheKey({ word: ' Bank ', context: 'x', target: 'vi' });
    const b = deriveCacheKey({ word: 'bank', context: 'x', target: 'vi' });
    expect(a).toBe(b);
  });
  it('round-trips put → get with fromCache flipped true', async () => {
    const s = memStorage();
    await cachePut({ storage: s }, { word: 'bank', context: 'x', target: 'vi' }, result('bank'));
    const got = await cacheGet({ storage: s }, { word: 'bank', context: 'x', target: 'vi' });
    expect(got?.word).toBe('bank');
    expect(got?.fromCache).toBe(true);
  });
  it('evicts least-recently-used beyond cap', async () => {
    const s = memStorage();
    const deps = { storage: s, cap: 2, now: (() => { let t = 0; return () => ++t; })() };
    await cachePut(deps, { word: 'a', context: '', target: 'vi' }, result('a'));
    await cachePut(deps, { word: 'b', context: '', target: 'vi' }, result('b'));
    await cacheGet(deps, { word: 'a', context: '', target: 'vi' }); // touch a → b is LRU
    await cachePut(deps, { word: 'c', context: '', target: 'vi' }, result('c'));
    expect(await cacheGet(deps, { word: 'b', context: '', target: 'vi' })).toBeNull();
    expect(await cacheGet(deps, { word: 'a', context: '', target: 'vi' })).not.toBeNull();
  });
});
```
Run → FAIL.

- [ ] **D2: Implement** `packages/core/src/cache-policy.ts`

```ts
import type { Storage, LookupResult } from './index';

export function fnv1a64Hex(input: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

export function deriveCacheKey(req: { word: string; context: string; target: string }): string {
  const norm = `${req.word.trim().toLowerCase()}|${req.context.trim()}|${req.target}`;
  return fnv1a64Hex(norm);
}

interface IndexEntry { key: string; atime: number; }
export interface CacheDeps { storage: Storage; cap?: number; now?: () => number; }

const INDEX_KEY = 'cache:index';
const DEFAULT_CAP = 1000;

async function readIndex(s: Storage): Promise<IndexEntry[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as IndexEntry[]) : [];
}
async function writeIndex(s: Storage, idx: IndexEntry[]): Promise<void> {
  await s.setItem(INDEX_KEY, JSON.stringify(idx));
}

export async function cacheGet(deps: CacheDeps, req: { word: string; context: string; target: string }): Promise<LookupResult | null> {
  const now = deps.now ?? Date.now;
  const hash = deriveCacheKey(req);
  const raw = await deps.storage.getItem(`cache:${hash}`);
  if (!raw) return null;
  const idx = await readIndex(deps.storage);
  const entry = idx.find((e) => e.key === hash);
  if (entry) { entry.atime = now(); await writeIndex(deps.storage, idx); }
  return { ...(JSON.parse(raw) as LookupResult), fromCache: true };
}

export async function cachePut(deps: CacheDeps, req: { word: string; context: string; target: string }, result: LookupResult): Promise<void> {
  const now = deps.now ?? Date.now;
  const cap = deps.cap ?? DEFAULT_CAP;
  const hash = deriveCacheKey(req);
  await deps.storage.setItem(`cache:${hash}`, JSON.stringify({ ...result, fromCache: false }));
  const idx = (await readIndex(deps.storage)).filter((e) => e.key !== hash);
  idx.push({ key: hash, atime: now() });
  idx.sort((a, b) => a.atime - b.atime);
  while (idx.length > cap) {
    const evicted = idx.shift()!;
    await deps.storage.removeItem(`cache:${evicted.key}`);
  }
  await writeIndex(deps.storage, idx);
}

export async function cacheClear(deps: CacheDeps): Promise<void> {
  for (const k of await deps.storage.keys('cache:')) await deps.storage.removeItem(k);
}
```
Add export to `index.ts`. Run → PASS. Commit `feat(core): cache policy (FNV-1a + LRU)`.

### Task E — history-policy (FIFO over Storage)

**Files:** Create `packages/core/src/history-policy.ts`, `packages/core/test/history-policy.test.ts`.

- [ ] **E1: Write the failing test** (reuse the `memStorage` helper pattern)

```ts
import { describe, it, expect } from 'vitest';
import { historyAppend, historyList, historyClear } from '../src/history-policy';
import type { Storage, HistoryEntry } from '../src';

function memStorage(): Storage { /* same Map-backed fake as cache-policy.test */
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), keys: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)) };
}
const entry = (id: string): HistoryEntry => ({ id, word: id, context: '', createdAt: Number(id), result: { markdown: '', word: id, target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 0 } });

describe('history-policy', () => {
  it('lists newest-first', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, entry('1'));
    await historyAppend({ storage: s }, entry('2'));
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['2', '1']);
  });
  it('pages via cursor', async () => {
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s }, entry(id));
    const page1 = await historyList({ storage: s }, { limit: 2 });
    expect(page1.entries.map((e) => e.id)).toEqual(['3', '2']);
    const page2 = await historyList({ storage: s }, { limit: 2, cursor: page1.nextCursor });
    expect(page2.entries.map((e) => e.id)).toEqual(['1']);
    expect(page2.nextCursor).toBeUndefined();
  });
  it('caps at FIFO limit, dropping oldest', async () => {
    const s = memStorage();
    for (const id of ['1', '2', '3']) await historyAppend({ storage: s, cap: 2 }, entry(id));
    const { entries } = await historyList({ storage: s }, {});
    expect(entries.map((e) => e.id)).toEqual(['3', '2']);
    expect(await s.getItem('history:1')).toBeNull();
  });
  it('clear removes all', async () => {
    const s = memStorage();
    await historyAppend({ storage: s }, entry('1'));
    await historyClear({ storage: s });
    expect((await historyList({ storage: s }, {})).entries).toEqual([]);
  });
});
```
Run → FAIL.

- [ ] **E2: Implement** `packages/core/src/history-policy.ts`

```ts
import type { Storage, HistoryEntry } from './index';

const INDEX_KEY = 'history:index';
const DEFAULT_CAP = 500;

export interface HistoryDeps { storage: Storage; cap?: number; }
export interface HistoryPage { entries: HistoryEntry[]; nextCursor?: string; }

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function historyAppend(deps: HistoryDeps, e: HistoryEntry): Promise<void> {
  const cap = deps.cap ?? DEFAULT_CAP;
  await deps.storage.setItem(`history:${e.id}`, JSON.stringify(e));
  const idx = [e.id, ...(await readIndex(deps.storage)).filter((id) => id !== e.id)];
  while (idx.length > cap) {
    const dropped = idx.pop()!;
    await deps.storage.removeItem(`history:${dropped}`);
  }
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(idx));
}

export async function historyList(deps: HistoryDeps, opts: { limit?: number; cursor?: string }): Promise<HistoryPage> {
  const idx = await readIndex(deps.storage); // newest-first
  const start = opts.cursor ? idx.indexOf(opts.cursor) : 0;
  const from = start < 0 ? idx.length : start;
  const limit = opts.limit ?? idx.length;
  const slice = idx.slice(from, from + limit);
  const entries: HistoryEntry[] = [];
  for (const id of slice) {
    const raw = await deps.storage.getItem(`history:${id}`);
    if (raw) entries.push(JSON.parse(raw) as HistoryEntry);
  }
  const nextIndex = from + limit;
  const next = nextIndex < idx.length ? idx[nextIndex] : undefined;
  return next !== undefined ? { entries, nextCursor: next } : { entries };
}

export async function historyClear(deps: HistoryDeps): Promise<void> {
  for (const k of await deps.storage.keys('history:')) await deps.storage.removeItem(k);
}
```
Add export to `index.ts`. Run → PASS. Commit `feat(core): history policy (FIFO + paging)`.

### Task F — error-mapper

**Files:** Create `packages/core/src/error-mapper.ts`, `packages/core/test/error-mapper.test.ts`, fixtures under `packages/core/test/fixtures/gemini-responses/`.

- [ ] **F1: Add fixtures** `packages/core/test/fixtures/gemini-responses/` — `success.json`, `invalid-key-400.json` (`{"error":{"status":"INVALID_ARGUMENT"}}`), `invalid-key-403.json` (`{"error":{"status":"PERMISSION_DENIED"}}`), `rate-limit-429.json` (`{"error":{"status":"RESOURCE_EXHAUSTED"}}`), `server-5xx.json`, `malformed.txt` (non-JSON), `prompt-injection.json` (markdown containing `<script>` + `[x](javascript:alert(1))`).

- [ ] **F2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mapError } from '../src/error-mapper';

describe('mapError (spec §6.9)', () => {
  it('no-key → NO_KEY, not retryable', () => {
    expect(mapError({ kind: 'no-key' })).toMatchObject({ code: 'NO_KEY', retryable: false });
  });
  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 400, geminiStatus: 'INVALID_ARGUMENT' }).code).toBe('INVALID_KEY');
  });
  it('HTTP 401/403 → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 401 }).code).toBe('INVALID_KEY');
    expect(mapError({ kind: 'http', status: 403 }).code).toBe('INVALID_KEY');
  });
  it('HTTP 429 → RATE_LIMIT, retryable, carries retryAfterSec', () => {
    const e = mapError({ kind: 'http', status: 429, retryAfterSec: 30 });
    expect(e).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterSec: 30 });
  });
  it('HTTP 5xx / offline / timeout → NETWORK, retryable', () => {
    expect(mapError({ kind: 'http', status: 503 })).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(mapError({ kind: 'offline' }).code).toBe('NETWORK');
    expect(mapError({ kind: 'timeout' }).code).toBe('NETWORK');
  });
  it('parse → PARSE, not retryable', () => {
    expect(mapError({ kind: 'parse' })).toMatchObject({ code: 'PARSE', retryable: false });
  });
  it('thrown unknown → UNKNOWN; message ≤200 chars and scrubs key-like tokens', () => {
    const e = mapError({ kind: 'thrown', error: new Error('AIzaSyD' + 'x'.repeat(400)) });
    expect(e.code).toBe('UNKNOWN');
    expect(e.message.length).toBeLessThanOrEqual(200);
    expect(e.message).not.toContain('AIzaSy');
  });
  it('thrown non-Error value → UNKNOWN with stringified message', () => {
    expect(mapError({ kind: 'thrown', error: 'boom' }).message).toContain('boom');
  });
  it('unmapped HTTP status (e.g. 418) → UNKNOWN', () => {
    expect(mapError({ kind: 'http', status: 418 }).code).toBe('UNKNOWN');
  });
});
```
Run → FAIL.

- [ ] **F3: Implement** `packages/core/src/error-mapper.ts`

```ts
import type { LookupError } from './index';

export type ErrorInput =
  | { kind: 'no-key' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'parse' }
  | { kind: 'http'; status: number; geminiStatus?: string; retryAfterSec?: number }
  | { kind: 'thrown'; error: unknown };

function sanitize(msg: string): string {
  return msg
    .replace(/AIza[0-9A-Za-z_\-]+/g, '[redacted]') // scrub Google API-key shaped tokens
    .slice(0, 200);
}

export function mapError(input: ErrorInput): LookupError {
  switch (input.kind) {
    case 'no-key':
      return { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false };
    case 'offline':
    case 'timeout':
      return { code: 'NETWORK', message: 'Network failed. Check connection and retry.', retryable: true };
    case 'parse':
      return { code: 'PARSE', message: 'Gemini returned unexpected output.', retryable: false };
    case 'http': {
      const { status, geminiStatus, retryAfterSec } = input;
      if (status === 400 && geminiStatus === 'INVALID_ARGUMENT')
        return { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false };
      if (status === 401 || status === 403 || geminiStatus === 'UNAUTHENTICATED' || geminiStatus === 'PERMISSION_DENIED')
        return { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false };
      if (status === 429 || geminiStatus === 'RESOURCE_EXHAUSTED')
        return { code: 'RATE_LIMIT', message: 'Hit Gemini rate limit.', retryable: true, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) };
      if (status >= 500) return { code: 'NETWORK', message: 'Gemini server error. Retry.', retryable: true };
      return { code: 'UNKNOWN', message: sanitize(`HTTP ${status}`), retryable: false };
    }
    case 'thrown': {
      const msg = input.error instanceof Error ? input.error.message : String(input.error);
      return { code: 'UNKNOWN', message: sanitize(`Lookup failed: ${msg}`), retryable: false };
    }
  }
}
```
Note: `exactOptionalPropertyTypes` requires the conditional-spread for `retryAfterSec`. Add export to `index.ts`. Run → PASS. Commit `feat(core): Gemini→LookupError mapper`.

### Task G — wire-schema + JSON-schema snapshot

**Files:** Create `packages/core/src/wire-schema.ts`, `packages/core/test/wire-schema.test.ts`, generate `packages/core/wire-schema.snapshot.json`.

- [ ] **G1: Write the failing test** (validation + drift snapshot + [S1] key-isolation)

```ts
import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire-schema';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup', requestId: 'r1', req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' } }).success).toBe(true);
  });
  it('rejects an unknown message type', () => {
    expect(WireMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
  it('[S1] settings reply schema has no apiKey field', () => {
    const ok = WireReplySchema.safeParse({ ok: true, type: 'settings', settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true, apiKey: 'x' } });
    // extra apiKey must be stripped/rejected — settings carries PublicSettings only
    if (ok.success) expect('apiKey' in (ok.data as { settings: object }).settings).toBe(false);
    else expect(ok.success).toBe(false);
  });
  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot('../wire-schema.snapshot.json');
  });
});
```
Run → FAIL.

- [ ] **G2: Implement** `packages/core/src/wire-schema.ts` (Zod 4; `.strict()` strips/rejects extras → enforces [S1])

```ts
import { z } from 'zod';

const LookupErrorSchema = z.object({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'NETWORK', 'PARSE', 'UNKNOWN']),
  message: z.string().max(200),
  retryable: z.boolean(),
  retryAfterSec: z.number().optional(),
});

const LookupRequestSchema = z.object({
  word: z.string(), context: z.string(), url: z.string(), title: z.string(),
  target: z.string(), promptTemplate: z.string(),
}).strict();

const LookupResultSchema = z.object({
  markdown: z.string(), word: z.string(), target: z.string(),
  model: z.literal('gemini-2.5-flash'), fromCache: z.boolean(), fetchedAt: z.number(),
}).strict();

const PublicSettingsSchema = z.object({
  targetLang: z.string(), promptTemplate: z.string(), hasKey: z.boolean(),
}).strict(); // .strict() => apiKey on the wire is rejected (S1)

const HistoryEntrySchema = z.object({
  id: z.string(), word: z.string(), context: z.string(),
  result: LookupResultSchema, createdAt: z.number(),
}).strict();

export const WireMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookup'), req: LookupRequestSchema, requestId: z.string() }),
  z.object({ type: z.literal('lookup.cancel'), requestId: z.string() }),
  z.object({ type: z.literal('settings.get') }),
  z.object({ type: z.literal('history.list'), limit: z.number().optional(), cursor: z.string().optional() }),
  z.object({ type: z.literal('history.clear') }),
  z.object({ type: z.literal('cache.clear') }),
  z.object({ type: z.literal('connection.test') }),
]);

const MessageTypeEnum = z.enum(['lookup', 'lookup.cancel', 'settings.get', 'history.list', 'history.clear', 'cache.clear', 'connection.test']);

export const WireReplySchema = z.union([
  z.object({ ok: z.literal(true), type: z.literal('lookup'), result: LookupResultSchema, requestId: z.string() }),
  z.object({ ok: z.literal(true), type: z.literal('settings'), settings: PublicSettingsSchema }),
  z.object({ ok: z.literal(true), type: z.literal('history'), entries: z.array(HistoryEntrySchema), nextCursor: z.string().optional() }),
  z.object({ ok: z.literal(true), type: z.literal('ack') }),
  z.object({ ok: z.literal(false), type: MessageTypeEnum, error: LookupErrorSchema, requestId: z.string().optional() }),
]);

export type WireMessage = z.infer<typeof WireMessageSchema>;
export type WireReply = z.infer<typeof WireReplySchema>;

export function wireJsonSchema(): unknown {
  return {
    WireMessage: z.toJSONSchema(WireMessageSchema),
    WireReply: z.toJSONSchema(WireReplySchema),
  };
}
```
Drift-guard the domain types against the schemas (compile-time) — add to the same file:
```ts
import type { LookupRequest, LookupResult, PublicSettings, HistoryEntry } from './types';
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _checks: [
  AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest>,
  AssertEqual<z.infer<typeof LookupResultSchema>, LookupResult>,
  AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>,
  AssertEqual<z.infer<typeof HistoryEntrySchema>, HistoryEntry>,
] = [true, true, true, true];
void _checks;
```
Add `export * from './wire-schema';` to `index.ts`.

- [ ] **G3: Generate the committed snapshot**

Run: `pnpm --filter @ai-dict/core test wire-schema -u` (writes `wire-schema.snapshot.json`). Re-run without `-u` → PASS (no drift). Commit `feat(core): zod wire schemas + JSON-schema snapshot`.

### Task H — shared fakes

**Files:** Create `packages/core/test/fakes/index.ts` (+ one file per fake). Re-exported as `@ai-dict/core/test/fakes` (see A1 `exports`).

- [ ] **H1: Implement fakes** `packages/core/test/fakes/index.ts`

```ts
import type {
  SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore, Storage,
  SelectionEvent, LookupResult, LookupError, LookupRequest, PublicSettings,
} from '../../src';

export class FakeSelectionSource implements SelectionSource {
  private cb: ((e: SelectionEvent) => void) | null = null;
  onSelection(cb: (e: SelectionEvent) => void) { this.cb = cb; return () => { this.cb = null; }; }
  emit(e: SelectionEvent) { this.cb?.(e); }
}

export class FakeTriggerUI implements TriggerUI {
  shown: { anchor: unknown; onClick: () => void } | null = null;
  hidden = 0;
  show(anchor: { x: number; y: number; w: number; h: number }, onClick: () => void) { this.shown = { anchor, onClick }; }
  hide() { this.hidden++; this.shown = null; }
  click() { this.shown?.onClick(); }
}

export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastError: LookupError | null = null;
  renderLoading() { this.calls.push('loading'); }
  renderResult(r: LookupResult) { this.calls.push('result'); this.lastResult = r; }
  renderError(e: LookupError) { this.calls.push('error'); this.lastError = e; }
  close() { this.calls.push('close'); }
}

export class FakeLookupClient implements LookupClient {
  constructor(private impl: (req: LookupRequest, opts?: { signal?: AbortSignal }) => Promise<LookupResult>) {}
  lastReq: LookupRequest | null = null;
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }) { this.lastReq = req; return this.impl(req, opts); }
}

export class FakeSettingsStore implements SettingsStore {
  constructor(public value: PublicSettings) {}
  async get() { return this.value; }
  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>) { Object.assign(this.value, patch); }
}

export function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
    keys: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)),
  };
}
```
Typecheck → PASS. Commit `test(core): shared fake port implementations`.

### Task I — workflow (the orchestrator)

**Files:** Create `packages/core/src/workflow.ts`, `packages/core/test/workflow.test.ts`.

- [ ] **I1: Write the failing test** (happy path, NO_KEY short-circuit, error, cancellation)

```ts
import { describe, it, expect, vi } from 'vitest';
import { runLookupWorkflow } from '../src/workflow';
import { FakeSelectionSource, FakeTriggerUI, FakeResultRenderer, FakeLookupClient, FakeSettingsStore } from './fakes';
import type { SelectionEvent, LookupResult } from '../src';

const sel: SelectionEvent = { text: 'bank', sentence: 'river bank', anchor: { x: 0, y: 0, w: 1, h: 1 }, url: 'u', title: 't' };
const okResult: LookupResult = { markdown: '#', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
const pub = (hasKey: boolean) => ({ targetLang: 'vi', promptTemplate: 'tpl', hasKey });

function harness(opts: { hasKey?: boolean; impl?: FakeLookupClient['lookup'] }) {
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient(opts.impl ?? (async () => okResult));
  const settings = new FakeSettingsStore(pub(opts.hasKey ?? true));
  const teardown = runLookupWorkflow({ selection, trigger, renderer, client, settings });
  return { selection, trigger, renderer, client, settings, teardown };
}

describe('runLookupWorkflow', () => {
  it('happy path: select → show trigger → click → loading → result; req built from settings', async () => {
    const h = harness({});
    h.selection.emit(sel);
    expect(h.trigger.shown).not.toBeNull();
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.trigger.hidden).toBe(1);
    expect(h.renderer.calls).toEqual(['loading', 'result']);
    expect(h.client.lastReq).toMatchObject({ word: 'bank', context: 'river bank', target: 'vi', promptTemplate: 'tpl' });
  });

  it('NO_KEY short-circuit: no lookup sent', async () => {
    const h = harness({ hasKey: false });
    h.selection.emit(sel); h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('NO_KEY'));
    expect(h.renderer.calls).not.toContain('loading');
    expect(h.client.lastReq).toBeNull();
  });

  it('maps a rejected lookup (LookupError-shaped) to renderError', async () => {
    const h = harness({ impl: async () => { throw Object.assign(new Error('rate'), { code: 'RATE_LIMIT', message: 'rate', retryable: true }); } });
    h.selection.emit(sel); h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('RATE_LIMIT'));
  });

  it('cancels the in-flight lookup when a newer one starts (spec §6.8)', async () => {
    const signals: AbortSignal[] = [];
    const h = harness({ impl: (_req, opts) => new Promise((resolve) => { if (opts?.signal) signals.push(opts.signal); setTimeout(() => resolve(okResult), 5); }) });
    h.selection.emit(sel); h.trigger.click();           // lookup A
    h.selection.emit(sel); h.trigger.click();           // lookup B → aborts A
    await vi.waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });
});
```
Run → FAIL.

- [ ] **I2: Implement** `packages/core/src/workflow.ts`

```ts
import type {
  SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore,
  SelectionEvent, LookupRequest, LookupError,
} from './index';
import { isLookupError } from './types';
import { mapError } from './error-mapper';

export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
}

function toLookupError(err: unknown): LookupError {
  return isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
}

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;

  async function runLookup(e: SelectionEvent): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const settings = await deps.settings.get();
    if (!settings.hasKey) {
      deps.renderer.renderError(mapError({ kind: 'no-key' }));
      return;
    }
    deps.renderer.renderLoading();
    const req: LookupRequest = {
      word: e.text, context: e.sentence, url: e.url, title: e.title,
      target: settings.targetLang, promptTemplate: settings.promptTemplate,
    };
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      if (!controller.signal.aborted) deps.renderer.renderResult(result);
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    deps.trigger.show(e.anchor, () => {
      deps.trigger.hide();
      void runLookup(e);
    });
  });

  return () => {
    inFlight?.abort();
    inFlight = null;
    deps.trigger.hide();
    deps.renderer.close();
    teardown();
  };
}
```
Add `export * from './workflow';` to `index.ts`. Run → PASS.

- [ ] **I3: Full-suite gate + commit**

Run: `pnpm --filter @ai-dict/core test --coverage` → all PASS, coverage ≥ 90%.
Run: `pnpm --filter @ai-dict/core typecheck` + `pnpm lint` → clean.
```bash
git add packages/core
git commit -m "feat(core): lookup workflow orchestrator + coverage gate"
```

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/core test --coverage` → all pass, coverage ≥ 90%.
- Run: `pnpm --filter @ai-dict/core test wire-schema` (no `-u`) → snapshot stable, no drift.

## Validate (sanity / no scope drift)
- `pnpm --filter @ai-dict/core typecheck` + `pnpm lint` clean (hex rule: no inward-facing imports).
- `git diff --stat` touches only `packages/core/**` (owned).
- No browser globals (`window`, `chrome`, `document`, `fetch`) referenced anywhere in `core/src`.
- No placeholder/TODO left in shipped source.

## Self-audit (run BEFORE sign-off)
- [ ] D1–D9 met with command evidence?
- [ ] [S1] `apiKey` provably absent from `PublicSettings` + wire replies?
- [ ] Pure: zero IO / zero browser API in `core/src`?
- [ ] Contracts (port + type + wire signatures) match README table exactly — downstream will freeze against them?
- [ ] Fakes re-exported as `@ai-dict/core/test/fakes`?
- [ ] Only `packages/core/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `02`.
