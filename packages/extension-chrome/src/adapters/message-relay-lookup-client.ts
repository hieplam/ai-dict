import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '@ai-dict/core';
import { mapError } from '@ai-dict/core';

export interface RuntimeLike { sendMessage(message: unknown): Promise<unknown>; }

// `crypto.randomUUID()` only exists in a SECURE context. Content scripts run on arbitrary
// pages, including plain `http://`, where it is `undefined` — calling it there throws
// "crypto.randomUUID is not a function" and the whole lookup fails before it reaches the SW.
// `crypto.getRandomValues` IS available in non-secure contexts, so build a v4 UUID from it.
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const withBits = Array.from(bytes, (b, i) =>
    i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b,
  );
  const hex = withBits.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rejectWith(e: LookupError): never {
  const err = new Error(e.message);
  (err as unknown as Record<string, unknown>)['code'] = e.code;
  (err as unknown as Record<string, unknown>)['message'] = e.message;
  (err as unknown as Record<string, unknown>)['retryable'] = e.retryable;
  if (e.retryAfterSec !== undefined) (err as unknown as Record<string, unknown>)['retryAfterSec'] = e.retryAfterSec;
  throw err;
}

export class MessageRelayLookupClient implements LookupClient {
  constructor(
    private readonly runtime: RuntimeLike,
    private readonly genId: () => string = randomId,
  ) {}

  async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    const requestId = this.genId();
    if (opts?.signal) {
      opts.signal.addEventListener(
        'abort',
        () => { void this.runtime.sendMessage({ type: 'lookup.cancel', requestId }); },
        { once: true },
      );
    }
    const reply = (await this.runtime.sendMessage({ type: 'lookup', req, requestId })) as WireReply;
    if (reply.ok && reply.type === 'lookup') return reply.result;
    if (!reply.ok) rejectWith(reply.error as LookupError);
    rejectWith(mapError({ kind: 'parse' })); // unexpected reply shape
  }
}
