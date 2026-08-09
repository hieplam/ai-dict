import { describe, it, expect, beforeAll } from 'vitest';
import { registerContentElements } from '../../src/ui/register';
import { renderGlossState, type LookupGloss } from '../../src/ui/lookup-gloss';
import type { SafeHtml } from '../../src/ui/index';

beforeAll(() => registerContentElements());

function mount(): LookupGloss {
  const el = document.createElement('lookup-gloss') as LookupGloss;
  document.body.append(el);
  return el;
}

describe('renderGlossState (pure)', () => {
  it('loading state returns the headword + a spinner, no gloss-text', () => {
    const nodes = renderGlossState({ kind: 'loading', word: 'bank' });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('bank');
    expect(nodes.some((n) => (n as Element).classList?.contains('gloss-spinner'))).toBe(true);
    expect(nodes.some((n) => (n as Element).classList?.contains('gloss-text'))).toBe(false);
  });
  it('loading state with no word renders an ellipsis placeholder headword', () => {
    const nodes = renderGlossState({ kind: 'loading' });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('…');
  });
  it('result state returns the headword + the safeHtml written verbatim (no re-sanitization)', () => {
    const nodes = renderGlossState({
      kind: 'result',
      word: 'bank',
      safeHtml: '<p>ngân hàng</p>' as SafeHtml,
    });
    const strong = nodes.find((n) => (n as Element).tagName === 'STRONG') as Element;
    expect(strong.textContent).toBe('bank');
    const text = nodes.find((n) => (n as Element).classList?.contains('gloss-text')) as Element;
    expect(text.innerHTML).toBe('<p>ngân hàng</p>');
  });
  it('a hostile safeHtml is written via innerHTML but renders inert (defense-in-depth; real trust boundary is sanitizeMarkdown)', () => {
    const nodes = renderGlossState({
      kind: 'result',
      word: 'bank',
      safeHtml: '<img src=x onerror="window.__pwn=1">' as SafeHtml,
    });
    document.body.append(...nodes);
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    nodes.forEach((n) => n.parentNode?.removeChild(n));
  });
});

describe('<lookup-gloss>', () => {
  it('clicking the shadow button dispatches a composed "expand" event audible on document', () => {
    const el = mount();
    let fired = 0;
    document.addEventListener('expand', () => fired++);
    el.shadowRoot!.querySelector('button')!.click();
    expect(fired).toBe(1);
    document.body.removeChild(el);
  });
});
