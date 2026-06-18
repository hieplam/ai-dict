import {
  mapError,
  buildPrompt,
  type LookupClient,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';
import type { FetchLike } from './gemini-lookup-client';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 20000;

export interface OpenAIDeps {
  fetch: FetchLike;
  getApiKey: () => string | Promise<string>;
  timeoutMs?: number;
  /** Chat-completions model id; defaults to gpt-4o-mini. */
  model?: string;
}

interface OpenAIOkBody {
  choices?: { message?: { content?: string } }[];
}
interface OpenAIErrBody {
  error?: { message?: string; code?: string; type?: string };
}

// Throw an Error instance (satisfies `@typescript-eslint/only-throw-error`) that also
// carries the LookupError fields, so core's `isLookupError` recognizes it downstream.
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}

export class OpenAILookupClient implements LookupClient {
  constructor(private readonly deps: OpenAIDeps) {}

  async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    const apiKey = await this.deps.getApiKey();
    if (!apiKey) rejectWith(mapError({ kind: 'no-key', provider: 'openai' }));
    // `navigator` exists in both the content-script and service-worker scopes that
    // compose this client, so no existence guard is needed (avoids a dead branch).
    if (navigator.onLine === false) rejectWith(mapError({ kind: 'offline' }));

    const prompt = buildPrompt(req.outputFormat, {
      word: req.word,
      context: req.context,
      target_lang: req.target,
      url: req.url,
      title: req.title,
    });
    const model = this.deps.model ?? DEFAULT_MODEL;
    const body = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] });

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal: ac.signal,
      });

      if (!res.ok) {
        // Drain the body so a raced abort during the read surfaces here, mirroring the
        // Gemini client. OpenAI carries no status vocabulary we map (HTTP status alone drives
        // the mapping), but its `error.message` is the diagnostic signal for telemetry.
        let vendorMessage: string | undefined;
        try {
          vendorMessage = ((await res.json()) as OpenAIErrBody).error?.message;
        } catch {
          /* non-JSON body: map by status alone */
        }
        const ra = res.headers.get('retry-after');
        const retryAfterSec = ra !== null ? Number(ra) : NaN;
        // Build imperatively (exactOptionalPropertyTypes): only attach optional keys when present.
        const httpInput: {
          kind: 'http';
          status: number;
          provider: 'openai';
          retryAfterSec?: number;
          vendorMessage?: string;
        } = { kind: 'http', status: res.status, provider: 'openai' };
        if (!Number.isNaN(retryAfterSec)) httpInput.retryAfterSec = retryAfterSec;
        if (vendorMessage !== undefined) httpInput.vendorMessage = vendorMessage;
        rejectWith(mapError(httpInput));
      }

      let parsed: OpenAIOkBody;
      try {
        parsed = (await res.json()) as OpenAIOkBody;
      } catch {
        rejectWith(mapError({ kind: 'parse', provider: 'openai' }));
      }
      const text = parsed.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0)
        rejectWith(mapError({ kind: 'parse', provider: 'openai' }));

      return {
        markdown: text,
        word: req.word,
        target: req.target,
        model,
        fromCache: false,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      // Guard: caller-cancel propagates raw ONLY when the error is NOT already a mapped
      // LookupError — same contract as the Gemini client, so the SW router can keep
      // distinguishing "user-cancelled (suppress)" vs "server error (show)".
      if (opts?.signal?.aborted && !isThrownLookupError(err)) throw err;
      if (timedOut) rejectWith(mapError({ kind: 'timeout' }));
      if (isThrownLookupError(err)) throw err; // already-mapped LookupError from rejectWith above
      rejectWith(mapError({ kind: 'offline' })); // generic fetch throw / TypeError → NETWORK
    } finally {
      clearTimeout(timer);
      if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
    }
    // TypeScript control-flow: every catch branch throws via rejectWith/throw, so this is
    // unreachable at runtime. The explicit call satisfies the "lacks ending return" check.
    return rejectWith(mapError({ kind: 'offline' }));
  }
}

function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}
