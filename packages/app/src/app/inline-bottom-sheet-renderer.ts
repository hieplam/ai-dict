import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  Provider,
  Theme,
  SavedWordStatus,
} from '../index';
import { renderCardState, type CardState, type LookupCard, type SafeHtml } from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;
  private _theme: Theme = 'sepia';
  // Set on every renderResult from the render context; the card's one `switch-provider`
  // listener (attached in ensureCard) reads whatever the latest result installed.
  private onSwitch: ((p: Provider) => void) | undefined;
  // A8: same pattern for the card's one `force-literal` listener.
  private onForceLiteral: (() => void) | undefined;
  // B1: the last CardState rendered, so setSaved() can re-emit it with the flag flipped without
  // a full re-lookup. null before any render, or after close().
  private lastState: CardState | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
    private readonly opts: { sidePanel?: boolean } = {},
  ) {}

  /**
   * The reader's stored theme preference, stamped as the `data-ad-theme` ATTRIBUTE on both the
   * card and its bottom-sheet host — an attribute (shared DOM) crosses the MAIN/isolated world
   * boundary, a JS property write would not (see setState below). The sheet is stamped too so
   * its --ad-scrim resolves to the same theme. Set by the composition root from settings.
   */
  set theme(t: Theme) {
    this._theme = t;
    this.card?.setAttribute('data-ad-theme', t);
    this.sheet?.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet');
    const card = document.createElement('lookup-card') as LookupCard;
    card.setAttribute('data-ad-theme', this._theme);
    // Chrome opts in to the "Open in side panel" affordance; the shared card reads this attribute
    // in connectedCallback (shared DOM, so it crosses the MV3 world boundary and is set before the
    // element upgrades — same mechanism as data-ad-theme above). Safari leaves it off.
    if (this.opts.sidePanel) card.setAttribute('side-panel', '');
    sheet.setAttribute('data-ad-theme', this._theme);
    sheet.append(card);
    sheet.addEventListener('dismiss', () => this.close());
    card.addEventListener('close', () => this.close());
    // One-shot provider picker: the card fires `switch-provider` when the reader picks a
    // provider; delegate to the handler the workflow installed via the render context.
    card.addEventListener('switch-provider', (e) =>
      this.onSwitch?.((e as CustomEvent<{ provider: Provider }>).detail.provider),
    );
    // One-shot idiom-literal override (A8): the card fires `force-literal` when the reader taps
    // "Show literal word"; delegate to the handler the workflow installed via the render context.
    card.addEventListener('force-literal', () => this.onForceLiteral?.());
    this.host.append(sheet); // connection upgrades both elements + builds their shadow roots
    this.sheet = sheet;
    this.card = card;
    return card;
  }

  private setState(state: CardState): void {
    // Write the card's content straight into its LIGHT DOM (projected via the card's <slot>),
    // NOT via the `.state` property. This renderer runs in a Chrome MV3 content-script
    // isolated world; the LookupCard class lives in the page's MAIN world, so a JS property
    // write (`card.state = …`) never reaches it (Chromium 390807) and the card would stay
    // stuck on "Looking up…". Shared-DOM mutations like replaceChildren do cross the boundary.
    this.lastState = state;
    this.ensureCard().replaceChildren(...renderCardState(state));
  }

  renderLoading(word?: string): void {
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }

  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      saved: ctx?.saved === true,
      // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
      // always explicit true/false, same style as `saved` above.
      nudge: r.nudge === true,
    });
  }

  renderError(e: LookupError): void {
    this.setState({ kind: 'error', error: e });
  }

  /**
   * Append an extra light-DOM node (e.g. the error-reporting consent footer) into the
   * currently-shown card. Returns false if no card is open. Uses append (shared-DOM)
   * so it crosses the MV3 MAIN/isolated-world boundary like the card's other content.
   */
  appendToCard(node: Node): boolean {
    if (!this.card) return false;
    this.card.append(node);
    return true;
  }

  /**
   * B1: flip the star's local optimistic state on the currently-shown result without a full
   * re-lookup. No-op when the last rendered state isn't a result (e.g. loading/error) or no card
   * has been rendered yet — mirrors the guard pattern `appendToCard` already uses.
   */
  setSaved(saved: boolean): void {
    if (this.lastState?.kind !== 'result') return;
    // B7: any save toggle (star OR the nudge banner's own Save button — both dispatch the same
    // toggle-save event) also clears the nudge banner; the reader has acted on the signal.
    // B5: unsaving also clears any stale `status` — the isSaved gate already hides the toggle,
    // but clearing avoids a stale value if the state object is inspected directly (spec §3.5).
    // `exactOptionalPropertyTypes` forbids assigning `status: undefined` directly, so the key is
    // omitted (not set to undefined) when unsaving.
    const { status: _status, ...rest } = this.lastState;
    this.setState({
      ...rest,
      saved,
      nudge: false,
      ...(saved && _status !== undefined ? { status: _status } : {}),
    });
  }

  /**
   * B5: flip the status toggle's local state on the currently-shown result without a full
   * re-lookup. No-op when the last rendered state isn't a result (e.g. loading/error) or no card
   * has been rendered yet — mirrors the guard pattern `setSaved` already uses.
   */
  setStatus(status: SavedWordStatus): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, status });
  }

  /**
   * B7: hide the nudge banner on the currently-shown result without touching `saved`. The
   * backend already permanently marked this word as nudged before this reply was ever sent
   * (domain/nudge-policy.ts), so dismissal needs no wire round-trip — a pure local re-render,
   * mirroring the guard pattern `setSaved`/`appendToCard` already use.
   */
  dismissNudge(): void {
    if (this.lastState?.kind !== 'result') return;
    this.setState({ ...this.lastState, nudge: false });
  }

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
    this.lastState = null;
  }
}
