import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { ReviewFlipView, type ReviewCard } from '../../src/ui/review-flip-view';
import { registerReviewFlip } from '../../src/ui/register';
import type { SafeHtml } from '../../src/ui/lookup-card';

beforeAll(() => {
  registerReviewFlip();
});

const safe = (html: string) => html as SafeHtml;

function mount(): ReviewFlipView {
  const el = document.createElement('review-flip-view') as ReviewFlipView;
  document.body.append(el);
  return el;
}

function card(word: string): ReviewCard {
  return {
    word,
    sentence: `A sentence with ${word} in it.`,
    safeHtml: safe(`<p>Meaning of ${word}.</p>`),
    translation: `${word} (translated)`,
  };
}

describe('<review-flip-view>', () => {
  it('shows the empty state when the deck is empty', () => {
    const el = mount();
    el.deck = [];
    expect(el.shadowRoot!.textContent).toContain('Nothing to review yet');
  });

  it('shows the first card front (word + sentence) with no meaning/translation visible', () => {
    const el = mount();
    el.deck = [card('bank')];
    const r = el.shadowRoot!;
    expect(r.textContent).toContain('Card 1 of 1');
    expect(r.querySelector('h2')!.textContent).toBe('bank');
    expect(r.textContent).toContain('A sentence with bank in it.');
    expect(r.textContent).not.toContain('Meaning of bank');
    expect(r.querySelector('.meaning')).toBeNull();
  });

  it('reveal shows the sanitized meaning + translation and swaps in Mark known / Next', () => {
    const el = mount();
    el.deck = [card('bank')];
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click();
    expect(r.querySelector('.meaning')!.innerHTML).toContain('Meaning of bank.');
    expect(r.textContent).toContain('bank (translated)');
    expect(r.querySelector('[aria-label="Mark bank as known"]')).not.toBeNull();
    expect(r.querySelector('[aria-label="Next card"]')).not.toBeNull();
  });

  it('omits the translation line when translation is empty', () => {
    const el = mount();
    el.deck = [{ ...card('bank'), translation: '' }];
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click();
    expect(r.querySelector('.translation')).toBeNull();
  });

  it('clicking Mark known fires a composed mark-known event and advances', () => {
    const el = mount();
    el.deck = [card('bank')];
    let captured: { word: string } | undefined;
    document.body.addEventListener('mark-known', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click();
    r.querySelector<HTMLButtonElement>('[aria-label="Mark bank as known"]')!.click();
    expect(captured).toEqual({ word: 'bank' });
    expect(r.textContent).toContain('Nice work');
    expect(r.textContent).toContain('You reviewed 1 word.');
  });

  it('clicking Next advances without emitting mark-known', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    let fired = false;
    document.body.addEventListener('mark-known', () => (fired = true));
    const r = el.shadowRoot!;
    r.querySelector<HTMLButtonElement>('.primary')!.click();
    r.querySelector<HTMLButtonElement>('[aria-label="Next card"]')!.click();
    expect(fired).toBe(false);
    expect(r.textContent).toContain('Card 2 of 2');
    expect(r.querySelector('h2')!.textContent).toBe('b');
  });

  it('reaching the end of the deck shows the done state with the plural count', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    const r = el.shadowRoot!;
    for (let i = 0; i < 2; i++) {
      r.querySelector<HTMLButtonElement>('.primary')!.click();
      r.querySelector<HTMLButtonElement>('[aria-label="Next card"]')!.click();
    }
    expect(r.textContent).toContain('You reviewed 2 words.');
  });

  it('the header close button dispatches a composed close event from every state', () => {
    const emptyEl = mount();
    emptyEl.deck = [];
    let emptyClosed = false;
    document.body.addEventListener('close', () => (emptyClosed = true));
    emptyEl.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    expect(emptyClosed).toBe(true);

    const cardEl = mount();
    cardEl.deck = [card('bank')];
    let cardClosed = false;
    document.body.addEventListener('close', () => (cardClosed = true));
    cardEl.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    expect(cardClosed).toBe(true);
  });

  it('setting a new deck always restarts at card 1, unrevealed, even mid-session', () => {
    const el = mount();
    el.deck = [card('a'), card('b')];
    el.shadowRoot!.querySelector<HTMLButtonElement>('.primary')!.click();
    el.deck = [card('c')];
    const r = el.shadowRoot!;
    expect(r.textContent).toContain('Card 1 of 1');
    expect(r.querySelector('h2')!.textContent).toBe('c');
    expect(r.querySelector('.meaning')).toBeNull();
  });

  it('has no axe violations on the front-of-card state', async () => {
    const el = mount();
    el.deck = [card('bank')];
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations on the empty state', async () => {
    const el = mount();
    el.deck = [];
    expect(await axeViolations(el)).toEqual([]);
  });
});
