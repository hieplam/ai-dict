import {
  mapError,
  buildPrompt,
  type LookupClient,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';
import type { FetchLike } from './gemini-lookup-client';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 20000;
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicDeps {
  fetch: FetchLike;
  getApiKey: () => string | Promise<string>;
  timeoutMs?: number;
  /** Messages API model id; defaults to claude-haiku-4-5-20251001. */
  model?: string;
}

interface AnthropicOkBody {
  content?: { type?: string; text?: string }[];
}
interface AnthropicErrBody {
  error?: { type?: string; message?: string };
}

function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}

function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}

export class AnthropicLookupClient implements LookupClient {
  constructor(private readonly deps: AnthropicDeps) {}

  async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    const apiKey = await this.deps.getApiKey();
    if (!apiKey) rejectWith(mapError({ kind: 'no-key', provider: 'anthropic' }));
    if (navigator.onLine === false) rejectWith(mapError({ kind: 'offline' }));

    const prompt = buildPrompt(req.outputFormat, {
      word: req.word,
      context: req.context,
      target_lang: req.target,
      url: req.url,
      title: req.title,
    });
    const model = this.deps.model ?? DEFAULT_MODEL;
    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const ac = new AbortController();
    const onAbort = (): void => ac.abort(opts?.signal?.reason);
    if (opts?.signal) {
      if (opts.signal.aborted) ac.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    const timeout = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort(new DOMException('timeout', 'TimeoutError'));
    }, timeout);

    try {
      const res = await this.deps.fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // S1: api key is transmitted ONLY via this header, never in URL/body/logs/wire messages.
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Required for direct browser access to the Anthropic API.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body,
        signal: ac.signal,
      });

      if (!res.ok) {
        let vendorMessage: string | undefined;
        try {
          vendorMessage = ((await res.json()) as AnthropicErrBody).error?.message;
        } catch {
          /* non-JSON body: map by status alone */
        }
        const ra = res.headers.get('retry-after');
        const retryAfterSec = ra !== null ? Number(ra) : NaN;
        const httpInput: {
          kind: 'http';
          status: number;
          provider: 'anthropic';
          retryAfterSec?: number;
          vendorMessage?: string;
        } = { kind: 'http', status: res.status, provider: 'anthropic' };
        if (!Number.isNaN(retryAfterSec)) httpInput.retryAfterSec = retryAfterSec;
        if (vendorMessage !== undefined) httpInput.vendorMessage = vendorMessage;
        rejectWith(mapError(httpInput));
      }

      let parsed: AnthropicOkBody;
      try {
        parsed = (await res.json()) as AnthropicOkBody;
      } catch {
        rejectWith(mapError({ kind: 'parse', provider: 'anthropic' }));
      }
      const text = parsed.content?.find((c) => c.type === 'text')?.text;
      if (typeof text !== 'string' || text.length === 0)
        rejectWith(mapError({ kind: 'parse', provider: 'anthropic' }));

      return {
        markdown: text,
        word: req.word,
        target: req.target,
        model,
        provider: 'anthropic' as const,
        fromCache: false,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      if (opts?.signal?.aborted && !isThrownLookupError(err)) throw err;
      if (timedOut) rejectWith(mapError({ kind: 'timeout' }));
      if (isThrownLookupError(err)) throw err;
      rejectWith(mapError({ kind: 'offline' }));
    } finally {
      clearTimeout(timer);
      if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
    }
    return rejectWith(mapError({ kind: 'offline' }));
  }
}
