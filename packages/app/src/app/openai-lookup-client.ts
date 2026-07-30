import type { LookupClient, LookupRequest, LookupResult } from '../index';
import { runHttpLookup, type HttpLookupDeps } from './http-lookup-client';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAIDeps extends HttpLookupDeps {
  /** Chat-completions model id; defaults to gpt-4o-mini. */
  model?: string;
}

interface OpenAIOkBody {
  choices?: { message?: { content?: string } }[];
}
interface OpenAIErrBody {
  error?: { message?: string; code?: string; type?: string };
}

export class OpenAILookupClient implements LookupClient {
  constructor(private readonly deps: OpenAIDeps) {}

  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    return runHttpLookup(
      {
        provider: 'openai',
        endpoint: ENDPOINT,
        model: this.deps.model ?? DEFAULT_MODEL,
        headers: (apiKey) => ({
          'Content-Type': 'application/json',
          // S1: the key travels only in this header, never in URL/body/logs/wire messages.
          Authorization: `Bearer ${apiKey}`,
        }),
        body: (prompt, model) =>
          JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
        parseOk: (json) => (json as OpenAIOkBody).choices?.[0]?.message?.content,
        // D1: error.code is now a mapping signal too (e.g. 'insufficient_quota' → BILLING),
        // forwarded as vendorStatus to match Anthropic's existing pattern (error.type).
        parseErr: (json) => {
          const err = (json as OpenAIErrBody).error;
          return {
            ...(err?.code !== undefined ? { vendorStatus: err.code } : {}),
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
