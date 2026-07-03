import { describe, it, expect, vi } from 'vitest';
import { createProviderPool } from '../../src/app/provider-pool';
import type { LookupClient, LookupRequest, LookupResult, Provider } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  outputFormat: 't',
};

function okResult(model: string): LookupResult {
  return { markdown: '# def', word: 'bank', target: 'vi', model, fromCache: false, fetchedAt: 1 };
}

function stubOk(model: string): LookupClient & { lookup: ReturnType<typeof vi.fn> } {
  return { lookup: vi.fn(() => Promise.resolve(okResult(model))) };
}

function stubFail(err: Error): LookupClient & { lookup: ReturnType<typeof vi.fn> } {
  return { lookup: vi.fn(() => Promise.reject(err)) };
}

const primaryErr = Object.assign(new Error('Gemini unavailable'), {
  code: 'NETWORK',
  message: 'Gemini server error. Retry.',
  retryable: true,
});

function pool(opts: {
  primary?: Provider;
  configured?: Provider[];
  gemini?: LookupClient;
  openai?: LookupClient;
  anthropic?: LookupClient;
}) {
  return createProviderPool({
    clients: {
      gemini: opts.gemini ?? stubOk('gemini-model'),
      openai: opts.openai ?? stubOk('openai-model'),
      anthropic: opts.anthropic ?? stubOk('anthropic-model'),
    },
    getProvider: () => opts.primary ?? 'gemini',
    getConfiguredProviders: () => opts.configured ?? ['gemini'],
  });
}

describe('createProviderPool', () => {
  it('primary succeeds → no fallbackFrom; returns result as-is', async () => {
    const gemini = stubOk('gemini-2.5-flash');
    const p = pool({ gemini });
    const out = await p.lookup(req);
    expect(out.model).toBe('gemini-2.5-flash');
    expect(out.fallbackFrom).toBeUndefined();
  });

  it('primary fails → tries next configured provider; sets fallbackFrom=primary', async () => {
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'],
      gemini: stubFail(primaryErr),
    });
    const out = await p.lookup(req);
    expect(out.model).toBe('anthropic-model');
    expect(out.fallbackFrom).toBe('gemini');
  });

  it('req.provider override wins over getProvider and runs first (one-shot)', async () => {
    const gemini = stubOk('gemini-model');
    const anthropic = stubOk('anthropic-model');
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'],
      gemini,
      anthropic,
    });
    const out = await p.lookup({ ...req, provider: 'anthropic' });
    expect(out.model).toBe('anthropic-model');
    // The picked provider answered directly — no fallback annotation.
    expect(out.fallbackFrom).toBeUndefined();
    // getProvider's 'gemini' was overridden — the Gemini client was never called.
    expect(gemini.lookup).not.toHaveBeenCalled();
  });

  it('req.provider override that fails still falls through to next configured provider', async () => {
    const anthropic = stubFail(primaryErr);
    const gemini = stubOk('gemini-model');
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'],
      gemini,
      anthropic,
    });
    const out = await p.lookup({ ...req, provider: 'anthropic' });
    // Picked anthropic failed → fell back to gemini; fallbackFrom names the picked primary.
    expect(out.model).toBe('gemini-model');
    expect(out.fallbackFrom).toBe('anthropic');
  });

  it('skips unconfigured providers (not in configuredProviders)', async () => {
    const openaiSpy = stubOk('openai-model');
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'], // openai NOT configured
      gemini: stubFail(primaryErr),
      openai: openaiSpy,
    });
    const out = await p.lookup(req);
    // openai skipped; anthropic answered
    expect(out.model).toBe('anthropic-model');
    expect(openaiSpy.lookup).not.toHaveBeenCalled();
  });

  it('all candidates fail → throws the PRIMARY provider error (not the last)', async () => {
    const secondaryErr = Object.assign(new Error('Claude unavailable'), {
      code: 'NETWORK',
      message: 'Claude server error. Retry.',
      retryable: true,
    });
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'],
      gemini: stubFail(primaryErr),
      anthropic: stubFail(secondaryErr),
    });
    const err = await p.lookup(req).catch((e: unknown) => e);
    // Must be the PRIMARY's error, not the last (secondary) error
    expect(err).toBe(primaryErr);
  });

  it('caller-cancel before first attempt → throws abort reason immediately', async () => {
    const ac = new AbortController();
    ac.abort();
    const p = pool({ primary: 'gemini', configured: ['gemini'] });
    const err = await p.lookup(req, { signal: ac.signal }).catch((e: unknown) => e);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('caller-cancel during first attempt → throws error and stops loop', async () => {
    const ac = new AbortController();
    const hanging: LookupClient = {
      lookup: () =>
        new Promise((_res, rej) => {
          ac.signal.addEventListener('abort', () => {
            const reason =
              ac.signal.reason instanceof Error
                ? ac.signal.reason
                : new DOMException('aborted', 'AbortError');
            rej(reason);
          });
        }),
    };
    const anthropicSpy = stubOk('anthropic-model');
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic'],
      gemini: hanging,
      anthropic: anthropicSpy,
    });
    const lookupP = p.lookup(req, { signal: ac.signal });
    ac.abort();
    await expect(lookupP).rejects.toSatisfy((e: unknown) => e instanceof Error);
    // After abort, anthropic must NOT have been tried
    expect(anthropicSpy.lookup).not.toHaveBeenCalled();
  });

  it('offline when i>0 → stops chain immediately instead of trying more providers', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const anthropicSpy = stubOk('anthropic-model');
    const p = pool({
      primary: 'gemini',
      configured: ['gemini', 'anthropic', 'openai'],
      gemini: stubFail(primaryErr),
      anthropic: anthropicSpy,
    });
    const err = await p.lookup(req).catch((e: unknown) => e);
    expect(err).toBe(primaryErr);
    expect(anthropicSpy.lookup).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('re-resolves getProvider and getConfiguredProviders on every call', async () => {
    let primary: Provider = 'gemini';
    let configured: Provider[] = ['gemini'];
    const gemini = stubOk('gemini-model');
    const openai = stubOk('openai-model');
    const p = createProviderPool({
      clients: { gemini, openai, anthropic: stubOk('anthropic-model') },
      getProvider: () => primary,
      getConfiguredProviders: () => configured,
    });
    await p.lookup(req);
    expect(gemini.lookup).toHaveBeenCalledTimes(1);
    primary = 'openai';
    configured = ['openai'];
    await p.lookup(req);
    expect(openai.lookup).toHaveBeenCalledTimes(1);
  });
});
