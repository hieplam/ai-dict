import { z } from 'zod';
import type { LookupRequest, LookupResult, PublicSettings, HistoryEntry } from './types';

const LookupErrorSchema = z.strictObject({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'NETWORK', 'PARSE', 'UNKNOWN']),
  message: z.string().max(200),
  retryable: z.boolean(),
  retryAfterSec: z.number().optional(),
});

const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  promptTemplate: z.string(),
});

const LookupResultSchema = z.strictObject({
  markdown: z.string(),
  word: z.string(),
  target: z.string(),
  model: z.literal('gemini-2.5-flash'),
  fromCache: z.boolean(),
  fetchedAt: z.number(),
});

const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  promptTemplate: z.string(),
  hasKey: z.boolean(),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]

const HistoryEntrySchema = z.strictObject({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: LookupResultSchema,
  createdAt: z.number(),
});

export const WireMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookup'), req: LookupRequestSchema, requestId: z.string() }),
  z.object({ type: z.literal('lookup.cancel'), requestId: z.string() }),
  z.object({ type: z.literal('settings.get') }),
  z.object({
    type: z.literal('history.list'),
    limit: z.number().optional(),
    cursor: z.string().optional(),
  }),
  z.object({ type: z.literal('history.clear') }),
  z.object({ type: z.literal('cache.clear') }),
  z.object({ type: z.literal('connection.test') }),
]);

const MessageTypeEnum = z.enum([
  'lookup',
  'lookup.cancel',
  'settings.get',
  'history.list',
  'history.clear',
  'cache.clear',
  'connection.test',
]);

export const WireReplySchema = z.union([
  z.object({
    ok: z.literal(true),
    type: z.literal('lookup'),
    result: LookupResultSchema,
    requestId: z.string(),
  }),
  z.object({ ok: z.literal(true), type: z.literal('settings'), settings: PublicSettingsSchema }),
  z.object({
    ok: z.literal(true),
    type: z.literal('history'),
    entries: z.array(HistoryEntrySchema),
    nextCursor: z.string().optional(),
  }),
  z.object({ ok: z.literal(true), type: z.literal('ack') }),
  z.object({
    ok: z.literal(false),
    type: MessageTypeEnum,
    error: LookupErrorSchema,
    requestId: z.string().optional(),
  }),
]);

export type WireMessage = z.infer<typeof WireMessageSchema>;
export type WireReply = z.infer<typeof WireReplySchema>;

export function wireJsonSchema(): unknown {
  return {
    WireMessage: z.toJSONSchema(WireMessageSchema),
    WireReply: z.toJSONSchema(WireReplySchema),
  };
}

// Compile-time drift guard: domain types must match wire schemas exactly
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _checks: [
  AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest>,
  AssertEqual<z.infer<typeof LookupResultSchema>, LookupResult>,
  AssertEqual<z.infer<typeof PublicSettingsSchema>, PublicSettings>,
  AssertEqual<z.infer<typeof HistoryEntrySchema>, HistoryEntry>,
] = [true, true, true, true];
void _checks;
