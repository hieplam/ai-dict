import type { LookupClient, LookupRequest, LookupResult } from '../index';
import { runHttpLookup, type HttpLookupDeps } from './http-lookup-client';
import { runGeminiStreamingLookup } from './gemini-streaming';

// Re-exported for the existing test import path (`src/app/gemini-lookup-client`); the fetch
// abstraction now lives in the shared http-lookup-client helper.
export type { FetchLike, ResponseLike } from './http-lookup-client';

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
// A1: streaming endpoint, same model — exported so gemini-streaming.test.ts / other callers can
// reference it without duplicating the literal.
export const MODEL = 'gemini-2.5-flash';
const STREAM_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

export type GeminiDeps = HttpLookupDeps;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

const HEADERS = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-Goog-Api-Key': apiKey,
});
const BODY = (prompt: string): string =>
  JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });

export class GeminiLookupClient implements LookupClient {
  constructor(private readonly deps: GeminiDeps) {}

  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult> {
    // A1: the ONLY dispatch condition — no settings flag, no capability probe (design spec §3).
    if (opts?.onChunk) {
      return runGeminiStreamingLookup(
        { endpoint: STREAM_ENDPOINT, model: MODEL, headers: HEADERS, body: BODY },
        this.deps,
        req,
        opts.onChunk,
        opts,
      );
    }
    // Unchanged non-streaming path — byte-identical to the pre-A1 implementation.
    return runHttpLookup(
      {
        provider: 'gemini',
        endpoint: ENDPOINT,
        model: MODEL,
        headers: HEADERS,
        body: BODY,
        parseOk: (json) => (json as GeminiOkBody).candidates?.[0]?.content?.parts?.[0]?.text,
        parseErr: (json) => {
          const err = (json as GeminiErrBody).error;
          return {
            ...(err?.status !== undefined ? { geminiStatus: err.status } : {}),
            ...(err?.message !== undefined ? { vendorMessage: err.message } : {}),
          };
        },
      },
      this.deps,
      req,
      opts,
    );
  }
}
