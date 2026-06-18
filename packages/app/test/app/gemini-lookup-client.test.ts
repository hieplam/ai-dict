import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  GeminiLookupClient,
  type FetchLike,
  type ResponseLike,
} from '../../src/app/gemini-lookup-client';
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
const okBody = { candidates: [{ content: { parts: [{ text: '# def' }] } }] };

function client(fetchImpl: FetchLike, key = 'AIza-key', timeoutMs?: number) {
  // Omit timeoutMs by default so the production DEFAULT_TIMEOUT_MS path is exercised;
  // the timeout test passes an explicit small value to hit the provided branch.
  return new GeminiLookupClient({
    fetch: fetchImpl,
    getApiKey: () => key,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

// A fetch that only settles when its signal aborts — mirrors real fetch by rejecting
// immediately if the signal is ALREADY aborted at call time (otherwise it would hang).
const abortableHang: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    // Always reject with a proper Error subclass (DOMException extends Error) — satisfies
    // @typescript-eslint/prefer-promise-reject-errors.
    const reason: unknown = init.signal.reason;
    const err = reason instanceof Error ? reason : new DOMException('aborted', 'AbortError');
    const fail = (): void => reject(err);
    if (init.signal.aborted) {
      fail();
      return;
    }
    init.signal.addEventListener('abort', fail, { once: true });
  });

describe('GeminiLookupClient', () => {
  // Restore any vi.stubGlobal calls after each test so a stub never leaks into the next
  // test — even if an assertion throws mid-test before an inline cleanup could run.
  // vitest.config.ts also sets `unstubGlobals: true` as a belt-and-suspenders guard.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('success → LookupResult with model + rendered prompt + X-Goog-Api-Key header', async () => {
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
      model: 'gemini-2.5-flash',
      fromCache: false,
    });
    expect(typeof out.fetchedAt).toBe('number');
    expect(captured!.url).toContain('gemini-2.5-flash:generateContent');
    expect(captured!.init.headers['X-Goog-Api-Key']).toBe('AIza-key');
    expect(captured!.init.headers['Content-Type']).toBe('application/json');
    // Prompt assembled by buildPrompt: the user's outputFormat is rendered AND wrapped
    // in the code-owned envelope (persona + constraints always present).
    const sent =
      (JSON.parse(captured!.init.body) as { contents: { parts: { text: string }[] }[] }).contents[0]
        ?.parts[0]?.text ?? '';
    expect(sent).toContain('Define bank in vi: river bank'); // user format rendered
    expect(sent).toContain('You are a bilingual dictionary'); // envelope persona
    expect(sent).toContain('Do not include any HTML'); // envelope constraints
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
    // Cleanup is handled by the afterEach above (and vitest.config.ts unstubGlobals: true),
    // so no inline vi.unstubAllGlobals() is needed here.
  });

  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', async () => {
    const c = client(() =>
      Promise.resolve(
        res({ ok: false, status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } }),
      ),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY', retryable: false });
  });

  it('HTTP 403 → INVALID_KEY', async () => {
    const c = client(() =>
      Promise.resolve(
        res({ ok: false, status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }),
      ),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('HTTP 429 → RATE_LIMIT with retryAfterSec from header', async () => {
    const c = client(() =>
      Promise.resolve(
        res({
          ok: false,
          status: 429,
          retryAfter: '30',
          body: { error: { status: 'RESOURCE_EXHAUSTED' } },
        }),
      ),
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

  it('HTTP 200 but unparsable body → PARSE', async () => {
    const c = client(() => Promise.resolve(res({ ok: true, status: 200, body: '__throw__' })));
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE', retryable: false });
  });

  it('HTTP 200 missing candidates → PARSE', async () => {
    const c = client(() =>
      Promise.resolve(res({ ok: true, status: 200, body: { candidates: [] } })),
    );
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('HTTP 200 empty-string candidate text → PARSE (covers the length===0 branch)', async () => {
    const c = client(() =>
      Promise.resolve(
        res({
          ok: true,
          status: 200,
          body: { candidates: [{ content: { parts: [{ text: '' }] } }] },
        }),
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
    // This test must go RED if the `timedOut`/timer logic is removed from the client:
    // without the timer branch, the catch block falls to the generic `offline` path which
    // also yields NETWORK — but more importantly the signal would never be aborted with a
    // DOMException('timeout','TimeoutError'), so the TimeoutError assertion below would fail.
    //
    // How the probe works:
    //   1. `capturingFetch` records the AbortSignal passed to it, then hangs (never settles).
    //   2. The client's internal timer fires (timeoutMs: 5 ms) and calls
    //      `ac.abort(new DOMException('timeout', 'TimeoutError'))`.
    //   3. That abort causes the hang to reject → the client's catch block runs.
    //   4. AFTER the lookup rejects we read `capturedSignal.reason` — this is read AFTER
    //      the abort has occurred (not at Promise-construction time), so we see the real reason.
    //   5. We assert reason.name === 'TimeoutError', proving the timer branch ran.
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
    const c = client(capturingHang, 'AIza-key', 5);
    await expect(c.lookup(req)).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    // Prove the timer branch fired: the signal must have been aborted with a TimeoutError.
    expect(capturedSignal.aborted).toBe(true);
    expect((capturedSignal.reason as DOMException).name).toBe('TimeoutError');
  });

  it('our-cancel signal abort propagates raw (caller decides suppression — D3)', async () => {
    const ac = new AbortController();
    const c = client(abortableHang);
    const p = c.lookup(req, { signal: ac.signal });
    ac.abort(); // pre-empts before fetch is reached; abortableHang rejects on the already-aborted signal
    const err = await p.catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(false); // NOT mapped — propagated for the caller
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('aborting an IN-FLIGHT our-signal (after fetch starts) also propagates raw (§6.8)', async () => {
    // Use a coordination latch so the abort fires ONLY after the fetch Promise constructor
    // has run and the abort-event listener is registered — regardless of how many async
    // hops precede the fetch call (e.g. if getApiKey ever becomes a real Promise).
    // Without the latch, a single `await Promise.resolve()` could expire before the fetch
    // Promise is constructed, causing ac.abort() to hit the pre-aborted fast-path instead
    // of the event-listener path this test is meant to exercise.
    let signalFetchEntered!: () => void;
    const fetchEntered = new Promise<void>((resolve) => {
      signalFetchEntered = resolve;
    });

    const latchedHang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        // Signal the outer test that we are now inside the fetch Promise constructor and
        // the abort listener is about to be registered — so ac.abort() is safe to call.
        signalFetchEntered();
        const reason: unknown = init.signal.reason;
        const err = reason instanceof Error ? reason : new DOMException('aborted', 'AbortError');
        const fail = (): void => reject(err);
        if (init.signal.aborted) {
          fail();
          return;
        }
        init.signal.addEventListener('abort', fail, { once: true });
      });

    const ac = new AbortController();
    const c = client(latchedHang);
    const p = c.lookup(req, { signal: ac.signal });
    await fetchEntered; // guaranteed: the event listener is now registered inside the fetch
    ac.abort(); // fires the listener path (not the pre-aborted path)
    const err = await p.catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(false);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('signal aborted while err is already a mapped LookupError → caller receives LookupError (not raw abort)', async () => {
    // Regression test for the FIX 2 guard reorder.
    // Scenario: fetch stub throws a mapped-LookupError-shaped Error AND signal.aborted is true
    // (simulates the race where the caller aborts mid-res.json() in a !res.ok branch).
    // Before the fix: the old guard `if (signal.aborted) throw err` would re-throw the LookupError
    // as if it were a raw abort, hiding the server error from the SW router.
    // After the fix: `if (signal.aborted && !isThrownLookupError(err)) throw err` lets it fall
    // through to the `isThrownLookupError` branch, so the caller gets a proper LookupError.
    //
    // Note: truly racing signal.abort() with res.json() is non-deterministic in happy-dom, so
    // we test the logical path directly: a fetch stub that both aborts the caller's signal AND
    // throws a mapped-LookupError-shaped error while signal.aborted is true.
    const ac = new AbortController();
    const mappedErr = Object.assign(new Error('HTTP 503'), {
      code: 'NETWORK',
      retryable: true,
      message: 'Network failed.',
    });
    const c = client(() => {
      // Abort the caller signal synchronously before throwing, so signal.aborted is true
      // in the catch block when err is already a mapped LookupError.
      ac.abort();
      return Promise.reject(mappedErr);
    });
    const err = await c.lookup(req, { signal: ac.signal }).catch((e: unknown) => e);
    // Must be a LookupError (server error), NOT a raw AbortError.
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('NETWORK');
  });

  it('5xx error body → thrown LookupError carries httpStatus + vendorStatus + vendorMessage (adr-20260618)', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        res({
          ok: false,
          status: 503,
          body: {
            error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' },
          },
        }),
      );
    const err = await client(fetchImpl)
      .lookup(req)
      .catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'NETWORK', httpStatus: 503, vendorStatus: 'UNAVAILABLE' });
    expect((err as { vendorMessage?: string }).vendorMessage).toContain('overloaded');
  });
});
