import { describe, it, expect, afterEach } from 'vitest';
import { InlineBottomSheetRenderer } from '../../src/app/inline-bottom-sheet-renderer';
import type { LookupResult, LookupError } from '../../src';
import type { SafeHtml } from '../../src/ui/index';

const result: LookupResult = {
  markdown: '**def** <script>alert(1)</script>',
  word: 'bank',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 1,
};
const error: LookupError = { code: 'NETWORK', message: 'Network failed.', retryable: true };

function host(): HTMLElement {
  const h = document.createElement('div');
  document.body.append(h);
  return h;
}
function card(host: HTMLElement): HTMLElement {
  return host.querySelector('bottom-sheet > lookup-card') as HTMLElement;
}

describe('InlineBottomSheetRenderer', () => {
  // Clear accumulated host <div>s between tests so DOM state does not leak.
  afterEach(() => {
    document.body.replaceChildren();
  });

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

  it('renderLoading(word) shows the selected word as the headword immediately', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderLoading('resilient');
    const c = card(h);
    expect(c.querySelector('h2')!.textContent).toBe('resilient');
    expect(c.textContent).toContain('Looking up');
  });

  it('stamps the theme as an ATTRIBUTE on the card (crosses the MAIN/isolated world boundary)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading(); // default theme
    expect(card(h).getAttribute('data-ad-theme')).toBe('sepia');
    r.theme = 'dark'; // late theme arrival re-stamps the live card
    expect(card(h).getAttribute('data-ad-theme')).toBe('dark');
    r.close();
    r.renderLoading(); // a re-created card keeps the stored preference
    expect(card(h).getAttribute('data-ad-theme')).toBe('dark');
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
    const r = new InlineBottomSheetRenderer(h, (md) => `SAFE:${md}` as SafeHtml);
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
    r.renderLoading();
    r.renderResult(result);
    r.renderError(error);
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
  });

  it('close removes the sheet from the host', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    r.close();
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

  it('does NOT stamp the side-panel attribute by default', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderLoading();
    expect(card(h).hasAttribute('side-panel')).toBe(false);
  });

  it('stamps the side-panel attribute on the card when constructed with { sidePanel: true }', () => {
    const h = host();
    new InlineBottomSheetRenderer(h, undefined, { sidePanel: true }).renderLoading();
    expect(card(h).hasAttribute('side-panel')).toBe(true);
  });

  it('renderResult forwards provider + ctx.providers → badge and picker appear in light DOM', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(
      { ...result, provider: 'anthropic', fallbackFrom: 'gemini' },
      { providers: ['gemini', 'anthropic'], onSwitchProvider: () => {} },
    );
    const c = card(h);
    expect(c.querySelector('.prov-badge')!.textContent).toBe('Claude');
    expect(c.querySelector('.fallback-note')!.textContent).toBe(
      'Gemini unavailable — answered by Claude',
    );
    expect(c.querySelector('.prov-switch')).not.toBeNull();
  });

  it('clicking a picker option invokes ctx.onSwitchProvider with the chosen provider', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    const picks: string[] = [];
    r.renderResult(
      { ...result, provider: 'gemini' },
      { providers: ['gemini', 'openai'], onSwitchProvider: (p) => picks.push(p) },
    );
    const c = card(h);
    c.querySelector<HTMLButtonElement>('.prov-menu [data-provider="openai"]')!.click();
    expect(picks).toEqual(['openai']);
  });

  it('a result with no provider metadata renders no meta-row (back-compat)', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.meta-row')).toBeNull();
  });

  it('appendToCard appends a node into the open card and returns true; false when no card', () => {
    const r = new InlineBottomSheetRenderer(document.body);
    const extra = document.createElement('div');
    extra.textContent = 'footer';
    expect(r.appendToCard(extra)).toBe(false); // no card yet
    r.renderError(error);
    expect(r.appendToCard(extra)).toBe(true);
    // the appended node is now a child of the card element
    expect(document.body.querySelector('lookup-card')!.contains(extra)).toBe(true);
  });

  it('renderResult forwards r.definedAs → the idiom label appears in light DOM', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, definedAs: { term: 'kick the bucket', isIdiom: true } });
    const c = card(h);
    expect(c.querySelector('.defined-as__label')!.textContent).toBe(
      'Defined as "kick the bucket" (idiom)',
    );
  });

  it("clicking the card's force-literal button invokes ctx.onForceLiteral", () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    const calls: number[] = [];
    r.renderResult(
      { ...result, definedAs: { term: 'kick the bucket', isIdiom: true } },
      { onForceLiteral: () => calls.push(1) },
    );
    card(h).querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.click();
    expect(calls).toEqual([1]);
  });

  it('a result with no definedAs renders no .defined-as row (back-compat)', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.defined-as')).toBeNull();
  });
});

describe('InlineBottomSheetRenderer — save state (B1)', () => {
  it('renderResult defaults CardState.saved to false when ctx.saved is absent', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    const btn = card(h).querySelector<HTMLButtonElement>('.save-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('renderResult reflects ctx.saved=true', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result, { saved: true });
    const btn = card(h).querySelector<HTMLButtonElement>('.save-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('setSaved(true) re-renders the last result with the star flipped', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    r.setSaved(true);
    const btn = card(h).querySelector<HTMLButtonElement>('.save-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('setSaved is a no-op when the last state was loading, not a result', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.setSaved(true)).not.toThrow();
    expect(card(h).querySelector('.save-btn')).toBeNull();
  });

  it('setSaved is a no-op before any render (no card mounted)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    expect(() => r.setSaved(true)).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});

describe('InlineBottomSheetRenderer — status toggle (B5)', () => {
  it('setStatus(known) re-renders the last result with the status toggle showing Known', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: true });
    r.setStatus('known');
    const btn = card(h).querySelector<HTMLButtonElement>('.status-btn')!;
    expect(btn.textContent).toContain('Known');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('setStatus is a no-op when the last state was loading, not a result', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.setStatus('known')).not.toThrow();
    expect(card(h).querySelector('.status-btn')).toBeNull();
  });

  it('setStatus is a no-op before any render (no card mounted)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    expect(() => r.setStatus('known')).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});

describe('InlineBottomSheetRenderer — repeat-offender nudge (B7)', () => {
  it('renderResult reflects r.nudge=true', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult({ ...result, nudge: true });
    expect(card(h).querySelector('.nudge-row')).not.toBeNull();
  });

  it('renderResult defaults nudge to false when r.nudge is absent', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.nudge-row')).toBeNull();
  });

  it('setSaved(true) also clears the nudge banner', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, nudge: true });
    r.setSaved(true);
    expect(card(h).querySelector('.nudge-row')).toBeNull();
  });

  it('dismissNudge() clears the nudge banner without touching saved', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, nudge: true }, { saved: true });
    r.dismissNudge();
    const c = card(h);
    expect(c.querySelector('.nudge-row')).toBeNull();
    expect(c.querySelector<HTMLButtonElement>('.save-btn')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('dismissNudge is a no-op when the last state was loading, not a result', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.dismissNudge()).not.toThrow();
  });

  it('dismissNudge is a no-op before any render (no card mounted)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    expect(() => r.dismissNudge()).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });
});
