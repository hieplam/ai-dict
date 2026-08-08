import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '../index';
import { mapError } from '../index';
import { isLookupChunkMessage } from './lookup-chunk-message';

export interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
  /**
   * A1: optional — only needed by a caller that passes opts.onChunk to lookup(). chrome.runtime
   * (passed in at content.ts) already satisfies this shape; a test fake omits it entirely when a
   * test never exercises streaming.
   */
  onMessage?: {
    addListener(cb: (msg: unknown, sender: { id?: string | undefined }) => void): void;
    removeListener(cb: (msg: unknown, sender: { id?: string | undefined }) => void): void;
  };
}

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
  if (e.retryAfterSec !== undefined)
    (err as unknown as Record<string, unknown>)['retryAfterSec'] = e.retryAfterSec;
  throw err;
}

export class MessageRelayLookupClient implements LookupClient {
  constructor(
    private readonly runtime: RuntimeLike,
    private readonly genId: () => string = randomId,
    // A1: the extension id to gate an inbound lookup.chunk push against (S3-style hygiene,
    // mirrors content.ts:210's `if (sender.id !== chrome.runtime.id) return;`). Optional so
    // existing non-Chrome-specific callers/tests that never stream need not supply it.
    private readonly extensionId?: string,
  ) {}

  async lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult> {
    const requestId = this.genId();
    if (opts?.signal) {
      opts.signal.addEventListener(
        'abort',
        () => {
          void this.runtime.sendMessage({ type: 'lookup.cancel', requestId });
        },
        { once: true },
      );
    }

    // A1: a per-call, scoped listener for this request's chunks — mirrors the abort listener
    // above's exact lifecycle (registered per call, torn down when the call settles).
    const onChunk = opts?.onChunk;
    const onRuntimeMessage = onChunk
      ? (msg: unknown, sender: { id?: string | undefined }): void => {
          if (this.extensionId !== undefined && sender.id !== this.extensionId) return;
          if (isLookupChunkMessage(msg) && msg.requestId === requestId) {
            onChunk(msg.markdown, msg.definedAs);
          }
        }
      : undefined;
    if (onRuntimeMessage) this.runtime.onMessage?.addListener(onRuntimeMessage);

    try {
      const reply = (await this.runtime.sendMessage({
        type: 'lookup',
        req,
        requestId,
      })) as WireReply;
      if (reply.ok && reply.type === 'lookup') return reply.result;
      if (!reply.ok) rejectWith(reply.error as LookupError);
      rejectWith(mapError({ kind: 'parse' })); // unexpected reply shape
    } finally {
      if (onRuntimeMessage) this.runtime.onMessage?.removeListener(onRuntimeMessage);
    }
    // Unreachable: every path inside the try block above returns or throws. This explicit
    // trailing statement exists solely because TS's control-flow analysis of a try/finally
    // whose finally body contains a conditional statement (no else) does not otherwise prove
    // exhaustiveness here (TS2366) — mirrors gemini-streaming.ts's own documented "unreachable"
    // trailing return for the same reason.
    return rejectWith(mapError({ kind: 'parse' }));
  }
}
