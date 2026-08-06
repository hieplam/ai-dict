import { describe, it, expect, beforeEach } from 'vitest';
import { HoverRecallPopup } from '../../src/ui/hover-recall-popup';

if (!customElements.get('hover-recall-popup')) {
  customElements.define('hover-recall-popup', HoverRecallPopup);
}

function mount(): HoverRecallPopup {
  const el = document.createElement('hover-recall-popup') as HoverRecallPopup;
  document.body.appendChild(el);
  return el;
}

describe('<hover-recall-popup>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // The element is DRIVEN cross-world by attributes (see the module header): the adapter sets
  // `word`/`preview`/`open`; the element renders text from them. These tests assert that contract.
  it('renders the `word` and `preview` attributes as plain text', () => {
    const el = mount();
    el.setAttribute('word', 'bank');
    el.setAttribute('preview', 'ngân hàng');
    const root = el.shadowRoot!;
    expect(root.querySelector('.word')!.textContent).toBe('bank');
    expect(root.querySelector('.preview')!.textContent).toBe('ngân hàng');
  });

  it('is not open until the `open` attribute is set (visibility is attribute-driven, not [hidden])', () => {
    const el = mount();
    expect(el.hasAttribute('open')).toBe(false);
    el.setAttribute('open', '');
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('never injects HTML — a preview containing markup renders as literal text', () => {
    const el = mount();
    el.setAttribute('word', 'bank');
    el.setAttribute('preview', '<img src=x onerror=alert(1)>');
    const preview = el.shadowRoot!.querySelector('.preview')!;
    expect(preview.innerHTML).not.toContain('<img');
    expect(preview.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('clicking "View full entry" dispatches a composed view-full-entry event with the current word attribute', () => {
    const el = mount();
    el.setAttribute('word', 'bank');
    let captured: { word: string } | undefined;
    document.addEventListener('view-full-entry', (e) => {
      captured = (e as CustomEvent<{ word: string }>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.view-link')!.click();
    expect(captured).toEqual({ word: 'bank' });
  });

  it('registers idempotently alongside registerContentElements (double-define is a no-op)', async () => {
    const { registerContentElements } = await import('../../src/ui/register');
    expect(() => {
      registerContentElements();
      registerContentElements();
    }).not.toThrow();
  });
});
