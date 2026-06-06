import type {
  AnchorRect,
  SelectionEvent,
  LookupRequest,
  LookupResult,
  LookupError,
  PublicSettings,
} from './domain/types';

export interface SelectionSource {
  onSelection(cb: (e: SelectionEvent) => void): () => void;
}

export interface TriggerUI {
  show(anchor: AnchorRect, onClick: () => void): void;
  hide(): void;
}

export interface ResultRenderer {
  /**
   * Show the loading state. `word` is the reader's selected text, known the
   * instant they click Define — render it immediately as the headword so the
   * card never appears empty while waiting for the model's reply.
   */
  renderLoading(word?: string): void;
  renderResult(r: LookupResult): void;
  renderError(e: LookupError): void;
  close(): void;
}

export interface LookupClient {
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult>;
}

export interface SettingsStore {
  get(): Promise<PublicSettings>;
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void>;
}

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}
