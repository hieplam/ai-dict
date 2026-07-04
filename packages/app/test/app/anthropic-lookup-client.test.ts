import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicLookupClient } from '../../src/app/anthropic-lookup-client';
import type { FetchLike, ResponseLike } from '../../src/app/gemini-lookup-client';
import { isLookupError, type LookupRequest } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  outputFormat: 'Define {word} in {target_lang}: {context}',
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

const okBody = { content: [{ type: 'text', text: '# def' }] };

function client(fetchImpl: FetchLike, key = 'sk-ant-key', timeoutMs?: number, model?: string) {
  return new AnthropicLookupClient({
    fetch: fetchImpl,
    getApiKey: () => key,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(model !== undefined ? { model } : {}),
  });
}

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

describe('AnthropicLookupClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('success → LookupResult with provider=anthropic + x-api-key header only (S1)', async () => {
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
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      fromCache: false,
    });
    expect(typeof out.fetchedAt).toBe('number');
    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    // S1: key lives ONLY in x-api-key header — never in URL or body.
    expect(captured!.init.headers['x-api-key']).toBe('sk-ant-key');
    expect(captured!.init.headers['anthropic-version']).toBe('2023-06-01');
    expect(captured!.init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect('Authorization' in captured!.init.headers).toBe(false);
    expect(captured!.url).not.toContain('sk-ant-key');
    expect(captured!.init.body).not.toContain('sk-ant-key');
    // Body structure: messages array with user role
    const parsed = JSON.parse(captured!.init.body) as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(parsed.model).toBe('claude-haiku-4-5-20251001');
    expect(parsed.max_tokens).toBe(1024);
    expect(parsed.messages[0]?.role).toBe('user');
    const content = parsed.messages[0]?.content ?? '';
    expect(content).toContain('Define bank in vi: river bank');
    expect(content).toContain('You are a bilingual dictionary');
  });

  it('configured model overrides the default and is echoed in the result', async () => {
    let captured: { init: Parameters<FetchLike>[1] } | null = null;
    const c = client(
      (_url, init) => {
        captured = { init };
        return Promise.resolve(res({ ok: true, status: 200, body: okBody }));
      },
      'sk-ant-key',
      undefined,
      'claude-opus-4-7',
    );
    const out = await c.lookup(req);
    expect(out.model).toBe('claude-opus-4-7');
    expect(JSON.parse(captured!.init.body)).toMatchObject({ model: 'claude-opus-4-7' });
  });

  it('empty key → NO_KEY naming Claude, no fetch', async () => {
    const fetchSpy: FetchLike = vi.fn();
    const c = client(fetchSpy, '');
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'NO_KEY',
      retryable: false,
      message: 'Add your Claude API key in Settings.',
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

  it('HTTP 401 → INVALID_KEY naming Anthropic', async () => {
    const c = client(() =>
      Promise.resolve(res({ ok: false, status: 401, body: { error: { message: 'invalid key' } } })),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      retryable: false,
      message: 'Anthropic rejected the API key.',
    });
  });

  it('HTTP 403 → INVALID_KEY', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 403, body: {} })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 429 → RATE_LIMIT with retryAfterSec + vendorStatus/vendorMessage from body', async () => {
    const c = client(() =>
      Promise.resolve(
        res({
          ok: false,
          status: 429,
          retryAfter: '7',
          body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
        }),
      ),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      retryable: true,
      retryAfterSec: 7,
      vendorStatus: 'rate_limit_error',
      vendorMessage: 'slow down',
    });
  });

  it('HTTP 5xx → NETWORK', async () => {
    const c = client(() => Promise.resolve(res({ ok: false, status: 503, body: {} })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('HTTP 200 but unparsable body → PARSE naming Claude', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({
      code: 'PARSE',
      retryable: false,
      message: 'Claude returned unexpected output.',
    });
  });

  it('HTTP 200 empty content array → PARSE', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: { content: [] } })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('HTTP 200 empty-string text → PARSE (covers the length===0 branch)', async () => {
    const c = client(() =>
      Promise.resolve(
        res({ ok: true, status: 200, body: { content: [{ type: 'text', text: '' }] } }),
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

  it('timeout aborts → NETWORK AND the abort reason is a TimeoutError', async () => {
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
    const c = client(capturingHang, 'sk-ant-key', 5);
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
    expect(isLookupError(err)).toBe(false);
    expect((err as DOMException).name).toBe('AbortError');
  });
});
