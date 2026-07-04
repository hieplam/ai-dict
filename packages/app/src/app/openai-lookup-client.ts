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
        // OpenAI carries no status vocabulary we map (HTTP status alone drives mapping); its
        // error.message is the diagnostic signal for telemetry.
        parseErr: (json) => {
          const message = (json as OpenAIErrBody).error?.message;
          return message !== undefined ? { vendorMessage: message } : {};
        },
      },
      this.deps,
      req,
      opts,
    );
  }
}
