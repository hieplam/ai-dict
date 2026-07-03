import { describe, it, expect, vi } from 'vitest';
import { createLookupClientSelector } from '../../src/app/lookup-client-selector';
import type { LookupClient, LookupRequest, LookupResult, Provider } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  outputFormat: 't',
};

function stubClient(model: string): LookupClient & { lookup: ReturnType<typeof vi.fn> } {
  return {
    lookup: vi.fn(
      (r: LookupRequest): Promise<LookupResult> =>
        Promise.resolve({
          markdown: '# def',
          word: r.word,
          target: r.target,
          model,
          fromCache: false,
          fetchedAt: 1,
        }),
    ),
  };
}

const anthropicStub = stubClient('claude-haiku-4-5');

describe('createLookupClientSelector', () => {
  it('delegates to the client of the selected provider and forwards req + signal', async () => {
    const gemini = stubClient('gemini-2.5-flash');
    const openai = stubClient('gpt-4o-mini');
    const selector = createLookupClientSelector({
      clients: { gemini, openai, anthropic: anthropicStub },
      getProvider: () => 'openai',
    });
    const ac = new AbortController();
    const out = await selector.lookup(req, { signal: ac.signal });
    expect(out.model).toBe('gpt-4o-mini');
    expect(openai.lookup).toHaveBeenCalledWith(req, { signal: ac.signal });
    expect(gemini.lookup).not.toHaveBeenCalled();
  });

  it('re-resolves the provider on every call — a settings change applies without a rebuild', async () => {
    const gemini = stubClient('gemini-2.5-flash');
    const openai = stubClient('gpt-4o-mini');
    let current: Provider = 'gemini';
    const selector = createLookupClientSelector({
      clients: { gemini, openai, anthropic: anthropicStub },
      // async form exercises the Promise branch of getProvider
      getProvider: () => Promise.resolve(current),
    });
    expect((await selector.lookup(req)).model).toBe('gemini-2.5-flash');
    current = 'openai';
    expect((await selector.lookup(req)).model).toBe('gpt-4o-mini');
    expect(gemini.lookup).toHaveBeenCalledTimes(1);
    expect(openai.lookup).toHaveBeenCalledTimes(1);
  });

  it('propagates the selected client rejection untouched', async () => {
    const boom = Object.assign(new Error('no key'), { code: 'NO_KEY', retryable: false });
    const failing: LookupClient = { lookup: () => Promise.reject(boom) };
    const selector = createLookupClientSelector({
      clients: { gemini: failing, openai: stubClient('x'), anthropic: anthropicStub },
      getProvider: () => 'gemini',
    });
    await expect(selector.lookup(req)).rejects.toBe(boom);
  });
});
