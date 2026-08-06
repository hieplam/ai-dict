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

  it('is hidden until show() is called', () => {
    const el = mount();
    expect(el.hidden).toBe(true);
  });

  it('show() sets the headword and preview as plain text and un-hides', () => {
    const el = mount();
    el.show({ x: 10, y: 20, w: 30, h: 12 }, { word: 'bank', preview: 'ngân hàng' });
    expect(el.hidden).toBe(false);
    const root = el.shadowRoot!;
    expect(root.querySelector('.word')!.textContent).toBe('bank');
    expect(root.querySelector('.preview')!.textContent).toBe('ngân hàng');
  });

  it('never injects HTML — a preview containing markup renders as literal text', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: '<img src=x onerror=alert(1)>' });
    const preview = el.shadowRoot!.querySelector('.preview')!;
    expect(preview.innerHTML).not.toContain('<img');
    expect(preview.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('hide() re-hides the element', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: 'p' });
    el.hide();
    expect(el.hidden).toBe(true);
  });

  it('clicking "View full entry" dispatches a composed view-full-entry event with the word', () => {
    const el = mount();
    el.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'bank', preview: 'p' });
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
