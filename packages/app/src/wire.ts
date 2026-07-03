import { z } from 'zod';
import type { LookupRequest, LookupResult, PublicSettings, HistoryEntry } from './domain/types';

const LookupErrorSchema = z.strictObject({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'NETWORK', 'PARSE', 'UNKNOWN']),
  message: z.string().max(200),
  retryable: z.boolean(),
  retryAfterSec: z.number().optional(),
  // Diagnostic-only provider failure signature for opt-in telemetry; never rendered in the UI.
  httpStatus: z.number().optional(),
  vendorStatus: z.string().max(150).optional(),
  vendorMessage: z.string().max(200).optional(),
});

const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  outputFormat: z.string(),
});

const ProviderEnum = z.enum(['gemini', 'openai', 'anthropic']);

const LookupResultSchema = z.strictObject({
  markdown: z.string(),
  word: z.string(),
  target: z.string(),
  // Display-only model id; non-empty string rather than a per-provider literal
  // so adding a provider never requires a wire-schema change.
  model: z.string().min(1),
  fromCache: z.boolean(),
  fetchedAt: z.number(),
  provider: ProviderEnum.optional(),
  fallbackFrom: ProviderEnum.optional(),
});

const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
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
  // Delete ONE history entry and the cached definition derived from it (the router reads the
  // stored entry's word/context/target to derive the cache key), so the next lookup of the same
  // selection re-queries Gemini with the current prompt template. Sent by the side panel.
  z.object({ type: z.literal('history.delete'), id: z.string() }),
  z.object({ type: z.literal('cache.clear') }),
  z.object({ type: z.literal('connection.test') }),
  // Open the extension's options page. Sent by a content script (which cannot call
  // chrome.runtime.openOptionsPage itself) when the reader taps "Open Settings" on the
  // no-key card; the service worker performs the actual open. Payload-free.
  z.object({ type: z.literal('open-options') }),
  // Error-reporting control messages. errlog.status queries the current consent/queue state;
  // errlog.set-consent records the user's choice (granted/declined/disabled).
  z.object({ type: z.literal('errlog.status') }),
  z.object({
    type: z.literal('errlog.set-consent'),
    state: z.enum(['granted', 'declined', 'disabled']),
  }),
]);

const MessageTypeEnum = z.enum([
  'lookup',
  'lookup.cancel',
  'settings.get',
  'history.list',
  'history.clear',
  'history.delete',
  'cache.clear',
  'connection.test',
  'open-options',
  'errlog.status',
  'errlog.set-consent',
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
    ok: z.literal(true),
    type: z.literal('errlog'),
    consent: z.enum(['unset', 'granted', 'disabled']),
    pending: z.boolean(),
    count: z.number(),
  }),
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
