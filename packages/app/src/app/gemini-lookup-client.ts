import {
  mapError,
  buildPrompt,
  type LookupClient,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
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

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string };
}

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

    const prompt = buildPrompt(req.outputFormat, {
      word: req.word,
      context: req.context,
      target_lang: req.target,
      url: req.url,
      title: req.title,
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
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort(new DOMException('timeout', 'TimeoutError'));
    }, timeout);

    try {
      const res = await this.deps.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body,
        signal: ac.signal,
      });

      if (!res.ok) {
        let geminiStatus: string | undefined;
        try {
          geminiStatus = ((await res.json()) as GeminiErrBody).error?.status;
        } catch {
          /* non-JSON body: map by status alone */
        }
        const ra = res.headers.get('retry-after');
        const retryAfterSec = ra !== null ? Number(ra) : NaN;
        // Build imperatively (exactOptionalPropertyTypes): only attach optional keys when present.
        const httpInput: {
          kind: 'http';
          status: number;
          geminiStatus?: string;
          retryAfterSec?: number;
        } = { kind: 'http', status: res.status };
        if (geminiStatus !== undefined) httpInput.geminiStatus = geminiStatus;
        if (!Number.isNaN(retryAfterSec)) httpInput.retryAfterSec = retryAfterSec;
        rejectWith(mapError(httpInput));
      }

      let parsed: GeminiOkBody;
      try {
        parsed = (await res.json()) as GeminiOkBody;
      } catch {
        rejectWith(mapError({ kind: 'parse' }));
      }
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string' || text.length === 0) rejectWith(mapError({ kind: 'parse' }));

      return {
        markdown: text,
        word: req.word,
        target: req.target,
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      // Guard: caller-cancel propagates raw (D3) ONLY when the error is NOT already a mapped
      // LookupError. If signal aborted during res.json() in the !res.ok branch, `err` is already
      // mapped; re-throwing it raw would look like a raw abort to the SW router (bundles 05/06),
      // preventing it from distinguishing "user-cancelled (suppress)" vs "server error (show)".
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
