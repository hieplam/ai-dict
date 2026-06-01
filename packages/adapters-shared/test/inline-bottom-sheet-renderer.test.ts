import { describe, it, expect, afterEach } from 'vitest';
import { InlineBottomSheetRenderer } from '../src/inline-bottom-sheet-renderer';
import type { LookupResult, LookupError } from '@ai-dict/core';
import type { SafeHtml } from '@ai-dict/shared-ui/lookup-card';

const result: LookupResult = { markdown: '**def** <script>alert(1)</script>', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
const error: LookupError = { code: 'NETWORK', message: 'Network failed.', retryable: true };

function host(): HTMLElement { const h = document.createElement('div'); document.body.append(h); return h; }
function card(host: HTMLElement): HTMLElement {
  return host.querySelector('bottom-sheet > lookup-card') as HTMLElement;
}

describe('InlineBottomSheetRenderer', () => {
  // Clear accumulated host <div>s between tests so DOM state does not leak.
  afterEach(() => { document.body.replaceChildren(); });

  // These assertions deliberately read the card's LIGHT DOM, not a `.state` property.
  // The renderer runs in a content-script isolated world where the card's `.state`
  // setter is unreachable (the class lives in the page MAIN world); driving the card
  // over the shared DOM is the whole point of the fix, so the tests verify that path.
  it('renderLoading mounts a bottom-sheet + lookup-card showing the loading text', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderLoading();
    const c = card(h);
    expect(c).not.toBeNull();
    expect(c.textContent).toContain('Looking up');
  });

  it('renderResult feeds SANITIZED html (no <script>) into the card light DOM', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    const c = card(h);
    expect(c.querySelector('h2')!.textContent).toBe('bank');
    expect(c.innerHTML).toContain('<strong>def</strong>');
    expect(c.innerHTML).not.toContain('<script');
  });

  it('renderError shows the error message in the card light DOM', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderError(error);
    expect(card(h).querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('uses an injected sanitizer when provided (DI seam)', () => {
    const h = host();
    // Cast the literal to SafeHtml — this stub stands in for the real sanitizer in tests;
    // only the real sanitizeMarkdown (DOMPurify output) is the authorised trust boundary (S4).
    const r = new InlineBottomSheetRenderer(h, (md) => (`SAFE:${md}`) as SafeHtml);
    r.renderResult(result);
    expect(card(h).innerHTML).toContain(`SAFE:${result.markdown}`);
  });

  it('close() before any render is a no-op', () => {
    const h = host();
    expect(() => new InlineBottomSheetRenderer(h).close()).not.toThrow();
  });

  it('reuses a single sheet across state transitions', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading(); r.renderResult(result); r.renderError(error);
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
  });

  it('close removes the sheet from the host', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading(); r.close();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('a bottom-sheet "dismiss" event tears the sheet down', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    h.querySelector('bottom-sheet')!.dispatchEvent(new CustomEvent('dismiss', { bubbles: true }));
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('a lookup-card "close" event tears the sheet down', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    card(h).dispatchEvent(new CustomEvent('close', { bubbles: true }));
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
