import type { ResultRenderer, LookupResult, LookupError } from '@ai-dict/core';
import type { CardState, LookupCard, SafeHtml } from '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import '@ai-dict/shared-ui/lookup-card';
import { sanitizeMarkdown } from './markdown-sanitize';

export class InlineBottomSheetRenderer implements ResultRenderer {
  private sheet: HTMLElement | null = null;
  private card: LookupCard | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => string = sanitizeMarkdown,
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

  private setState(state: CardState): void { this.ensureCard().state = state; }

  renderLoading(): void { this.setState({ kind: 'loading' }); }

  renderResult(r: LookupResult): void {
    // `CardState.safeHtml` is the branded `SafeHtml` type from shared-ui (Bundle 03): the cast here is
    // the single authorised trust boundary — DOMPurify output (S4) is, by definition, safe HTML.
    this.setState({ kind: 'result', safeHtml: this.sanitize(r.markdown) as SafeHtml, word: r.word, target: r.target });
  }

  renderError(e: LookupError): void { this.setState({ kind: 'error', error: e }); }

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
  }
}
