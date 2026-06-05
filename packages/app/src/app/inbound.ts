import { WireMessageSchema, mapError, type WireMessage, type WireReply } from '../index';

export type Inbound =
  | { action: 'ignore' }
  | { action: 'reject'; reply: WireReply }
  | { action: 'route'; msg: WireMessage };

// Pure: testable without the extension's messaging runtime. S3 sender guard + S8.5 schema gate at the boundary.
export function classifyInbound(
  msg: unknown,
  senderId: string | undefined,
  runtimeId: string,
): Inbound {
  if (senderId !== runtimeId) return { action: 'ignore' };
  const parsed = WireMessageSchema.safeParse(msg);
  if (!parsed.success) {
    console.warn({ kind: 'wire-schema-mismatch' });
    return {
      action: 'reject',
      reply: { ok: false, type: 'lookup', error: mapError({ kind: 'parse' }) },
    };
  }
  return { action: 'route', msg: parsed.data };
}
