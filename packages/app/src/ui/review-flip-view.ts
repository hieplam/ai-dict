import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG, ICON_CLOSE } from './styles/tokens';
import type { SafeHtml } from './lookup-card';

/**
 * B11: one card's worth of pre-fetched, pre-sanitized review content. The composition root
 * (side-panel.ts) builds this array once per review session — `safeHtml` MUST already be the
 * output of sanitizeMarkdown (S4); this component never sanitizes, mirroring how CardState.
 * safeHtml arrives pre-sanitized from side-panel.ts's resultToFocus.
 */
export interface ReviewCard {
  word: string;
  sentence: string;
  safeHtml: SafeHtml;
  translation: string;
}

const CSS = `:host{${BASE_VARS};display:flex;flex-direction:column;height:100dvh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.accent{height:3px;flex:none;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;padding:13px 18px 11px;flex:none}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:22px;height:22px;flex:none}
.close{display:inline-grid;place-items:center;width:var(--adp-action-size);height:var(--adp-action-size);margin-left:auto;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.close:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
.close:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.close svg{width:14px;height:14px;pointer-events:none}
main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 18px;display:flex;flex-direction:column}
.progress{margin:2px 0 14px;flex:none;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-bold);letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
.card{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:14px;padding-bottom:24px}
.card h2{font-family:var(--adp-font-serif);font-size:1.7rem;line-height:var(--adp-leading-tight);letter-spacing:var(--adp-tracking-head);margin:0;color:var(--ad-ink)}
.sentence{margin:0;font-size:15px;line-height:1.6;color:var(--ad-ink-soft)}
.meaning{margin:0;font-size:15px;line-height:1.6;color:var(--ad-ink)}
.meaning p{margin:.5em 0}
.translation{margin:0;font-size:14px;line-height:1.5;color:var(--ad-ink-soft);font-style:italic}
.actions{display:flex;gap:8px;margin-top:4px;flex:none}
button.primary{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;flex:1 1 auto;padding:11px 16px;border-radius:11px;cursor:pointer;border:1px solid transparent;background:var(--ad-accent);color:var(--ad-on-accent)}
button.primary:hover{filter:brightness(1.06)}
button.primary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button.secondary{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;flex:1 1 auto;padding:11px 16px;border-radius:11px;cursor:pointer;border:1px solid var(--ad-line-strong);background:var(--ad-surface);color:var(--ad-ink)}
button.secondary:hover{background:var(--ad-surface-raised)}
button.secondary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.empty,.done{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:40px 12px}
.empty .mark,.done .mark{width:34px;height:34px;opacity:.9}
.empty-title,.done-title{margin:0;font-size:var(--adp-text-lg);font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.empty-hint,.done-hint{margin:0;max-width:30ch;font-size:var(--adp-text-sm);line-height:1.55;color:var(--ad-ink-soft)}
.empty .secondary,.done .secondary{margin-top:8px;flex:none;padding:10px 20px}
@media (prefers-reduced-motion:reduce){.close{transition:none}}
[hidden]{display:none}`;

export class ReviewFlipView extends HTMLElement {
  private root!: ShadowRoot;
  private mainEl!: HTMLElement;
  private _deck: ReviewCard[] = [];
  private _index = 0;
  private _revealed = false;

  connectedCallback(): void {
    if (this.shadowRoot) {
      this.render();
      return;
    }
    this.root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.root, CSS);

    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    const header = document.createElement('header');
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>Review</span>`; // s4: static-template — fixed brand mark + literal label, no model content
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', 'Close review and return to the panel');
    close.innerHTML = ICON_CLOSE; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
    close.addEventListener('click', () => this.emitClose());
    header.append(brand, close);

    this.mainEl = document.createElement('main');
    this.mainEl.setAttribute('aria-live', 'polite');
    this.mainEl.setAttribute('aria-label', 'Review');

    this.root.append(accent, header, this.mainEl);
    this.render();
  }

  /** The shuffled deck for this review session. Setting it always restarts at card 1,
   * unrevealed — there is no cross-session or mid-session resume position (roadmap B11's
   * permanent "no scheduling, no due dates" fence). */
  set deck(cards: ReviewCard[]) {
    this._deck = cards;
    this._index = 0;
    this._revealed = false;
    if (this.shadowRoot) this.render();
  }
  get deck(): ReviewCard[] {
    return this._deck;
  }

  private emitClose(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private emitMarkKnown(word: string): void {
    this.dispatchEvent(
      new CustomEvent('mark-known', { detail: { word }, bubbles: true, composed: true }),
    );
  }

  private advance(): void {
    this._index += 1;
    this._revealed = false;
    this.render();
  }

  private render(): void {
    if (this._deck.length === 0) {
      this.mainEl.replaceChildren(this.renderEmpty());
      return;
    }
    if (this._index >= this._deck.length) {
      this.mainEl.replaceChildren(this.renderDone());
      return;
    }
    const progress = document.createElement('p');
    progress.className = 'progress';
    progress.textContent = `Card ${this._index + 1} of ${this._deck.length}`;
    this.mainEl.replaceChildren(progress, this.renderCard(this._deck[this._index]!));
  }

  private renderCard(card: ReviewCard): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'card';
    const h = document.createElement('h2');
    h.textContent = card.word;
    // Plain text — this is the reader's own captured page sentence (extractSentence), never LLM
    // output, so no sanitizeMarkdown call applies here (design spec §2.8).
    const sentence = document.createElement('p');
    sentence.className = 'sentence';
    sentence.textContent = card.sentence;
    wrap.append(h, sentence);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (!this._revealed) {
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'primary';
      reveal.textContent = 'Reveal meaning';
      reveal.addEventListener('click', () => {
        this._revealed = true;
        this.render();
      });
      actions.append(reveal);
      wrap.append(actions);
      return wrap;
    }

    const meaning = document.createElement('div');
    meaning.className = 'meaning';
    meaning.innerHTML = card.safeHtml; // trusted: pre-sanitized by side-panel.ts (S4)
    wrap.append(meaning);
    if (card.translation) {
      const t = document.createElement('p');
      t.className = 'translation';
      t.textContent = card.translation;
      wrap.append(t);
    }

    const markKnown = document.createElement('button');
    markKnown.type = 'button';
    markKnown.className = 'secondary';
    markKnown.textContent = 'Mark known';
    markKnown.setAttribute('aria-label', `Mark ${card.word} as known`);
    markKnown.addEventListener('click', () => {
      this.emitMarkKnown(card.word);
      this.advance();
    });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'primary';
    next.textContent = 'Next';
    next.setAttribute('aria-label', 'Next card');
    next.addEventListener('click', () => this.advance());
    actions.append(markKnown, next);
    wrap.append(actions);
    return wrap;
  }

  private renderEmpty(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'empty';
    // s4: static-template — fixed brand mark + literal copy, no model content
    wrap.innerHTML =
      BRAND_MARK_SVG +
      '<p class="empty-title">Nothing to review yet</p>' +
      '<p class="empty-hint">Words you save show up here for 14 days while you’re still learning them.</p>';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'secondary';
    back.textContent = 'Back to panel';
    back.addEventListener('click', () => this.emitClose());
    wrap.append(back);
    return wrap;
  }

  private renderDone(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'done';
    const count = this._deck.length;
    // s4: static-template — fixed brand mark + literal copy, count is a local number (no model content)
    wrap.innerHTML =
      BRAND_MARK_SVG +
      '<p class="done-title">Nice work</p>' +
      `<p class="done-hint">You reviewed ${count} word${count === 1 ? '' : 's'}.</p>`;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'secondary';
    back.textContent = 'Back to panel';
    back.addEventListener('click', () => this.emitClose());
    wrap.append(back);
    return wrap;
  }
}
