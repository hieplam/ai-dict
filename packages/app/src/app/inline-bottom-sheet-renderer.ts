import type { ResultRenderer, LookupResult, LookupError, Theme } from '../index';
import { renderCardState, type CardState, type LookupCard, type SafeHtml } from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;
  private _theme: Theme = 'sepia';

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
    this.ensureCard().replaceChildren(...renderCardState(state));
  }

  renderLoading(word?: string): void {
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }

  renderResult(r: LookupResult): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
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

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
  }
}
