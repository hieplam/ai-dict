import { describe, it, expect } from 'vitest';
import { InlineBottomSheetRenderer } from '../src/inline-bottom-sheet-renderer';
import type { LookupResult, LookupError } from '@ai-dict/core';

const result: LookupResult = { markdown: '**def** <script>alert(1)</script>', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
const error: LookupError = { code: 'NETWORK', message: 'Network failed.', retryable: true };

function host(): HTMLElement { const h = document.createElement('div'); document.body.append(h); return h; }
function card(host: HTMLElement): HTMLElement & { state: unknown } {
  return host.querySelector('bottom-sheet > lookup-card') as HTMLElement & { state: unknown };
}

describe('InlineBottomSheetRenderer', () => {
  it('renderLoading mounts a bottom-sheet + lookup-card in loading state', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderLoading();
    const c = card(h);
    expect(c).not.toBeNull();
    expect(c.state).toMatchObject({ kind: 'loading' });
  });

  it('renderResult feeds SANITIZED html (no <script>) to the card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    const c = card(h);
    expect((c.state as { kind: string; safeHtml: string; word: string }).kind).toBe('result');
    const html = (c.state as { safeHtml: string }).safeHtml;
    expect(html).toContain('<strong>def</strong>');
    expect(html).not.toContain('<script');
    expect(c.shadowRoot!.querySelector('h2')!.textContent).toBe('bank');
  });

  it('renderError sets the card error state', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderError(error);
    expect((card(h).state as { kind: string; error: LookupError }).error.code).toBe('NETWORK');
  });

  it('uses an injected sanitizer when provided (DI seam)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h, (md) => `SAFE:${md}`);
    r.renderResult(result);
    expect((card(h).state as { safeHtml: string }).safeHtml).toBe(`SAFE:${result.markdown}`);
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
