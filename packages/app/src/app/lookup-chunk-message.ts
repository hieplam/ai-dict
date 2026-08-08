/**
 * A1 — streamed answers. A one-way push the service worker sends to the originating tab's
 * content script as a Gemini answer streams in, OUTSIDE the WireMessageSchema/classifyInbound
 * wire protocol entirely — mirrors command-messages.ts's CommandMessage exactly (A4's own
 * one-way SW -> content-script relay). requestId correlates a chunk to the in-flight lookup that
 * requested it (MessageRelayLookupClient.lookup's own requestId, message-relay-lookup-client.ts).
 * `markdown` is already stripped of any DEFINED_AS:/TRANSLATION: signal lines by the producer
 * (gemini-streaming.ts) — every consumer receives clean, directly-sanitizable body text.
 */
export interface LookupChunkMessage {
  type: 'lookup.chunk';
  requestId: string;
  markdown: string;
  /** A8: present once the model's DEFINED_AS line has resolved; same shape as LookupResult's. */
  definedAs?: { term: string; isIdiom: boolean };
}

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isLookupChunkMessage(msg: unknown): msg is LookupChunkMessage {
  return (
    hasType(msg) &&
    msg.type === 'lookup.chunk' &&
    'requestId' in msg &&
    typeof (msg as { requestId: unknown }).requestId === 'string' &&
    'markdown' in msg &&
    typeof (msg as { markdown: unknown }).markdown === 'string'
  );
}
