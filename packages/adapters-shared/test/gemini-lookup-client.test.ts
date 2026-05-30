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
    json: () => {
      if (init.body === '__throw__') return Promise.reject(new SyntaxError('bad json'));
      return Promise.resolve(init.body);
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
  // Always reject with a proper Error subclass (DOMException extends Error) — satisfies
  // @typescript-eslint/prefer-promise-reject-errors.
  const reason: unknown = init.signal.reason;
  const err = reason instanceof Error ? reason : new DOMException('aborted', 'AbortError');
  const fail = (): void => reject(err);
  if (init.signal.aborted) { fail(); return; }
  init.signal.addEventListener('abort', fail, { once: true });
});

describe('GeminiLookupClient', () => {
  it('success → LookupResult with model + rendered prompt + X-Goog-Api-Key header', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client((url, init) => { captured = { url, init }; return Promise.resolve(res({ ok: true, status: 200, body: okBody })); });
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
    const fetchSpy: FetchLike = vi.fn();
    const c = client(fetchSpy, '');
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NO_KEY', retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('navigator.onLine === false → NETWORK, no fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy: FetchLike = vi.fn();
    const c = client(fetchSpy);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY', retryable: false });
  });

  it('HTTP 403 → INVALID_KEY', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 403, body: { error: { status: 'PERMISSION_DENIED' } } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 429 → RATE_LIMIT with retryAfterSec from header', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 429, retryAfter: '30', body: { error: { status: 'RESOURCE_EXHAUSTED' } } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterSec: 30 });
  });

  it('HTTP 5xx → NETWORK', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 503, body: {} })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('error body that is not JSON still maps by status', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 401, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 200 but unparsable body → PARSE', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE', retryable: false });
  });

  it('HTTP 200 missing candidates → PARSE', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: { candidates: [] } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('HTTP 200 empty-string candidate text → PARSE (covers the length===0 branch)', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: '' }] } }] } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE', retryable: false });
  });

  it('generic fetch throw (TypeError) → NETWORK', async () => {
    const c = client(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('thrown LookupError is an Error instance (only-throw-error) yet isLookupError-shaped', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 503, body: {} })));
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
