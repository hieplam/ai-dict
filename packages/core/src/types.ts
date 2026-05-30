export interface AnchorRect { x: number; y: number; w: number; h: number; }

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
  promptTemplate: string;
}

export interface LookupResult {
  markdown: string;
  word: string;
  target: string;
  model: 'gemini-2.5-flash';
  fromCache: boolean;
  fetchedAt: number;
}

export type LookupErrorCode =
  | 'NO_KEY' | 'INVALID_KEY' | 'RATE_LIMIT' | 'NETWORK' | 'PARSE' | 'UNKNOWN';

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

export interface PublicSettings {
  targetLang: string;
  promptTemplate: string;
  hasKey: boolean;
}

export function isLookupError(e: unknown): e is LookupError {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && 'message' in e && 'retryable' in e
  );
}
