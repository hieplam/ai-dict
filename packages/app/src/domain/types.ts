export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
}

export interface LookupRequest {
  word: string;
  context: string;
  url: string;
  title: string;
  target: string;
  outputFormat: string;
  /** Full prompt envelope override (advanced, #62). `''` = use the built-in envelope. */
  promptEnvelope: string;
  /**
   * One-shot provider override from the card's manual picker. When set, the pool
   * tries this provider first (bypassing the stored default) and the router skips
   * the cache read so the picked provider actually answers. Declared
   * `Provider | undefined` for Zod/EOP alignment with the optional wire field.
   */
  provider?: Provider | undefined;
  /**
   * A8: one-shot request to define ONLY the literal, single selected word, bypassing idiom/
   * phrasal-verb detection (the card's "Show literal word" button). Re-runs the SAME selection
   * once; does not persist. The router skips the cache read for the same reason as `provider`
   * above — a hit would echo back the smart idiom-aware answer instead.
   */
  forceLiteral?: boolean | undefined;
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  /** Display-only metadata naming the model that produced the result (e.g. 'gemini-2.5-flash', 'gpt-4o-mini'). */
  model: string;
  fromCache: boolean;
  fetchedAt: number;
  /** The provider that produced this result. Stamped by each lookup client. */
  provider?: Provider | undefined;
  /**
   * Set by the fallback pool when a non-primary provider answered.
   * Stripped before cache/history writes — transient per-request annotation.
   * Declared `Provider | undefined` (not just `Provider`) for Zod/EOP alignment.
   */
  fallbackFrom?: Provider | undefined;
  /**
   * A8: the unit the model actually defined — its literal selection, or, when the selection is
   * part of an idiom/phrasal verb, the whole idiomatic unit. Stamped by the shared HTTP lookup
   * skeleton from the model's DEFINED_AS line (see domain/defined-as.ts). Absent when the model
   * didn't emit a recognisable line (legacy cached/history entries, a non-compliant model, or a
   * custom envelope override that omits the instruction) — never blocks rendering.
   */
  definedAs?: { term: string; isIdiom: boolean } | undefined;
}

/**
 * AI provider answering lookups. 'gemini' is the default and the behavior
 * before the setting existed; each provider keeps its own API key.
 */
export type Provider = 'gemini' | 'openai' | 'anthropic';

/** Canonical display order — used by the pool and settings UI. */
export const PROVIDERS: readonly Provider[] = ['gemini', 'openai', 'anthropic'];

/**
 * Derive which providers have an API key configured, in canonical order.
 * `opts.envGeminiKey` counts as a configured Gemini key (build-time injection).
 */
export function configuredProvidersFor(
  s: { apiKey?: string; openaiApiKey?: string; anthropicApiKey?: string },
  opts?: { envGeminiKey?: boolean },
): Provider[] {
  const out: Provider[] = [];
  if (opts?.envGeminiKey || s.apiKey) out.push('gemini');
  if (s.openaiApiKey) out.push('openai');
  if (s.anthropicApiKey) out.push('anthropic');
  return out;
}

export type LookupErrorCode =
  | 'NO_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'PARSE'
  | 'UNKNOWN';

export interface LookupError {
  code: LookupErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSec?: number;
  /**
   * Diagnostic-only fields carrying the provider's own failure signature, so opt-in
   * telemetry can distinguish e.g. a 503 UNAVAILABLE (overloaded) from a 500 INTERNAL.
   * Never shown in the UI (the card uses `message`). `vendorMessage` is secret-scrubbed
   * and length-capped at the mapper before it ever crosses the wire (rule-api-key-isolation).
   */
  httpStatus?: number;
  vendorStatus?: string;
  vendorMessage?: string;
}

export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
}

/**
 * Colour theme for every UI surface (the "Paperlight" system). 'sepia' is the
 * warm-paper default; 'dark' is the warm low-glare night theme; 'contrast' is the
 * high-contrast accessibility theme; 'system' follows the OS via prefers-color-scheme.
 * Stamped on each component host as the `data-ad-theme` attribute.
 */
export type Theme = 'sepia' | 'dark' | 'contrast' | 'system';

const THEMES: readonly Theme[] = ['sepia', 'dark', 'contrast', 'system'];

/**
 * Coerce a stored/unknown theme value to a valid Theme. Settings saved before
 * Paperlight hold the legacy 'light' value — it maps to the new 'sepia' default.
 * Anything else unrecognised also falls back to 'sepia'. Pure: safe in the domain.
 */
export function normalizeTheme(value: unknown): Theme {
  if (value === 'light') return 'sepia';
  return THEMES.includes(value as Theme) ? (value as Theme) : 'sepia';
}

export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  /**
   * Full prompt envelope override (advanced, #62). `''` = use the built-in envelope;
   * resolved from a legacy stored `promptTemplate` at read time (see `resolvePromptEnvelope`).
   */
  promptEnvelope: string;
  hasKey: boolean;
  theme: Theme;
  /** Provider names that have an API key configured. Keys themselves are never included. */
  configuredProviders: Provider[];
}

/**
 * Derive PublicSettings.hasKey: "does the *selected* provider have a key?".
 * Accepts partial shapes because settings stored before the provider field
 * existed lack `provider`/`openaiApiKey` — those read as Gemini.
 */
export function hasKeyFor(s: {
  provider?: Provider;
  apiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}): boolean {
  const p = s.provider ?? 'gemini';
  if (p === 'openai') return Boolean(s.openaiApiKey);
  if (p === 'anthropic') return Boolean(s.anthropicApiKey);
  return Boolean(s.apiKey);
}

export function isLookupError(e: unknown): e is LookupError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e && 'retryable' in e;
}

/**
 * Full settings including the secret API keys.
 *
 * Holds the secret apiKey (Gemini) and openaiApiKey — trusted contexts only
 * (options page / storage adapter). Never assign a Settings value to a wire/reply
 * field; SettingsStore.get() returns PublicSettings. S1.
 *
 * `provider` selects which client answers lookups; `hasKey` (PublicSettings)
 * means "the selected provider has a key". Settings stored before this field
 * existed have no `provider`/`openaiApiKey` — readers default to 'gemini'/''.
 */
export interface Settings extends PublicSettings {
  apiKey: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  provider: Provider;
  openaiApiKey: string;
  anthropicApiKey: string;
}
