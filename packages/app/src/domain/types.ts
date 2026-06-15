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
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  /** Display-only metadata naming the model that produced the result (e.g. 'gemini-2.5-flash', 'gpt-4o-mini'). */
  model: string;
  fromCache: boolean;
  fetchedAt: number;
}

/**
 * AI provider answering lookups. 'gemini' is the default and the behavior
 * before the setting existed; each provider keeps its own API key.
 */
export type Provider = 'gemini' | 'openai';

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
}

export interface HistoryEntry {
  id: string;
  word: string;
  context: string;
  result: LookupResult;
  createdAt: number;
}

/**
 * Colour theme for every UI surface. 'light' is the default; 'system' follows
 * the OS via prefers-color-scheme (the behavior before the setting existed).
 */
export type Theme = 'light' | 'dark' | 'system';

export interface PublicSettings {
  targetLang: string;
  outputFormat: string;
  hasKey: boolean;
  theme: Theme;
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
}): boolean {
  return Boolean((s.provider ?? 'gemini') === 'openai' ? s.openaiApiKey : s.apiKey);
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
}
