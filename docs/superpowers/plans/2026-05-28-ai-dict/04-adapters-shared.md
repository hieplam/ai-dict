---
bundle: "04"
title: adapters-shared
status: DONE
locked_by: ""
locked_at: ""
done_at: "2026-05-30T09:10:31Z"
prereqs: ["02", "03"]
owns_files:
  - packages/adapters-shared/package.json
  - packages/adapters-shared/tsconfig.json
  - packages/adapters-shared/vitest.config.ts
  - packages/adapters-shared/src/gemini-lookup-client.ts
  - packages/adapters-shared/src/inline-bottom-sheet-renderer.ts
  - packages/adapters-shared/src/markdown-sanitize.ts
  - packages/adapters-shared/src/index.ts
  - packages/adapters-shared/test/*.test.ts
---

# Bundle 04 — adapters-shared/ (platform-free port impls)

**Purpose:** Concrete port implementations with no platform/browser-extension API: `GeminiLookupClient` (impl `LookupClient` via global `fetch`, with 20s timeout, error mapping, `navigator.onLine` short-circuit) and `InlineBottomSheetRenderer` (impl `ResultRenderer` by composing shared-ui `<bottom-sheet>` + `<lookup-card>`, feeding **sanitized** Markdown through the raw-HTML-disabled renderer + DOMPurify allowlist).

## Lock protocol
Verify prereqs `02-core.md` AND `03-shared-ui.md` are both `DONE`. Flip YAML → LOCKED, commit `[04] lock`, rebase, abort on race. Execute.

## Inputs
- Bundle 02 DONE: `LookupClient`, `ResultRenderer` ports; `LookupRequest/Result/Error` types; `mapError`.
- Bundle 03 DONE: `<bottom-sheet>`, `<lookup-card>` components + their events.
- Spec §5.1, §6.9 (error map), §7.3 S2 (fetch shape), S4 (sanitize), S11 (timeout/onLine), §8.7 (bundle budget context).

## Outputs (frozen contracts)
- `GeminiLookupClient implements LookupClient`: POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, header `X-Goog-Api-Key`; honors `opts.signal`; 20s `AbortController` timeout; `navigator.onLine === false` → `NETWORK` before fetch; maps responses via core `mapError`. Constructor-injected `fetch` slice (testable, no `sinon`).
- `markdown-sanitize.ts`: Markdown renderer with raw HTML disabled (`marked`/`snarkdown`, `html:false`) → DOMPurify allowlist (no raw HTML/scripts/event-handlers/`javascript:`; `data:` only `image/*`); anchors forced `target="_blank" rel="noopener noreferrer"`, `https:` only.
- `InlineBottomSheetRenderer implements ResultRenderer`: `renderLoading/renderResult/renderError/close` mounting `<bottom-sheet>` + `<lookup-card>` with sanitized content; constructor takes a host element.

## Definition of Done
- D1: `GeminiLookupClient.lookup` returns a `LookupResult` for the success fixture; sets `model: 'gemini-2.5-flash'`.
- D2: Each §6.9 error condition (injected via fake fetch / fixtures) maps to the correct `LookupError.code` + `retryable`.
- D3: 20s timeout aborts and maps to `NETWORK`; an our-cancel `signal` abort propagates (caller decides suppression); `navigator.onLine===false` short-circuits to `NETWORK` without calling fetch.
- D4: **[S4 security]** `markdown-sanitize` strips `<script>`, inline event handlers, `javascript:` URLs, and disallowed `data:` URIs; the prompt-injection fixture renders inert (no executable payload). Asserted by test.
- D5: `InlineBottomSheetRenderer` drives the loading→result→error→close lifecycle, mounting shared-ui components with sanitized markdown only.
- D6: No extension/platform API imported (lint hex rule: adapters-shared ⇏ extension-*); `fetch` is injected, not globally assumed in tests.
- D7: Coverage ≥ 90% (spec §8.2).

## Implementation steps

> Internal dependency order: package setup → markdown-sanitize (renderer depends on it) → gemini-lookup-client → inline-bottom-sheet-renderer → full-suite gate. Run filtered: `pnpm --filter @ai-dict/adapters-shared test`. Commit after each task. **Both modules ship to the content side (DOM available); tests run under happy-dom.** `fetch` is constructor-injected (no global `fetch` assumed in tests); the timeout uses a plain `AbortController` + `setTimeout` (not `AbortSignal.timeout`/`.any`, which happy-dom may not expose), so behavior is deterministic across environments.

### Task A — Package setup

**Files:** Create `packages/adapters-shared/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`.

- [ ] **A1: `packages/adapters-shared/package.json`**

```json
{
  "name": "@ai-dict/adapters-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./gemini-lookup-client": "./src/gemini-lookup-client.ts",
    "./inline-bottom-sheet-renderer": "./src/inline-bottom-sheet-renderer.ts",
    "./markdown-sanitize": "./src/markdown-sanitize.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@ai-dict/core": "workspace:*",
    "@ai-dict/shared-ui": "workspace:*",
    "marked": "^14.0.0",
    "dompurify": "^3.2.0"
  },
  "devDependencies": { "happy-dom": "^15.0.0" }
}
```
Then `pnpm install`. Notes: `marked` ships its own types; `dompurify` ≥3.2 bundles types (no `@types/dompurify`). `@ai-dict/core` is imported for **values** (`mapError`, `renderTemplate`) + types; `@ai-dict/shared-ui` for the `<bottom-sheet>`/`<lookup-card>` registrations + the `LookupCard` type. Hex rule from Bundle 01 allows adapters→core and adapters→shared-ui; only adapters⇏extension-\* is forbidden.

- [ ] **A2: `packages/adapters-shared/tsconfig.json`** (DOM lib: renderer touches `HTMLElement`/`document`; client uses `DOMException`/`AbortController`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src", "test"]
}
```

- [ ] **A3: `packages/adapters-shared/vitest.config.ts`** (happy-dom + 90% coverage — spec §8.2)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'adapters-shared',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```

- [ ] **A4: `packages/adapters-shared/src/index.ts`** (public surface — append as each module lands)

```ts
export * from './markdown-sanitize';
export * from './gemini-lookup-client';
export * from './inline-bottom-sheet-renderer';
```

- [ ] **A5: Typecheck + commit**

Run: `pnpm --filter @ai-dict/adapters-shared typecheck` → PASS (no errors; `index.ts` re-exports resolve once Tasks B–D land — create stubs or fill in order; commit at A only the package files if you prefer an incremental commit).
```bash
git add packages/adapters-shared/package.json packages/adapters-shared/tsconfig.json packages/adapters-shared/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(adapters-shared): package setup (happy-dom, marked, dompurify)"
```

### Task B — markdown-sanitize (S4 XSS allowlist)

**Files:** Create `packages/adapters-shared/src/markdown-sanitize.ts`, `packages/adapters-shared/test/markdown-sanitize.test.ts`.

- [ ] **B1: Write the failing test** (XSS vectors + benign-markdown survival + anchor hardening)

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown } from '../src/markdown-sanitize';

describe('sanitizeMarkdown (S4)', () => {
  it('renders benign markdown to safe HTML', () => {
    const html = sanitizeMarkdown('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips <script> tags and their payload', () => {
    const html = sanitizeMarkdown('hi <script>alert(1)</script> there');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers and raw <img onerror>', () => {
    const html = sanitizeMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('drops javascript: URLs on links', () => {
    const html = sanitizeMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('drops data: URIs (no img allowed → no data: needed)', () => {
    const html = sanitizeMarkdown('[x](data:text/html,<b>hi</b>)');
    expect(html).not.toContain('data:');
  });

  it('keeps https links and forces target/rel hardening', () => {
    const html = sanitizeMarkdown('[ok](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
```
Run → FAIL (module not found).

- [ ] **B2: Implement** `packages/adapters-shared/src/markdown-sanitize.ts`

```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Force every surviving anchor to open safely (S4). Registered once at module load;
// DOMPurify hooks are global to the singleton instance, so we add it a single time.
let hooked = false;
function ensureHook(): void {
  if (hooked) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('target' in node) {
      (node as Element).setAttribute('target', '_blank');
      (node as Element).setAttribute('rel', 'noopener noreferrer');
    }
  });
  hooked = true;
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];
const HTTPS_ONLY = /^https:\/\//i; // anchors: https only (no javascript:, data:, mailto:, relative)

export function sanitizeMarkdown(md: string): string {
  ensureHook();
  // marked emits raw HTML embedded in the markdown verbatim; DOMPurify (not marked)
  // is the HTML allowlist boundary. `async: false` guarantees a synchronous string.
  const rawHtml = marked.parse(md, { async: false });
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: HTTPS_ONLY,
  });
}
```
Run → PASS. Commit `feat(adapters-shared): markdown sanitize (marked + DOMPurify allowlist)`.

> **S4 note:** the allowlist omits `img`, so the spec's "`data:` only `image/*`" carve-out is moot — all `data:`/`javascript:` URIs are rejected by `ALLOWED_URI_REGEXP` (https-only). Stricter than the spec floor; safe.

### Task C — GeminiLookupClient

**Files:** Create `packages/adapters-shared/src/gemini-lookup-client.ts`, `packages/adapters-shared/test/gemini-lookup-client.test.ts`.

- [ ] **C1: Write the failing test** (success + every §6.9 error row + timeout + offline + no-key + parse + our-cancel propagation)

```ts
import { describe, it, expect, vi } from 'vitest';
import { GeminiLookupClient, type FetchLike, type ResponseLike } from '../src/gemini-lookup-client';
import { isLookupError, type LookupRequest } from '@ai-dict/core';

const req: LookupRequest = {
  word: 'bank', context: 'river bank', url: 'https://x', title: 'T',
  target: 'vi', promptTemplate: 'Define {word} in {target_lang}: {context}',
};

function res(init: Partial<ResponseLike> & { body?: unknown; ok: boolean; status: number; retryAfter?: string }): ResponseLike {
  return {
    ok: init.ok,
    status: init.status,
    headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? init.retryAfter ?? null : null) },
    json: async () => {
      if (init.body === '__throw__') throw new SyntaxError('bad json');
      return init.body;
    },
  };
}
const okBody = { candidates: [{ content: { parts: [{ text: '# def' }] } }] };

function client(fetchImpl: FetchLike, key = 'AIza-key', timeoutMs?: number) {
  // Omit timeoutMs by default so the production DEFAULT_TIMEOUT_MS path is exercised;
  // the timeout test passes an explicit small value to hit the provided branch.
  return new GeminiLookupClient({ fetch: fetchImpl, getApiKey: () => key, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
}

// A fetch that only settles when its signal aborts — mirrors real fetch by rejecting
// immediately if the signal is ALREADY aborted at call time (otherwise it would hang).
const abortableHang: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
  const fail = (): void => reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'));
  if (init.signal.aborted) { fail(); return; }
  init.signal.addEventListener('abort', fail, { once: true });
});

describe('GeminiLookupClient', () => {
  it('success → LookupResult with model + rendered prompt + X-Goog-Api-Key header', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client(async (url, init) => { captured = { url, init }; return res({ ok: true, status: 200, body: okBody }); });
    const out = await c.lookup(req);
    expect(out).toMatchObject({ markdown: '# def', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false });
    expect(typeof out.fetchedAt).toBe('number');
    expect(captured!.url).toContain('gemini-2.5-flash:generateContent');
    expect(captured!.init.headers['X-Goog-Api-Key']).toBe('AIza-key');
    expect(captured!.init.headers['Content-Type']).toBe('application/json');
    // prompt rendered from template (data-minimization: only placeholders present)
    expect(JSON.parse(captured!.init.body)).toMatchObject({ contents: [{ parts: [{ text: 'Define bank in vi: river bank' }] }] });
  });

  it('empty key → NO_KEY (defensive; not retryable), no fetch', async () => {
    const fetchSpy = vi.fn();
    const c = client(fetchSpy as unknown as FetchLike, '');
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NO_KEY', retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('navigator.onLine === false → NETWORK, no fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy = vi.fn();
    const c = client(fetchSpy as unknown as FetchLike);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', async () => {
    const c = client(async () => res({ ok: false, status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY', retryable: false });
  });

  it('HTTP 403 → INVALID_KEY', async () => {
    const c = client(async () => res({ ok: false, status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 429 → RATE_LIMIT with retryAfterSec from header', async () => {
    const c = client(async () => res({ ok: false, status: 429, retryAfter: '30', body: { error: { status: 'RESOURCE_EXHAUSTED' } } }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterSec: 30 });
  });

  it('HTTP 5xx → NETWORK', async () => {
    const c = client(async () => res({ ok: false, status: 503, body: {} }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('error body that is not JSON still maps by status', async () => {
    const c = client(async () => res({ ok: false, status: 401, body: '__throw__' }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 200 but unparsable body → PARSE', async () => {
    const c = client(async () => res({ ok: true, status: 200, body: '__throw__' }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE', retryable: false });
  });

  it('HTTP 200 missing candidates → PARSE', async () => {
    const c = client(async () => res({ ok: true, status: 200, body: { candidates: [] } }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('HTTP 200 empty-string candidate text → PARSE (covers the length===0 branch)', async () => {
    const c = client(async () => res({ ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: '' }] } }] } }));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE', retryable: false });
  });

  it('generic fetch throw (TypeError) → NETWORK', async () => {
    const c = client(async () => { throw new TypeError('Failed to fetch'); });
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('thrown LookupError is an Error instance (only-throw-error) yet isLookupError-shaped', async () => {
    const c = client(async () => res({ ok: false, status: 503, body: {} }));
    const err = await c.lookup(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isLookupError(err)).toBe(true);
  });

  it('timeout aborts → NETWORK (no 20s wait; injected timeoutMs)', async () => {
    const c = client(abortableHang, 'AIza-key', 5);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('our-cancel signal abort propagates raw (caller decides suppression — D3)', async () => {
    const ac = new AbortController();
    const c = client(abortableHang);
    const p = c.lookup(req, { signal: ac.signal });
    ac.abort(); // pre-empts before fetch is reached; abortableHang rejects on the already-aborted signal
    const err = await p.catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(false);             // NOT mapped — propagated for the caller
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('aborting an IN-FLIGHT our-signal (after fetch starts) also propagates raw (§6.8)', async () => {
    const ac = new AbortController();
    const c = client(abortableHang);
    const p = c.lookup(req, { signal: ac.signal });
    await Promise.resolve();   // let lookup get past getApiKey + register its abort listener, then suspend at fetch
    ac.abort();                // fires the listener path (not the pre-aborted path)
    const err = await p.catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(false);
    expect((err as DOMException).name).toBe('AbortError');
  });
});
```
Run → FAIL.

- [ ] **C2: Implement** `packages/adapters-shared/src/gemini-lookup-client.ts`

```ts
import {
  mapError, renderTemplate,
  type LookupClient, type LookupRequest, type LookupResult, type LookupError,
} from '@ai-dict/core';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DEFAULT_TIMEOUT_MS = 20000;

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}
export interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<ResponseLike>;

export interface GeminiDeps {
  fetch: FetchLike;
  getApiKey: () => string | Promise<string>;
  timeoutMs?: number;
}

interface GeminiOkBody { candidates?: { content?: { parts?: { text?: string }[] } }[]; }
interface GeminiErrBody { error?: { status?: string }; }

// Throw an Error instance (satisfies `@typescript-eslint/only-throw-error`) that also
// carries the LookupError fields, so core's `isLookupError` recognizes it downstream.
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}

export class GeminiLookupClient implements LookupClient {
  constructor(private readonly deps: GeminiDeps) {}

  async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    const apiKey = await this.deps.getApiKey();
    if (!apiKey) rejectWith(mapError({ kind: 'no-key' }));
    // `navigator` exists in both the content-script and service-worker scopes that
    // compose this client, so no existence guard is needed (avoids a dead branch).
    if (navigator.onLine === false) rejectWith(mapError({ kind: 'offline' }));

    const prompt = renderTemplate(req.promptTemplate, {
      word: req.word, context: req.context, target_lang: req.target, url: req.url, title: req.title,
    });
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });

    const ac = new AbortController();
    const onAbort = (): void => ac.abort(opts?.signal?.reason);
    if (opts?.signal) {
      if (opts.signal.aborted) ac.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    const timeout = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => { timedOut = true; ac.abort(new DOMException('timeout', 'TimeoutError')); }, timeout);

    try {
      const res = await this.deps.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body,
        signal: ac.signal,
      });

      if (!res.ok) {
        let geminiStatus: string | undefined;
        try { geminiStatus = (await res.json() as GeminiErrBody).error?.status; } catch { /* non-JSON body: map by status alone */ }
        const ra = res.headers.get('retry-after');
        const retryAfterSec = ra !== null ? Number(ra) : NaN;
        // Build imperatively (exactOptionalPropertyTypes): only attach optional keys when present.
        const httpInput: { kind: 'http'; status: number; geminiStatus?: string; retryAfterSec?: number } = { kind: 'http', status: res.status };
        if (geminiStatus !== undefined) httpInput.geminiStatus = geminiStatus;
        if (!Number.isNaN(retryAfterSec)) httpInput.retryAfterSec = retryAfterSec;
        rejectWith(mapError(httpInput));
      }

      let parsed: GeminiOkBody;
      try { parsed = await res.json() as GeminiOkBody; } catch { rejectWith(mapError({ kind: 'parse' })); }
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string' || text.length === 0) rejectWith(mapError({ kind: 'parse' }));

      return { markdown: text, word: req.word, target: req.target, model: 'gemini-2.5-flash', fromCache: false, fetchedAt: Date.now() };
    } catch (err) {
      if (opts?.signal?.aborted) throw err;                 // our-cancel: propagate raw, caller decides (D3)
      if (timedOut) rejectWith(mapError({ kind: 'timeout' }));
      if (isThrownLookupError(err)) throw err;              // already-mapped LookupError from rejectWith above
      rejectWith(mapError({ kind: 'offline' }));            // generic fetch throw / TypeError → NETWORK
    } finally {
      clearTimeout(timer);
      if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }
}

function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}
```
Run → PASS.

> **Why `isThrownLookupError` re-throw guard:** the `!res.ok` and PARSE branches call `rejectWith` (which throws) *inside* the `try`. Without the guard, the surrounding `catch` would catch that already-mapped `LookupError` and re-map it to `NETWORK`. The guard re-throws it untouched. The `opts.signal.aborted` check precedes it so an our-cancel still propagates raw.

Commit `feat(adapters-shared): GeminiLookupClient (fetch, timeout, error map)`.

### Task D — InlineBottomSheetRenderer

**Files:** Create `packages/adapters-shared/src/inline-bottom-sheet-renderer.ts`, `packages/adapters-shared/test/inline-bottom-sheet-renderer.test.ts`.

- [ ] **D1: Write the failing test** (loading → result → error → close lifecycle; result body sanitized; dismiss/close events tear down)

```ts
import { describe, it, expect } from 'vitest';
import { InlineBottomSheetRenderer } from '../src/inline-bottom-sheet-renderer';
import type { LookupResult, LookupError } from '@ai-dict/core';

const result: LookupResult = { markdown: '**def** <script>alert(1)</script>', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
const error: LookupError = { code: 'NETWORK', message: 'Network failed.', retryable: true };

function host(): HTMLElement { const h = document.createElement('div'); document.body.append(h); return h; }
function card(host: HTMLElement): HTMLElement & { state: unknown } {
  return host.querySelector('bottom-sheet > lookup-card') as HTMLElement & { state: unknown };
}

describe('InlineBottomSheetRenderer', () => {
  it('renderLoading mounts a bottom-sheet + lookup-card in loading state', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderLoading();
    const c = card(h);
    expect(c).not.toBeNull();
    expect(c.state).toMatchObject({ kind: 'loading' });
  });

  it('renderResult feeds SANITIZED html (no <script>) to the card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    const c = card(h);
    expect((c.state as { kind: string; safeHtml: string; word: string }).kind).toBe('result');
    const html = (c.state as { safeHtml: string }).safeHtml;
    expect(html).toContain('<strong>def</strong>');
    expect(html).not.toContain('<script');
    expect(c.shadowRoot!.querySelector('h2')!.textContent).toBe('bank');
  });

  it('renderError sets the card error state', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderError(error);
    expect((card(h).state as { kind: string; error: LookupError }).error.code).toBe('NETWORK');
  });

  it('uses an injected sanitizer when provided (DI seam)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h, (md) => `SAFE:${md}`);
    r.renderResult(result);
    expect((card(h).state as { safeHtml: string }).safeHtml).toBe(`SAFE:${result.markdown}`);
  });

  it('close() before any render is a no-op', () => {
    const h = host();
    expect(() => new InlineBottomSheetRenderer(h).close()).not.toThrow();
  });

  it('reuses a single sheet across state transitions', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading(); r.renderResult(result); r.renderError(error);
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
  });

  it('close removes the sheet from the host', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading(); r.close();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('a bottom-sheet "dismiss" event tears the sheet down', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    h.querySelector('bottom-sheet')!.dispatchEvent(new CustomEvent('dismiss', { bubbles: true }));
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('a lookup-card "close" event tears the sheet down', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    card(h).dispatchEvent(new CustomEvent('close', { bubbles: true }));
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
```
Run → FAIL.

- [ ] **D2: Implement** `packages/adapters-shared/src/inline-bottom-sheet-renderer.ts`

```ts
import type { ResultRenderer, LookupResult, LookupError } from '@ai-dict/core';
import type { CardState, LookupCard, SafeHtml } from '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import '@ai-dict/shared-ui/lookup-card';
import { sanitizeMarkdown } from './markdown-sanitize';

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => string = sanitizeMarkdown,
  ) {}

  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet');
    const card = document.createElement('lookup-card') as LookupCard;
    sheet.append(card);
    sheet.addEventListener('dismiss', () => this.close());
    card.addEventListener('close', () => this.close());
    this.host.append(sheet); // connection upgrades both elements + builds their shadow roots
    this.sheet = sheet;
    this.card = card;
    return card;
  }

  private setState(state: CardState): void { this.ensureCard().state = state; }

  renderLoading(): void { this.setState({ kind: 'loading' }); }

  renderResult(r: LookupResult): void {
    // `CardState.safeHtml` is the branded `SafeHtml` type from shared-ui (Bundle 03): the cast here is
    // the single authorised trust boundary — DOMPurify output (S4) is, by definition, safe HTML.
    this.setState({ kind: 'result', safeHtml: this.sanitize(r.markdown) as SafeHtml, word: r.word, target: r.target });
  }

  renderError(e: LookupError): void { this.setState({ kind: 'error', error: e }); }

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
  }
}
```
Run → PASS. Commit `feat(adapters-shared): InlineBottomSheetRenderer (compose shared-ui + sanitize)`.

> **Note:** the renderer wires `dismiss`/`close` events to its own `close()` so user-driven teardown and the workflow's `renderer.close()` converge on one cleanup path; `expand` is a side-panel concern owned by the Chrome extension (Bundle 05), not here.

### Task E — Full-suite gate

- [ ] **E1: Coverage + typecheck + lint**

Run: `pnpm --filter @ai-dict/adapters-shared test --coverage` → all PASS, coverage ≥ 90%.
Run: `pnpm --filter @ai-dict/adapters-shared typecheck` + `pnpm lint` → clean (no `chrome.*`/`browser.*`; hex rule: adapters ⇏ extension-\*).
```bash
git add packages/adapters-shared
git commit -m "test(adapters-shared): coverage gate (client + sanitize + renderer)"
```

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/adapters-shared test --coverage` → pass, ≥ 90%.

## Validate (sanity / no scope drift)
- `pnpm --filter @ai-dict/adapters-shared typecheck` + `pnpm lint` clean.
- `git diff --stat` only `packages/adapters-shared/**`.
- No `chrome.*` / `browser.*` references (those are extension-only).
- API key never logged; error messages sanitized (no key value).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D7 met with evidence?
- [ ] [S4] All XSS vectors in the prompt-injection fixture neutralized?
- [ ] Error map matches §6.9 exactly (reuses core `mapError`, no fork)?
- [ ] Gemini endpoint/model/header match contracts (`gemini-2.5-flash`, `X-Goog-Api-Key`)?
- [ ] No platform API; `fetch` injected for tests?
- [ ] Only `packages/adapters-shared/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `04`.
