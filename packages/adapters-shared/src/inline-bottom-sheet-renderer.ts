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

  private setState(state: CardState): void { this.ensureCard().state = state; }

  renderLoading(): void { this.setState({ kind: 'loading' }); }

  renderResult(r: LookupResult): void {
    // `sanitize` already returns `SafeHtml` (the trust boundary lives in sanitizeMarkdown, S4).
    // No cast needed here — the DI param type `(md: string) => SafeHtml` guarantees it.
    this.setState({ kind: 'result', safeHtml: this.sanitize(r.markdown), word: r.word, target: r.target });
  }

  renderError(e: LookupError): void { this.setState({ kind: 'error', error: e }); }

  close(): void {
    this.sheet?.remove();
    this.sheet = null;
    this.card = null;
  }
}
