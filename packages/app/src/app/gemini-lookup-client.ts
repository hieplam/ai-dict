import type { LookupClient, LookupRequest, LookupResult } from '../index';
import { runHttpLookup, type HttpLookupDeps } from './http-lookup-client';

// Re-exported for the existing test import path (`src/app/gemini-lookup-client`); the fetch
// abstraction now lives in the shared http-lookup-client helper.
export type { FetchLike, ResponseLike } from './http-lookup-client';

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const MODEL = 'gemini-2.5-flash';

export type GeminiDeps = HttpLookupDeps;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

export class GeminiLookupClient implements LookupClient {
  constructor(private readonly deps: GeminiDeps) {}

  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    return runHttpLookup(
      {
        provider: 'gemini',
        endpoint: ENDPOINT,
        model: MODEL,
        headers: (apiKey) => ({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey }),
        body: (prompt) =>
          JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
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
