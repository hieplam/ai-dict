import { z } from 'zod';
import type {
  LookupRequest,
  LookupResult,
  PublicSettings,
  HistoryEntry,
  SavedWordEntry,
} from './domain/types';

const LookupErrorSchema = z.strictObject({
  code: z.enum(['NO_KEY', 'INVALID_KEY', 'RATE_LIMIT', 'BILLING', 'NETWORK', 'PARSE', 'UNKNOWN']),
  message: z.string().max(200),
  retryable: z.boolean(),
  retryAfterSec: z.number().optional(),
  // Diagnostic-only provider failure signature for opt-in telemetry; never rendered in the UI.
  httpStatus: z.number().optional(),
  vendorStatus: z.string().max(150).optional(),
  vendorMessage: z.string().max(200).optional(),
});

const ProviderEnum = z.enum(['gemini', 'openai', 'anthropic']);

const RefineKindEnum = z.enum(['simpler', 'examples', 'etymology', 'usage', 'related']);

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
  // A12: bare BCP-47 primary subtag (e.g. 'fr'); absent = could not be determined.
  sourceLang: z.string().optional(),
  // A12: true only for a manual, one-shot override — see domain/types.ts's doc comment.
  sourceLangOverride: z.boolean().optional(),
  // A3: one-shot refine request; absent on normal lookups. See domain/types.ts's doc comment.
  refine: RefineKindEnum.optional(),
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
  // B13: parsed RELATED words for this sense; present only on a 'related' refine result.
  related: z.array(z.string()).optional(),
});

const PublicSettingsSchema = z.strictObject({
  targetLang: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  hasKey: z.boolean(),
  theme: z.enum(['sepia', 'dark', 'contrast', 'system']),
  configuredProviders: z.array(ProviderEnum),
  // A5: opt-in "Compact gloss" render mode. See PublicSettings' doc comment (domain/types.ts).
  glossMode: z.boolean().optional(),
  // A14: opt-in double-click-to-define. See PublicSettings' doc comment (domain/types.ts).
  doubleClickLookup: z.boolean().optional(),
  // B3: paint saved learning-status words on pages. See PublicSettings' doc comment (domain/types.ts).
  highlightSavedWords: z.boolean(),
}); // z.strictObject() rejects extra keys (e.g. apiKey) → enforces [S1]

const HistoryEntrySchema = z.strictObject({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: LookupResultSchema,
  createdAt: z.number(),
  // B10: see HistoryEntry's doc comment (domain/types.ts) — absent on pre-B10 entries.
  url: z.string().optional(),
  title: z.string().optional(),
});

const SavedWordSenseSchema = z.strictObject({
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
  // B13: additive under the E1 lock — see domain/types.ts's SavedWordSense.related doc comment.
  related: z.array(z.string()).optional(),
});

// B1: the ratified saved-word entry shape (escalation E1). No `id` field — the (normalized)
// `word` itself is the storage key.
const SavedWordEntrySchema = z.strictObject({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(SavedWordSenseSchema),
});

// B9: non-strict on purpose (NOT z.strictObject, unlike every other wire schema in this file) —
// CONTRACTS §3/E2 promises "importers ignore unknown future fields." A backup file written by a
// future extension version may carry additive fields this version's code has never heard of; a
// strict schema would reject the ENTIRE entry (and thus the whole array) instead of simply not
// preserving the field it doesn't recognise. See the design spec §3.5 for the full rationale —
// do not "fix" this back to strict.
const ImportSavedWordSenseSchema = z.object({
  definition: z.string(),
  translation: z.string(),
  sentence: z.string(),
  url: z.string(),
  title: z.string(),
});
const ImportSavedWordEntrySchema = z.object({
  word: z.string(),
  status: z.enum(['learning', 'known']),
  savedAt: z.number(),
  senses: z.array(ImportSavedWordSenseSchema),
});
const ImportHistoryEntrySchema = z.object({
  id: z.string(),
  word: z.string(),
  context: z.string(),
  result: z.object({
    markdown: z.string(),
    word: z.string(),
    target: z.string(),
    model: z.string().min(1),
    fromCache: z.boolean(),
    fetchedAt: z.number(),
  }),
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
    // B14: explicit confirmation to append this context as a NEW sense on an already-saved
    // headword, after a prior saved.save reply signalled `type: 'saved.conflict'`. Absent/false
    // on every normal first-attempt save (including a brand-new word, or an exact sentence+url
    // repeat, which the router treats as a no-op, not a conflict).
    confirmNewSense: z.boolean().optional(),
  }),
  z.object({ type: z.literal('saved.delete'), word: z.string() }),
  // B5: manually set an existing saved word's status ('learning' default | 'known' manual).
  // No-op server-side when the word isn't currently saved — see savedWordSetStatus's doc comment.
  z.object({
    type: z.literal('saved.setStatus'),
    word: z.string(),
    status: z.enum(['learning', 'known']),
  }),
  // B13: patch the related-words list onto an ALREADY-saved entry's current sense. No-op
  // server-side (replies ack, writes nothing) when the word isn't currently saved — see
  // domain/saved-words-policy.ts's savedWordSetRelated. Sent automatically by content.ts the
  // instant a 'related' refine result renders; never sent by any explicit UI button.
  z.object({
    type: z.literal('saved.setRelated'),
    word: z.string(),
    related: z.array(z.string()),
  }),
  // B8: read every saved word (no pagination — mirrors savedWordsList's "full list" contract,
  // saved-words-policy.ts:108-109). Read-only; the only caller today is the Anki/CSV/Markdown
  // export flow in settings-form.ts.
  z.strictObject({ type: z.literal('saved.list') }),
  // B9: import a backup file's saved words + history into the local keyspaces. Settings import
  // happens entirely client-side in the options page — never touches the wire — so this message
  // never carries a settings payload, and (S1) never a key.
  z.object({
    type: z.literal('backup.import'),
    mode: z.enum(['merge', 'replace']),
    savedWords: z.array(ImportSavedWordEntrySchema),
    history: z.array(ImportHistoryEntrySchema),
  }),
  // B3: read every saved word whose status is 'learning' (known words excluded) — the
  // re-encounter highlighter's word list. Read-only; payload-free like settings.get.
  z.object({ type: z.literal('saved.learningWords') }),
  // B4: fetch one full saved entry by word, for the hover-recall popup. Content scripts never
  // read chrome.storage directly (S1/ref-kv-storage-prefixes) — this is the read counterpart to
  // saved.save's write. Read-only, no queue.
  z.object({ type: z.literal('saved.get'), word: z.string() }),
  z.object({ type: z.literal('cache.clear') }),
  z.object({ type: z.literal('connection.test') }),
  // Open the extension's options page. Sent by a content script (which cannot call
  // chrome.runtime.openOptionsPage itself) when the reader taps "Open Settings" on the
  // no-key card; the service worker performs the actual open. Payload-free.
  z.object({ type: z.literal('open-options'), fixKey: z.boolean().optional() }),
  // Error-reporting control messages. errlog.status queries the current consent/queue state;
  // errlog.set-consent records the user's choice (granted/declined/disabled).
  z.object({ type: z.literal('errlog.status') }),
  z.object({
    type: z.literal('errlog.set-consent'),
    state: z.enum(['granted', 'declined', 'disabled']),
  }),
  // A13: read/add/remove entries in the independent `quiet:*` keyspace (per-site quiet mode).
  // `quiet.add`/`quiet.remove` both reply with the full, updated list so the caller (card or
  // settings page) never needs a second round trip.
  z.object({ type: z.literal('quiet.list') }),
  z.object({ type: z.literal('quiet.add'), domain: z.string().min(1) }),
  z.object({ type: z.literal('quiet.remove'), domain: z.string().min(1) }),
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
  'saved.setStatus',
  'saved.setRelated',
  'saved.list',
  'backup.import',
  'saved.learningWords',
  'saved.get',
  'quiet.list',
  'quiet.add',
  'quiet.remove',
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
  // B14: returned instead of `saved` when `word` already has a saved entry with a DIFFERENT
  // sentence+url than the incoming payload and confirmNewSense wasn't set — NO write happened.
  // The caller must re-send saved.save with confirmNewSense:true to append, or do nothing
  // (decline = no write, roadmap B14 fence).
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.conflict'),
    word: z.string(),
    senseCount: z.number(),
  }),
  // B8: reply type is 'saved.list' (bound to the message's own name), not a second synonym for
  // 'saved' — 'saved' already means "one entry" (saved.save/setStatus replies); see design spec §2.
  z.object({
    ok: z.literal(true),
    type: z.literal('saved.list'),
    entries: z.array(SavedWordEntrySchema),
  }),
  // B9: reply to backup.import — how many saved words / history entries were actually written
  // (a merge that only skips ties can legitimately report 0 for either count).
  z.object({
    ok: z.literal(true),
    type: z.literal('backup-imported'),
    savedWordsImported: z.number(),
    historyImported: z.number(),
  }),
  // B3: reply to saved.learningWords — the flat list of learning-status words the
  // re-encounter highlighter matches against.
  z.object({
    ok: z.literal(true),
    type: z.literal('savedWords'),
    words: z.array(z.string()),
  }),
  // B4: a nullable entry (the word may have been unsaved between B3 painting the highlight and
  // the reader hovering it) — deliberately a NEW reply arm rather than widening the existing
  // `saved` arm, which every saved.save/saved.setStatus caller already assumes is non-null.
  z.object({
    ok: z.literal(true),
    type: z.literal('savedEntry'),
    entry: SavedWordEntrySchema.nullable(),
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal('errlog'),
    consent: z.enum(['unset', 'granted', 'disabled']),
    pending: z.boolean(),
    count: z.number(),
  }),
  z.object({ ok: z.literal(true), type: z.literal('quiet'), domains: z.array(z.string()) }),
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
  AssertEqual<z.infer<typeof ImportSavedWordEntrySchema>, SavedWordEntry>,
  AssertEqual<z.infer<typeof ImportHistoryEntrySchema>, HistoryEntry>,
] = [true, true, true, true, true, true, true];
void _checks;
