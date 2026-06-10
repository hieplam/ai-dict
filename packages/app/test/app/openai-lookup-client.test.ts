import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAILookupClient } from '../../src/app/openai-lookup-client';
import type { FetchLike, ResponseLike } from '../../src/app/gemini-lookup-client';
import { isLookupError, type LookupRequest } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  promptTemplate: 'Define {word} in {target_lang}: {context}',
};

function res(
  init: Partial<ResponseLike> & {
    body?: unknown;
    ok: boolean;
    status: number;
    retryAfter?: string;
  },
): ResponseLike {
  return {
    ok: init.ok,
    status: init.status,
    headers: {
      get: (n: string) => (n.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null),
    },
    json: () => {
      if (init.body === '__throw__') return Promise.reject(new SyntaxError('bad json'));
      return Promise.resolve(init.body);
    },
  };
}
const okBody = { choices: [{ message: { content: '# def' } }] };

function client(fetchImpl: FetchLike, key = 'sk-key', timeoutMs?: number, model?: string) {
  // Omit timeoutMs by default so the production DEFAULT_TIMEOUT_MS path is exercised;
  // the timeout test passes an explicit small value to hit the provided branch.
  return new OpenAILookupClient({
    fetch: fetchImpl,
    getApiKey: () => key,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(model !== undefined ? { model } : {}),
  });
}

// A fetch that only settles when its signal aborts — mirrors real fetch by rejecting
// immediately if the signal is ALREADY aborted at call time (otherwise it would hang).
const abortableHang: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    const reason: unknown = init.signal.reason;
    const err = reason instanceof Error ? reason : new DOMException('aborted', 'AbortError');
    const fail = (): void => reject(err);
    if (init.signal.aborted) {
      fail();
      return;
    }
    init.signal.addEventListener('abort', fail, { once: true });
  });

describe('OpenAILookupClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('success → LookupResult with default model + rendered prompt + Authorization header only', async () => {
    let captured: { url: string; init: Parameters<FetchLike>[1] } | null = null;
    const c = client((url, init) => {
      captured = { url, init };
      return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
    });
    const out = await c.lookup(req);
    expect(out).toMatchObject({
      markdown: '# def',
      word: 'bank',
      target: 'vi',
      model: 'gpt-4o-mini',
      fromCache: false,
    });
    expect(typeof out.fetchedAt).toBe('number');
    expect(captured!.url).toBe('https://api.openai.com/v1/chat/completions');
    // Key isolation: the secret travels ONLY in the Authorization header — never in the
    // URL or the request body (rule-api-key-isolation).
    expect(captured!.init.headers['Authorization']).toBe('Bearer sk-key');
    expect(captured!.init.headers['Content-Type']).toBe('application/json');
    expect(captured!.url).not.toContain('sk-key');
    expect(captured!.init.body).not.toContain('sk-key');
    // prompt rendered from template (data-minimization: only placeholders present)
    expect(JSON.parse(captured!.init.body)).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Define bank in vi: river bank' }],
    });
  });

  it('configured model overrides the default and is echoed in the result', async () => {
    let captured: { init: Parameters<FetchLike>[1] } | null = null;
    const c = client(
      (_url, init) => {
        captured = { init };
        return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
      },
      'sk-key',
      undefined,
      'gpt-4.1',
    );
    const out = await c.lookup(req);
    expect(out.model).toBe('gpt-4.1');
    expect(JSON.parse(captured!.init.body)).toMatchObject({ model: 'gpt-4.1' });
  });

  it('empty key → NO_KEY naming OpenAI, no fetch', async () => {
    const fetchSpy: FetchLike = vi.fn();
    const c = client(fetchSpy, '');
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'NO_KEY',
      retryable: false,
      message: 'Add your OpenAI API key in Settings.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('navigator.onLine === false → NETWORK, no fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy: FetchLike = vi.fn();
    const c = client(fetchSpy);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 401 → INVALID_KEY naming OpenAI', async () => {
    const c = client(() =>
      Promise.resolve(
        res({ ok: false, status: 401, body: { error: { code: 'invalid_api_key' } } }),
      ),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      retryable: false,
      message: 'OpenAI rejected the API key.',
    });
  });

  it('HTTP 403 → INVALID_KEY', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 403, body: {} })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 429 → RATE_LIMIT with retryAfterSec from header', async () => {
    const c = client(() =>
      Promise.resolve(res({ ok: false, status: 429, retryAfter: '30', body: {} })),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      retryable: true,
      retryAfterSec: 30,
    });
  });

  it('HTTP 5xx → NETWORK', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 503, body: {} })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('error body that is not JSON still maps by status', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 401, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 200 but unparsable body → PARSE naming OpenAI', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'PARSE',
      retryable: false,
      message: 'OpenAI returned unexpected output.',
    });
  });

  it('HTTP 200 missing choices → PARSE', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: { choices: [] } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('HTTP 200 empty-string content → PARSE (covers the length===0 branch)', async () => {
    const c = client(() =>
      Promise.resolve(
        res({ ok: true, status: 200, body: { choices: [{ message: { content: '' } }] } }),
      ),
    );
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

  it('timeout aborts → NETWORK AND the abort reason is a TimeoutError (proves the timer path fired)', async () => {
    let capturedSignal!: AbortSignal;
    const capturingHang: FetchLike = (_url, init) => {
      capturedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        if (init.signal.aborted) {
          reject(
            init.signal.reason instanceof Error
              ? init.signal.reason
              : new DOMException('aborted', 'AbortError'),
          );
          return;
        }
        init.signal.addEventListener(
          'abort',
          () => {
            const reason: unknown = init.signal.reason;
            reject(reason instanceof Error ? reason : new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    };
    const c = client(capturingHang, 'sk-key', 5);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(capturedSignal.aborted).toBe(true);
    expect((capturedSignal.reason as DOMException).name).toBe('TimeoutError');
  });

  it('our-cancel signal abort propagates raw (caller decides suppression)', async () => {
    const ac = new AbortController();
    const c = client(abortableHang);
    const p = c.lookup(req, { signal: ac.signal });
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(false); // NOT mapped — propagated for the caller
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('signal aborted while err is already a mapped LookupError → caller receives LookupError (not raw abort)', async () => {
    const ac = new AbortController();
    const mappedErr = Object.assign(new Error('HTTP 503'), {
      code: 'NETWORK',
      retryable: true,
      message: 'Network failed.',
    });
    const c = client(() => {
      ac.abort();
      return Promise.reject(mappedErr);
    });
    const err = await c.lookup(req, { signal: ac.signal }).catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('NETWORK');
  });
});
