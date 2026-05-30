import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '@ai-dict/core';
import { mapError } from '@ai-dict/core';

export interface RuntimeLike { sendMessage(message: unknown): Promise<unknown>; }

function rejectWith(e: LookupError): never { throw Object.assign(new Error(e.message), e); }

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
    if (!reply.ok) rejectWith(reply.error);
    rejectWith(mapError({ kind: 'parse' })); // unexpected reply shape
  }
}
