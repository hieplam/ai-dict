import { describe, it, expect, beforeEach } from 'vitest';
import { registerContentElements } from '@ai-dict/app';
import { ChromeHoverRecallPopup } from './chrome-hover-recall-popup';

registerContentElements();

describe('ChromeHoverRecallPopup', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('creates exactly one <hover-recall-popup> element on construction', () => {
    new ChromeHoverRecallPopup(host);
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('show() drives the element via cross-world-safe attributes (word/preview/open) + inline position', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 10, y: 20, w: 5, h: 8 }, { word: 'bank', preview: 'ngân hàng' });
    const el = adapter.element;
    expect(el.getAttribute('word')).toBe('bank');
    expect(el.getAttribute('preview')).toBe('ngân hàng');
    expect(el.hasAttribute('open')).toBe(true);
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('28px'); // anchor.y + anchor.h (happy-dom rect is zero → no clamp)
  });

  it('repeated show() calls reuse the same element (no duplicate nodes), refreshing its content', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.show({ x: 1, y: 1, w: 0, h: 0 }, { word: 'b', preview: 'q' });
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
    expect(adapter.element.getAttribute('word')).toBe('b');
    expect(adapter.element.getAttribute('preview')).toBe('q');
  });

  it('hide() removes the `open` attribute but keeps the element (persistent singleton)', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.hide();
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
    expect(adapter.element.hasAttribute('open')).toBe(false);
  });

  it('theme setter stamps data-ad-theme on the element', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.theme = 'dark';
    expect(adapter.element.getAttribute('data-ad-theme')).toBe('dark');
  });
});
