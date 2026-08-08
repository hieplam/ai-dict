import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { WordsPageView } from '../../src/ui/words-page-view';
import { registerSidePanel } from '../../src/ui/register';
import type { SavedWordEntry } from '../../src/domain/types';

beforeAll(() => {
  registerSidePanel();
});

function mount(): WordsPageView {
  const el = document.createElement('words-page-view') as WordsPageView;
  document.body.append(el);
  return el;
}

function entry(
  over: Partial<SavedWordEntry> & { word: string; senses?: SavedWordEntry['senses'] },
): SavedWordEntry {
  return {
    word: over.word,
    status: over.status ?? 'learning',
    savedAt: over.savedAt ?? 1_700_000_000_000,
    senses: over.senses ?? [
      {
        definition: `${over.word} definition`,
        translation: '',
        sentence: `a sentence with ${over.word}`,
        url: 'https://example.com/article',
        title: 'Example',
      },
    ],
  };
}

describe('<words-page-view>', () => {
  it('shows the "no saved words yet" empty state before any entries are set', () => {
    const el = mount();
    expect(el.shadowRoot!.textContent).toMatch(/no saved words yet/i);
  });

  it('renders one row per entry, newest-first by default, with word and first-sense sentence', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank', savedAt: 1 }), entry({ word: 'cat', savedAt: 2 })];
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('cat');
    expect(rows[0]!.textContent).toContain('a sentence with cat');
    expect(rows[1]!.textContent).toContain('bank');
  });

  it('shows a distinct empty state when filters match nothing', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'zzz-no-match';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.shadowRoot!.textContent).toMatch(/no words match/i);
  });

  it('search filters rows by word', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' }), entry({ word: 'cat' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ban';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('bank');
  });

  it('status filter shows only matching entries', () => {
    const el = mount();
    el.entries = [
      entry({ word: 'bank', status: 'known' }),
      entry({ word: 'cat', status: 'learning' }),
    ];
    const statusSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.status-filter')!;
    statusSel.value = 'known';
    statusSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('bank');
  });

  it('site filter <select> is populated from the current entries and filters rows', () => {
    const el = mount();
    el.entries = [
      entry({
        word: 'bank',
        senses: [
          { definition: 'd', translation: '', sentence: 's', url: 'https://a.com/x', title: 't' },
        ],
      }),
      entry({
        word: 'cat',
        senses: [
          { definition: 'd', translation: '', sentence: 's', url: 'https://b.com/y', title: 't' },
        ],
      }),
    ];
    const siteSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.site-filter')!;
    const optionValues = [...siteSel.options].map((o) => o.value);
    expect(optionValues).toEqual(['all', 'a.com', 'b.com']);
    siteSel.value = 'b.com';
    siteSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('cat');
  });

  it('sort <select> reorders rows (A–Z)', () => {
    const el = mount();
    el.entries = [entry({ word: 'zebra', savedAt: 2 }), entry({ word: 'apple', savedAt: 1 })];
    const sortSel = el.shadowRoot!.querySelector<HTMLSelectElement>('.sort')!;
    sortSel.value = 'alpha';
    sortSel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = el.shadowRoot!.querySelectorAll('.word-row');
    expect(rows[0]!.textContent).toContain('apple');
    expect(rows[1]!.textContent).toContain('zebra');
  });

  it('clicking the status button dispatches a composed toggle-status with the flipped status', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank', status: 'learning' })];
    let captured: { word: string; status: string } | undefined;
    document.body.addEventListener('toggle-status', (e) => {
      captured = (e as CustomEvent<{ word: string; status: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.status-btn')!.click();
    expect(captured).toEqual({ word: 'bank', status: 'known' });
  });

  it('clicking the delete button dispatches a composed delete-word event', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    let captured: { word: string } | undefined;
    document.body.addEventListener('delete-word', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.del-btn')!.click();
    expect(captured).toEqual({ word: 'bank' });
  });

  it('clicking Back dispatches a composed back event', () => {
    const el = mount();
    let fired = false;
    document.body.addEventListener('back', () => {
      fired = true;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.back')!.click();
    expect(fired).toBe(true);
  });

  it('the count line reflects filtered vs. total', () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' }), entry({ word: 'cat' })];
    const search = el.shadowRoot!.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ban';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.shadowRoot!.querySelector('.count')!.textContent).toBe('1 of 2');
  });

  it('has no detectable a11y violations with rows rendered', async () => {
    const el = mount();
    el.entries = [entry({ word: 'bank' })];
    const violations = await axeViolations(el);
    expect(violations).toEqual([]);
  });
});
