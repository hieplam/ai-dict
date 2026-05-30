// stub — will be implemented in Task C
import type { LookupClient, LookupRequest, LookupResult } from '@ai-dict/core';

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

export class GeminiLookupClient implements LookupClient {
  constructor(_deps: GeminiDeps) {}
  lookup(_req: LookupRequest, _opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    throw new Error('not implemented');
  }
}
