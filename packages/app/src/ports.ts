import type {
  AnchorRect,
  SelectionEvent,
  LookupRequest,
  LookupResult,
  LookupError,
  PublicSettings,
  Provider,
  RefineKind,
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
   * A12: the effective source-language code (bare BCP-47 subtag, e.g. 'fr') used for this
   * result — from auto-detection or a manual override. Absent means "could not be determined"
   * (the auto-phrase fallback was used). Always present on the ctx object when set (unlike
   * `providers`, which is conditional on >=2 configured); the card's Source row shows
   * "Auto-detect" when this is absent.
   */
  sourceLang?: string;
  /**
   * A12: re-run the SAME selection once with a manually picked source language (or 'auto' to
   * reset detection). Always present — unlike onSwitchProvider/onForceLiteral, this control is
   * offered unconditionally on every result.
   */
  onOverrideSourceLang?: (code: string) => void;
  /**
   * A3: re-run the SAME selection once with the given refinement. Always present on a
   * completed result (refine chips are always offered — no gating, unlike the picker/
   * force-literal controls).
   */
  onRefine?: (kind: RefineKind) => void;
  /**
   * A3: set only when THIS result came from a refine re-run (mirrors the shape of
   * `onForceLiteral`'s own gating). Undefined = this is the original, unrefined result. Read by
   * InlineBottomSheetRenderer (to decide whether to snapshot originalState) and by content.ts
   * (to decide whether to snapshot lastOriginalSavePayload — see the design spec's §2.5).
   */
  refine?: RefineKind;
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
  /**
   * A2: pop the current recursive-lookup frame and re-render its parent (the previous result in
   * the chain) — a pure local re-render, no network call. Present only when a parent frame
   * exists (this result was reached via an in-definition selection); absent at the root of a
   * chain. Installed by `runLookupWorkflow`; consumed by the in-page card only — the side panel
   * mirror never receives it (`side-panel.ts`'s `resultToFocus` takes no `ResultRenderContext`
   * at all, matching how the provider picker and A8's "Show literal word" are also
   * in-page-card-only, never mirrored to the panel).
   */
  onBack?: () => void;
}

export interface ResultRenderer {
  /**
   * Show the loading state. `word` is the reader's selected text, known the
   * instant they click Define — render it immediately as the headword so the
   * card never appears empty while waiting for the model's reply.
   * `anchor` (A6): the selection's viewport rect, when known. Implementations that render as a
   * page overlay (InlineBottomSheetRenderer) use it to place the card near the selection
   * without covering it — see the design spec's §2. Renderers with no on-page position concept
   * (the side-panel mirror) ignore the extra parameter; TypeScript permits an implementer to
   * declare fewer parameters than the interface.
   */
  renderLoading(word?: string, anchor?: AnchorRect): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  /**
   * A1: an optional in-progress preview, called zero or more times between renderLoading and the
   * terminal renderResult/renderError. Optional — mirrors ResultRenderContext's own
   * onSwitchProvider/onForceLiteral precedent (both optional, lines 30/35 above) — so an
   * implementer that never streams (or a test fake) needs no change to keep compiling.
   */
  renderPartial?(
    word: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void;
  close(): void;
}

export interface LookupClient {
  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      /**
       * A1: called zero or more times with the accumulated, already-stripped-of-signal-lines
       * markdown as a Gemini answer streams in. Only GeminiLookupClient ever invokes this
       * (gemini-lookup-client.ts) — OpenAI/Anthropic clients never call it, which IS how "provider
       * can't stream, falls back silently" is implemented (design spec §3): no capability probe,
       * just whether the concrete client class ever calls the callback it was handed.
       */
      onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult>;
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
