import { WireMessageSchema, mapError, type WireMessage, type WireReply } from '../index';

export type Inbound<T = WireMessage> =
  | { action: 'ignore' }
  | { action: 'reject'; reply: WireReply }
  | { action: 'route'; msg: T };

export type ParseResult<T> = { success: true; data: T } | { success: false };

function defaultParse(msg: unknown): ParseResult<WireMessage> {
  const parsed = WireMessageSchema.safeParse(msg);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}

// Pass-through parse for non-WireMessage listener sites (content.ts, side-panel.ts): accepts any
// shape, never fails, so classifyInbound performs ONLY the S3 sender-guard for these callers.
export const acceptAny = (msg: unknown): ParseResult<unknown> => ({ success: true, data: msg });

// Pure: testable without the extension's messaging runtime. S3 sender guard + (by default) the
// S8.5 schema gate at the boundary. `parse` defaults to the real WireMessageSchema check so every
// existing sw.ts call site (both platforms) is unaffected; callers gating a non-WireMessage shape
// (content.ts, side-panel.ts) pass `acceptAny` to get sender-guard-only behavior.
export function classifyInbound<T = WireMessage>(
  msg: unknown,
  senderId: string | undefined,
  runtimeId: string,
  parse: (msg: unknown) => ParseResult<T> = defaultParse as unknown as (
    msg: unknown,
  ) => ParseResult<T>,
): Inbound<T> {
  if (senderId !== runtimeId) return { action: 'ignore' };
  const parsed = parse(msg);
  if (!parsed.success) {
    console.warn({ kind: 'wire-schema-mismatch' });
    return {
      action: 'reject',
      reply: { ok: false, type: 'lookup', error: mapError({ kind: 'parse' }) },
    };
  }
  return { action: 'route', msg: parsed.data };
}
