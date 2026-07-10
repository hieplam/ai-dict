import {
  mapError,
  buildPrompt,
  type LookupRequest,
  type LookupResult,
  type LookupError,
  type Provider,
} from '../index';
import { parseDefinedAs } from '../domain/defined-as';
import { parseTranslation } from '../domain/translation-line';

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

export interface HttpLookupDeps {
  fetch: FetchLike;
  getApiKey: () => string | Promise<string>;
  timeoutMs?: number;
}

/** Provider-native failure signature parsed from a non-OK response body. */
interface ParsedHttpError {
  /** Gemini-style `error.status` (e.g. RESOURCE_EXHAUSTED). */
  geminiStatus?: string;
  /** Native error type from other vendors (e.g. Anthropic's rate_limit_error). */
  vendorStatus?: string;
  /** Raw provider `error.message`; scrubbed + capped inside mapError before it can leave the device. */
  vendorMessage?: string;
}

/** Per-provider bits injected into the shared HTTP lookup skeleton. */
interface HttpLookupSpec {
  provider: Provider;
  endpoint: string;
  /** Already resolved (deps.model ?? default); used for both the request body and the result. */
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (prompt: string, model: string) => string;
  parseOk: (json: unknown) => string | undefined;
  parseErr: (json: unknown) => ParsedHttpError;
}

// Throw an Error instance (satisfies `@typescript-eslint/only-throw-error`) that also
// carries the LookupError fields, so core's `isLookupError` recognizes it downstream.
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}

function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}

/**
 * The one HTTP-lookup skeleton shared by every provider client: online/key guards, prompt
 * assembly, the timeout + caller-signal-merged AbortController, and the failure→LookupError
 * mapping. Providers supply only their `spec` (endpoint, headers, body, parsers, provider tag).
 */
export async function runHttpLookup(
  spec: HttpLookupSpec,
  deps: HttpLookupDeps,
  req: LookupRequest,
  opts?: { signal?: AbortSignal },
): Promise<LookupResult> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) rejectWith(mapError({ kind: 'no-key', provider: spec.provider }));
  // `navigator` exists in both the content-script and service-worker scopes that
  // compose these clients, so no existence guard is needed (avoids a dead branch).
  if (navigator.onLine === false) rejectWith(mapError({ kind: 'offline' }));

  const prompt = buildPrompt(
    req.outputFormat,
    {
      word: req.word,
      context: req.context,
      target_lang: req.target,
      url: req.url,
      title: req.title,
    },
    req.promptEnvelope,
    req.forceLiteral,
  );
  const body = spec.body(prompt, spec.model);

  const ac = new AbortController();
  const onAbort = (): void => ac.abort(opts?.signal?.reason);
  if (opts?.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const timeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new DOMException('timeout', 'TimeoutError'));
  }, timeout);

  try {
    const res = await deps.fetch(spec.endpoint, {
      method: 'POST',
      headers: spec.headers(apiKey),
      body,
      signal: ac.signal,
    });

    if (!res.ok) {
      // Drain the body so a raced abort during the read surfaces here. A native vendorStatus
      // (e.g. Anthropic 'rate_limit_error') and vendorMessage are the diagnostic signals;
      // vendorMessage is free text so mapError secret-scrubs + caps it before it can cross the wire.
      let parsed: ParsedHttpError = {};
      try {
        parsed = spec.parseErr(await res.json());
      } catch {
        /* non-JSON body: map by status alone */
      }
      const ra = res.headers.get('retry-after');
      const retryAfterSec = ra !== null ? Number(ra) : NaN;
      // Build imperatively (exactOptionalPropertyTypes): only attach optional keys when present.
      const httpInput: {
        kind: 'http';
        status: number;
        provider: Provider;
        geminiStatus?: string;
        vendorStatus?: string;
        retryAfterSec?: number;
        vendorMessage?: string;
      } = { kind: 'http', status: res.status, provider: spec.provider };
      if (parsed.geminiStatus !== undefined) httpInput.geminiStatus = parsed.geminiStatus;
      if (parsed.vendorStatus !== undefined) httpInput.vendorStatus = parsed.vendorStatus;
      if (!Number.isNaN(retryAfterSec)) httpInput.retryAfterSec = retryAfterSec;
      if (parsed.vendorMessage !== undefined) httpInput.vendorMessage = parsed.vendorMessage;
      rejectWith(mapError(httpInput));
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      rejectWith(mapError({ kind: 'parse', provider: spec.provider }));
    }
    const text = spec.parseOk(json);
    if (typeof text !== 'string' || text.length === 0)
      rejectWith(mapError({ kind: 'parse', provider: spec.provider }));

    const { definedAs, body: afterDefinedAs } = parseDefinedAs(text);
    const { translation, body: parsedBody } = parseTranslation(afterDefinedAs);
    return {
      markdown: parsedBody,
      word: req.word,
      target: req.target,
      model: spec.model,
      provider: spec.provider,
      fromCache: false,
      fetchedAt: Date.now(),
      ...(definedAs !== undefined ? { definedAs } : {}),
      ...(translation !== undefined ? { translation } : {}),
    };
  } catch (err) {
    // Guard: caller-cancel propagates raw ONLY when the error is NOT already a mapped
    // LookupError, so the SW router can keep distinguishing "user-cancelled (suppress)"
    // vs "server error (show)".
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
