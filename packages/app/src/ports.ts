import type {
  AnchorRect,
  SelectionEvent,
  LookupRequest,
  LookupResult,
  LookupError,
  PublicSettings,
  Provider,
} from './domain/types';
import type { ErrorRecord } from './domain/error-report';

export interface SelectionSource {
  onSelection(cb: (e: SelectionEvent) => void): () => void;
}

export interface TriggerUI {
  show(anchor: AnchorRect, onClick: () => void): void;
  hide(): void;
}

/**
 * Optional context handed to `renderResult` so the card can offer a one-shot
 * provider picker and/or a one-shot "force literal" re-run. Omitted entirely when
 * neither applies (fewer than two providers configured AND the result isn't an idiom).
 */
export interface ResultRenderContext {
  /** Providers the reader may switch to (>=2 entries when present). */
  providers?: Provider[];
  /** Re-run the SAME lookup once with this provider; does not persist the choice. */
  onSwitchProvider?: (p: Provider) => void;
  /**
   * A8: re-run the SAME selection once, forcing the literal single-word reading. Present only
   * when the result just rendered is an idiom (`result.definedAs?.isIdiom === true`).
   */
  onForceLiteral?: () => void;
  /**
   * B1: the sentence/page url/page title captured at lookup time — the only place
   * `SelectionEvent` and `LookupResult` are both in scope simultaneously is
   * `runLookupWorkflow`'s `runLookup`, so these ride along on every result so a later star tap
   * (which may happen well after the DOM selection is gone) can still persist them. Plain data,
   * not a callback — the composition root owns the actual `chrome.runtime.sendMessage` call.
   */
  sentence?: string;
  url?: string;
  title?: string;
  /** Whether this word is currently starred/saved — drives the star's filled/outline state. */
  saved?: boolean;
}

export interface ResultRenderer {
  /**
   * Show the loading state. `word` is the reader's selected text, known the
   * instant they click Define — render it immediately as the headword so the
   * card never appears empty while waiting for the model's reply.
   */
  renderLoading(word?: string): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  close(): void;
}

export interface LookupClient {
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult>;
}

export interface SettingsStore {
  get(): Promise<PublicSettings>;
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void>;
}

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/**
 * Outbound sink for anonymous error records. Implemented by a platform adapter
 * (GA4 over fetch in the Chrome shell). The core never imports fetch — the sink
 * is injected at the composition root (ref-dependency-injection).
 */
export interface TelemetrySink {
  send(records: ErrorRecord[]): Promise<void>;
}
