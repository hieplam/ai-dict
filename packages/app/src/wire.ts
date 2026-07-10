import { z } from 'zod';
import type {
  LookupRequest,
  LookupResult,
  PublicSettings,
  HistoryEntry,
  SavedWordEntry,
} from './domain/types';

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

const ProviderEnum = z.enum(['gemini', 'openai', 'anthropic']);

// A8: the idiom/literal unit the model actually defined.
const DefinedAsSchema = z.strictObject({ term: z.string(), isIdiom: z.boolean() });

const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  outputFormat: z.string(),
  // Full prompt envelope override (advanced, #62); '' = built-in envelope.
  promptEnvelope: z.string(),
  // One-shot manual provider override from the card picker; absent on normal lookups.
  provider: ProviderEnum.optional(),
  // A8: one-shot "Show literal word" override; absent on normal lookups.
  forceLiteral: z.boolean().optional(),
});

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
  // A8: the idiom/literal unit actually defined; absent for legacy/non-compliant responses.
  definedAs: DefinedAsSchema.optional(),
  // B2: the model's direct target-language translation; absent for legacy/non-compliant
  // responses or a custom envelope override that omits {translation_instruction}.
  translation: z.string().optional(),
  // B7: set once, ever, per word — see LookupResult.nudge's doc comment (domain/types.ts).
  nudge: z.boolean().optional(),
});

const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
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

const SavedWordSenseSchema = z.strictObject({
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
});

// B1: the ratified saved-word entry shape (escalation E1). No `id` field — the (normalized)
// `word` itself is the storage key.
const SavedWordEntrySchema = z.strictObject({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(SavedWordSenseSchema),
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
  // B1: save/unsave a word into the independent `saved:*` keyspace. Sent by the card's star
  // button (via the composition root) or the side panel's own toggle-save listener.
  z.object({
    type: z.literal('saved.save'),
    word: z.string(),
    definition: z.string(),
    translation: z.string(),
    sentence: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  z.object({ type: z.literal('saved.delete'), word: z.string() }),
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
  'saved.save',
  'saved.delete',
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
  z.object({ ok: z.literal(true), type: z.literal('saved'), entry: SavedWordEntrySchema }),
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
  AssertEqual<z.infer<typeof SavedWordEntrySchema>, SavedWordEntry>,
] = [true, true, true, true, true];
void _checks;
