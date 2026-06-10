import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { SidePanelView } from '../../src/ui/side-panel-view';
import { registerSidePanel } from '../../src/ui/register';
import type { SafeHtml } from '../../src/ui/lookup-card';
import type { HistoryEntry } from '../../src/domain/types';

beforeAll(() => {
  registerSidePanel();
});

const safe = (html: string) => html as SafeHtml;

function mount(): SidePanelView {
  const el = document.createElement('side-panel-view') as SidePanelView;
  document.body.append(el);
  return el;
}

function entry(over: Partial<HistoryEntry> & { word: string; id: string }): HistoryEntry {
  return {
    id: over.id,
    word: over.word,
    context: over.context ?? `A sentence containing ${over.word}.`,
    createdAt: over.createdAt ?? 1_700_000_000_000,
    result: over.result ?? {
      markdown: `## ${over.word}\nMeaning of ${over.word}.`,
      word: over.word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1_700_000_000_000,
    },
  };
}

describe('<side-panel-view>', () => {
  it('opens on a teaching empty state, not a loading spinner', () => {
    const el = mount();
    // No fake "Looking up…" spinner before any lookup happens.
    expect(el.shadowRoot!.textContent).not.toContain('Looking up');
    // Teaches the interface instead of showing an empty box.
    expect(el.shadowRoot!.querySelector('.empty')).not.toBeNull();
    expect(el.shadowRoot!.textContent).toMatch(/select a word/i);
  });

  it('is the single cozy surface: no inner card framing (no radius/shadow on host)', () => {
    const el = mount();
    const sheet = el.shadowRoot!.adoptedStyleSheets[0]!;
    const hostRule = [...sheet.cssRules].map((r) => r.cssText).find((t) => t.startsWith(':host'))!;
    // The panel IS the surface; it must not re-frame itself as a floating card.
    expect(hostRule).not.toMatch(/border-radius/);
    expect(hostRule).not.toMatch(/box-shadow/);
  });

  it('carries the brand header and the privacy footer', () => {
    const el = mount();
    expect(el.shadowRoot!.querySelector('header')!.textContent).toContain('AI Dictionary');
    expect(el.shadowRoot!.querySelector('footer')!.textContent).toContain('Stays on your device');
  });

  it('the header offers a Settings action that emits a composed "open-settings" event', () => {
    const el = mount();
    const gear = el.shadowRoot!.querySelector<HTMLButtonElement>('header .settings')!;
    expect(gear).not.toBeNull();
    expect(gear.getAttribute('aria-label')).toBe('Settings');
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('open-settings', handler);
    gear.click();
    document.body.removeEventListener('open-settings', handler);
    expect(evt).not.toBeNull();
    // Same frozen event-name contract as the lookup card; side-panel.ts listens on the view.
    expect(evt!.composed).toBe(true);
  });

  it('renders a loading focus with the selected word as the headword', () => {
    const el = mount();
    el.focusState = { kind: 'loading', word: 'resilient' };
    const focus = el.shadowRoot!.querySelector('.focus')!;
    expect(focus.querySelector('h2')!.textContent).toBe('resilient');
    expect(focus.textContent).toContain('Looking up');
    expect(el.shadowRoot!.querySelector('.empty')).toBeNull();
  });

  it('renders a result focus with the headword and the pre-sanitized body', () => {
    const el = mount();
    el.focusState = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
    };
    const focus = el.shadowRoot!.querySelector('.focus')!;
    expect(focus.querySelector('h2')!.textContent).toBe('bank');
    expect(focus.innerHTML).toContain('money place');
  });

  it('renders an error focus', () => {
    const el = mount();
    el.focusState = {
      kind: 'error',
      error: { code: 'NETWORK', message: 'Network failed.', retryable: true },
    };
    expect(el.shadowRoot!.querySelector('.focus .err')!.textContent).toBe('Network failed.');
  });

  it('renders the no-key setup invite (not a red error) with an Open Settings action', () => {
    const el = mount();
    el.focusState = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false },
    };
    const focus = el.shadowRoot!.querySelector('.focus')!;
    // No generic ".err" red-failure text — this is onboarding, not a failure.
    expect(focus.querySelector('.err')).toBeNull();
    expect(focus.querySelector('.setup-title')!.textContent).toBe('Set up AI Dictionary');
    const cta = focus.querySelector<HTMLButtonElement>('.setup-cta')!;
    expect(cta.textContent).toBe('Open Settings');
  });

  it('"open-settings" from the setup invite crosses the shadow boundary (composed)', () => {
    const el = mount();
    el.focusState = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false },
    };
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('open-settings', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('.focus .setup-cta')!.click();
    document.body.removeEventListener('open-settings', handler);
    expect(evt).not.toBeNull();
    expect(evt!.composed).toBe(true);
  });

  it('announces focus changes via an aria-live region', () => {
    const el = mount();
    expect(el.shadowRoot!.querySelector('.focus')!.getAttribute('aria-live')).toBe('polite');
  });

  it('hides the Recent section entirely when there is no history', () => {
    const el = mount();
    el.recent = [];
    const recent = el.shadowRoot!.querySelector('.recent') as HTMLElement;
    expect(recent.hidden).toBe(true);
  });

  it('lists recent lookups newest-first as clickable rows', () => {
    const el = mount();
    el.recent = [entry({ id: 'a', word: 'bank' }), entry({ id: 'b', word: 'ledger' })];
    const recent = el.shadowRoot!.querySelector('.recent') as HTMLElement;
    expect(recent.hidden).toBe(false);
    const items = recent.querySelectorAll('button.recent-item');
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain('bank');
    expect(items[1]!.textContent).toContain('ledger');
  });

  it('emits a composed "select" event carrying the entry id when a recent row is clicked', () => {
    const el = mount();
    el.recent = [entry({ id: 'a', word: 'bank' }), entry({ id: 'b', word: 'ledger' })];
    let detail: { id: string } | null = null;
    document.body.addEventListener('select', (e) => {
      detail = (e as CustomEvent<{ id: string }>).detail;
    });
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.recent-item')[1]!.click();
    expect(detail).toEqual({ id: 'b' });
  });

  it('the recent list never uses the editorial serif (One Serif Rule: headword only)', () => {
    const el = mount();
    el.recent = [entry({ id: 'a', word: 'bank' })];
    const sheet = el.shadowRoot!.adoptedStyleSheets[0]!;
    const recentRule = [...sheet.cssRules]
      .map((r) => r.cssText)
      .find((t) => t.includes('.recent-item'))!;
    expect(recentRule).not.toMatch(/Georgia|serif/i);
  });

  it('does not re-initialize the shadow on reconnect', () => {
    const el = mount();
    document.body.removeChild(el);
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('.focus').length).toBe(1);
  });

  it('has no axe violations (empty state)', async () => {
    const el = mount();
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (result + recent)', async () => {
    const el = mount();
    el.focusState = { kind: 'result', word: 'sky', target: 'vi', safeHtml: safe('<p>the sky</p>') };
    el.recent = [entry({ id: 'a', word: 'sky' }), entry({ id: 'b', word: 'cloud' })];
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (no-key setup invite)', async () => {
    const el = mount();
    el.focusState = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false },
    };
    expect(await axeViolations(el)).toEqual([]);
  });
});
