import type { ResultRenderer, LookupResult, LookupError } from '../index';
import { renderCardState, type CardState, type LookupCard, type SafeHtml } from '../ui/index';
import { sanitizeMarkdown } from './markdown-sanitize';

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
  ) {}

  private ensureCard(): LookupCard {
    if (this.card && this.sheet) return this.card;
    const sheet = document.createElement('bottom-sheet');
    const card = document.createElement('lookup-card') as LookupCard;
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

  renderLoading(): void {
    this.setState({ kind: 'loading' });
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

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
  }
}
