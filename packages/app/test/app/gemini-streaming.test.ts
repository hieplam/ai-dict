import { describe, it, expect, vi } from 'vitest';
import { runGeminiStreamingLookup, type GeminiStreamSpec } from '../../src/app/gemini-streaming';
import { isLookupError, type LookupRequest } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  outputFormat: 'Define {word} in {target_lang}: {context}',
  promptEnvelope: '',
};

const spec: GeminiStreamSpec = {
  endpoint: 'https://stream.example/gemini',
  model: 'gemini-2.5-flash',
  headers: (apiKey) => ({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey }),
  body: (prompt) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
};

function sseEvent(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
}

/** A real ReadableStream<Uint8Array>, chunked exactly per `pieces` — gives fully deterministic,
 * non-flaky control over how many reader.read() calls occur (design spec §7.1). */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= pieces.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(pieces[i]));
      i++;
    },
  });
}

function okFetch(pieces: string[]) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.reject(new Error('should not be called on the streaming OK path')),
      body: streamOf(pieces),
    }),
  );
}

describe('runGeminiStreamingLookup', () => {
  it('accumulates three SSE events split across two reads into the final markdown', async () => {
    const onChunk = vi.fn();
    const fetchImpl = okFetch([
      sseEvent('DEFINED_AS: "bank" | literal\n') + sseEvent('TRANSLATION: "bờ sông"\n\n'),
      sseEvent('The land ') + sseEvent('alongside a river.'),
    ]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const result = await runGeminiStreamingLookup(spec, deps, req, onChunk);
    expect(result.markdown).toBe('The land alongside a river.');
    expect(result.definedAs).toEqual({ term: 'bank', isIdiom: false });
    expect(result.translation).toBe('bờ sông');
    expect(result.provider).toBe('gemini');
    expect(result.fromCache).toBe(false);
    // At least one call after the header resolved, with strictly growing text.
    expect(onChunk.mock.calls.length).toBeGreaterThanOrEqual(1);
    const texts = onChunk.mock.calls.map((c) => c[0] as string);
    for (let i = 1; i < texts.length; i++)
      expect(texts[i]!.length).toBeGreaterThanOrEqual(texts[i - 1]!.length);
  });

  it('never exposes a partial/incomplete DEFINED_AS line to onChunk', async () => {
    const onChunk = vi.fn();
    // Split mid-line: "DEFINED_AS: \"ba" then "nk\" | literal\n" then the body.
    const fetchImpl = okFetch([
      'data: ' +
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'DEFINED_AS: "ba' }] } }] }) +
        '\n\n',
      sseEvent('nk" | literal\n\n') + sseEvent('A riverbank.'),
    ]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    await runGeminiStreamingLookup(spec, deps, req, onChunk);
    for (const call of onChunk.mock.calls) {
      expect(call[0] as string).not.toContain('DEFINED_AS');
    }
  });

  it('starts streaming once HEADER_MAX_BUFFER_CHARS is exceeded with no signal lines at all', async () => {
    const onChunk = vi.fn();
    const longPlainText = 'x'.repeat(450); // > HEADER_MAX_BUFFER_CHARS, no DEFINED_AS/TRANSLATION
    const fetchImpl = okFetch([sseEvent(longPlainText)]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const result = await runGeminiStreamingLookup(spec, deps, req, onChunk);
    expect(onChunk).toHaveBeenCalled();
    expect(result.markdown).toBe(longPlainText);
    expect(result.definedAs).toBeUndefined();
  });

  it('maps a non-OK response before any stream starts through mapError, like the non-streaming path', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '12' : null) },
        json: () =>
          Promise.resolve({ error: { status: 'RESOURCE_EXHAUSTED', message: 'slow down' } }),
        body: null,
      }),
    );
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const err = await runGeminiStreamingLookup(spec, deps, req, vi.fn()).catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('RATE_LIMIT');
    expect((err as { retryAfterSec: number }).retryAfterSec).toBe(12);
  });

  it('rejects with the caller abort reason when opts.signal aborts mid-stream', async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          ac.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const p = runGeminiStreamingLookup(spec, deps, req, vi.fn(), { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it('maps a stall past the timeout to a timeout LookupError', async () => {
    const fetchImpl = vi.fn(() => new Promise<never>(() => {})); // never resolves
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key', timeoutMs: 5 };
    const err = await runGeminiStreamingLookup(spec, deps, req, vi.fn()).catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('NETWORK');
  });
});
