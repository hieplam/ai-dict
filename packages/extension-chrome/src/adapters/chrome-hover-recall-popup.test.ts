import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('show() positions the element via the anchor rect', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    const showSpy = vi.spyOn(
      adapter.element as unknown as { show: (a: unknown, v: unknown) => void },
      'show',
    );
    adapter.show({ x: 10, y: 20, w: 5, h: 8 }, { word: 'bank', preview: 'p' });
    expect(showSpy).toHaveBeenCalledWith(
      { x: 10, y: 20, w: 5, h: 8 },
      { word: 'bank', preview: 'p' },
    );
  });

  it('repeated show() calls reuse the same element (no duplicate nodes)', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.show({ x: 1, y: 1, w: 0, h: 0 }, { word: 'b', preview: 'p' });
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('hide() does not remove the element (persistent singleton, unlike ChromeFloatingTrigger)', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.show({ x: 0, y: 0, w: 0, h: 0 }, { word: 'a', preview: 'p' });
    adapter.hide();
    expect(host.querySelectorAll('hover-recall-popup')).toHaveLength(1);
  });

  it('theme setter stamps data-ad-theme on the element', () => {
    const adapter = new ChromeHoverRecallPopup(host);
    adapter.theme = 'dark';
    expect(adapter.element.getAttribute('data-ad-theme')).toBe('dark');
  });
});
