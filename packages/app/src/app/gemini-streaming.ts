import {
  mapError,
  buildPrompt,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';
import { parseDefinedAs } from '../domain/defined-as';
import { parseTranslation } from '../domain/translation-line';
import type { HttpLookupDeps } from './http-lookup-client';

// Same DEFAULT_TIMEOUT_MS budget as the non-streaming path (http-lookup-client.ts:12) — covers
// the WHOLE stream, not per-chunk: no new "stalled chunk" timeout is invented (design spec §4.2).
const STREAM_TIMEOUT_MS = 20000;

// Withhold the first partial repaint until the DEFINED_AS + TRANSLATION signal lines (emitted
// FIRST by the prompt: default-template.ts:43-45,64-65) are fully resolved, or this many raw
// characters have accumulated with no match — generous headroom over the longest realistic
// DEFINED_AS + TRANSLATION line pair, so a legacy/custom prompt envelope that never emits them
// still starts streaming promptly (see parseDefinedAs/parseTranslation's own documented
// "body is the ENTIRE text unchanged" fallback).
const HEADER_MAX_BUFFER_CHARS = 400;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

// Throw an Error instance carrying LookupError fields, satisfying @typescript-eslint/only-throw-error
// — mirrors http-lookup-client.ts's own rejectWith exactly.
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}
function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}

// Race a promise against OUR OWN internal AbortSignal rather than trusting `deps.fetch` alone to
// reject once it aborts. A well-behaved fetch (real `fetch()`, and http-lookup-client.ts's own
// test doubles) already does this itself, but the SSE-stream fetch stays pending far longer than
// a one-shot JSON fetch — so this file races explicitly, matching the defensive pattern the SSE
// body-reading loop below already uses for the caller's own signal.
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason as Error);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface GeminiStreamSpec {
  endpoint: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (prompt: string, model: string) => string;
}

/**
 * A1: Gemini's SSE streaming client — a separate function from runHttpLookup (http-lookup-client.ts),
 * deliberately, so http-lookup-client.ts / openai-lookup-client.ts / anthropic-lookup-client.ts stay
 * byte-for-byte unchanged (design spec §4.2's rationale). Calls `onChunk` zero or more times with
 * the accumulated markdown, ALREADY stripped of DEFINED_AS:/TRANSLATION: signal lines, once those
 * lines (or HEADER_MAX_BUFFER_CHARS) have resolved. Returns the exact same LookupResult shape
 * runHttpLookup returns, built via the identical parseDefinedAs/parseTranslation tail.
 */
export async function runGeminiStreamingLookup(
  spec: GeminiStreamSpec,
  deps: HttpLookupDeps,
  req: LookupRequest,
  onChunk: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void,
  opts?: { signal?: AbortSignal },
): Promise<LookupResult> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) rejectWith(mapError({ kind: 'no-key', provider: 'gemini' }));
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
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new DOMException('timeout', 'TimeoutError'));
  }, deps.timeoutMs ?? STREAM_TIMEOUT_MS);

  try {
    const res = await raceAbort(
      deps.fetch(spec.endpoint, {
        method: 'POST',
        headers: spec.headers(apiKey),
        body,
        signal: ac.signal,
      }),
      ac.signal,
    );

    if (!res.ok) {
      // Identical shape to http-lookup-client.ts:118-144: a rejected/malformed request fails
      // BEFORE any SSE stream begins, so Gemini returns one plain JSON error body, not SSE.
      let geminiStatus: string | undefined;
      let vendorMessage: string | undefined;
      try {
        const errJson = (await res.json()) as GeminiErrBody;
        geminiStatus = errJson.error?.status;
        vendorMessage = errJson.error?.message;
      } catch {
        /* non-JSON body: map by status alone */
      }
      const ra = res.headers.get('retry-after');
      const retryAfterSec = ra !== null ? Number(ra) : NaN;
      rejectWith(
        mapError({
          kind: 'http',
          status: res.status,
          provider: 'gemini',
          ...(geminiStatus !== undefined ? { geminiStatus } : {}),
          ...(vendorMessage !== undefined ? { vendorMessage } : {}),
          ...(!Number.isNaN(retryAfterSec) ? { retryAfterSec } : {}),
        }),
      );
    }
    const streamBody = (res as unknown as { body: ReadableStream<Uint8Array> | null }).body;
    if (!streamBody) rejectWith(mapError({ kind: 'parse', provider: 'gemini' }));

    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let sseTail = '';
    let headerResolved = false;
    let resolvedDefinedAs: { term: string; isIdiom: boolean } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseTail += decoder.decode(value, { stream: true });
      const events = sseTail.split('\n\n');
      sseTail = events.pop() ?? '';
      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice('data: '.length).trim();
        if (payload.length === 0) continue;
        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // a malformed frame is skipped, not fatal — later frames still accumulate
        }
        const delta = (json as GeminiOkBody).candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof delta === 'string') raw += delta;

        if (!headerResolved) {
          const { definedAs, body: afterDefined } = parseDefinedAs(raw);
          const { translation, body: afterBoth } = parseTranslation(afterDefined);
          const bothResolved = definedAs !== undefined && translation !== undefined;
          if (bothResolved || raw.length >= HEADER_MAX_BUFFER_CHARS) {
            headerResolved = true;
            resolvedDefinedAs = definedAs;
            onChunk(afterBoth, resolvedDefinedAs);
          }
        } else {
          const { body: afterDefined } = parseDefinedAs(raw);
          const { body: afterBoth } = parseTranslation(afterDefined);
          onChunk(afterBoth, resolvedDefinedAs);
        }
      }
    }

    if (raw.length === 0) rejectWith(mapError({ kind: 'parse', provider: 'gemini' }));
    const { definedAs, body: afterDefinedAs } = parseDefinedAs(raw);
    const { translation, body: parsedBody } = parseTranslation(afterDefinedAs);
    return {
      markdown: parsedBody,
      word: req.word,
      target: req.target,
      model: spec.model,
      provider: 'gemini',
      fromCache: false,
      fetchedAt: Date.now(),
      ...(definedAs !== undefined ? { definedAs } : {}),
      ...(translation !== undefined ? { translation } : {}),
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
  return rejectWith(mapError({ kind: 'offline' })); // unreachable; mirrors http-lookup-client.ts:182-184
}
