import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '@ai-dict/core';
import { mapError } from '@ai-dict/core';

export interface RuntimeLike { sendMessage(message: unknown): Promise<unknown>; }

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
    private readonly genId: () => string = () => crypto.randomUUID(),
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
