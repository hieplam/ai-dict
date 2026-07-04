import type { LookupClient, LookupRequest, LookupResult } from '../index';
import { runHttpLookup, type HttpLookupDeps } from './http-lookup-client';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicDeps extends HttpLookupDeps {
  /** Messages API model id; defaults to claude-haiku-4-5-20251001. */
  model?: string;
}

interface AnthropicOkBody {
  content?: { type?: string; text?: string }[];
}
interface AnthropicErrBody {
  error?: { type?: string; message?: string };
}

export class AnthropicLookupClient implements LookupClient {
  constructor(private readonly deps: AnthropicDeps) {}

  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    return runHttpLookup(
      {
        provider: 'anthropic',
        endpoint: ENDPOINT,
        model: this.deps.model ?? DEFAULT_MODEL,
        headers: (apiKey) => ({
          'Content-Type': 'application/json',
          // S1: api key is transmitted ONLY via this header, never in URL/body/logs/wire messages.
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Required for direct browser access to the Anthropic API.
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
        body: (prompt, model) =>
          JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        parseOk: (json) => (json as AnthropicOkBody).content?.find((c) => c.type === 'text')?.text,
        parseErr: (json) => {
          const err = (json as AnthropicErrBody).error;
          return {
            ...(err?.type !== undefined ? { vendorStatus: err.type } : {}),
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
