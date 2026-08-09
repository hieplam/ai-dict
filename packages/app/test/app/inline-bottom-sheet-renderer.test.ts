import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { InlineBottomSheetRenderer } from '../../src/app/inline-bottom-sheet-renderer';
import { computeCardPlacement } from '../../src/domain/card-placement';
import { registerContentElements } from '../../src/ui/register';
import type { LookupResult, LookupError, AnchorRect } from '../../src';
import type { SafeHtml } from '../../src/ui/index';

// A6: the new placement assertions read the bottom-sheet's shadow-root .panel and call the
// BottomSheet-specific positionNear method, both of which require the custom elements to be
// upgraded — register them the same way bottom-sheet.test.ts does.
beforeAll(() => {
  registerContentElements();
});

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
function sheetPanel(host: HTMLElement): HTMLElement {
  return host.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel') as HTMLElement;
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

  it('renderLoading(word, anchor) positions the sheet panel per computeCardPlacement (A6)', () => {
    const h = host();
    const anchor: AnchorRect = { x: 40, y: 60, w: 30, h: 10 };
    new InlineBottomSheetRenderer(h).renderLoading('resilient', anchor);
    const panel = sheetPanel(h);
    const box = panel.getBoundingClientRect();
    const expected = computeCardPlacement(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    expect(panel.style.bottom).toBe('auto');
    expect(panel.style.top).toBe(`${expected.top}px`);
    expect(panel.style.left).toBe(`${expected.left}px`);
  });

  it('a later renderResult (no anchor arg) reuses the anchor cached by the preceding renderLoading (A6)', () => {
    const h = host();
    const anchor: AnchorRect = { x: 40, y: 60, w: 30, h: 10 };
    const renderer = new InlineBottomSheetRenderer(h);
    renderer.renderLoading('bank', anchor);
    const topAfterLoading = sheetPanel(h).style.top;
    renderer.renderResult(result);
    expect(sheetPanel(h).style.top).toBe(topAfterLoading);
  });

  it('close() clears the cached anchor — a later renderLoading with no anchor uses the bottom-center default (A6)', () => {
    const h = host();
    const renderer = new InlineBottomSheetRenderer(h);
    renderer.renderLoading('bank', { x: 40, y: 60, w: 30, h: 10 });
    renderer.close();
    renderer.renderLoading('bank2');
    const panel = sheetPanel(h);
    const box = panel.getBoundingClientRect();
    const expected = computeCardPlacement(
      null,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    expect(panel.style.top).toBe(`${expected.top}px`);
    expect(panel.style.left).toBe(`${expected.left}px`);
  });

  it('renderLoading() with no anchor at all does not throw (A6)', () => {
    const h = host();
    expect(() => new InlineBottomSheetRenderer(h).renderLoading()).not.toThrow();
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

  it('close() cancels any in-flight speech synthesis utterance (A10)', () => {
    const cancel = vi.fn();
    // renderResult's own render pass reaches renderSpeakButton, which registers a
    // 'voiceschanged' listener when no local voice is found yet (real speechSynthesis is an
    // EventTarget) — the stub needs a no-op addEventListener for that path to run harmlessly.
    vi.stubGlobal('speechSynthesis', {
      cancel,
      getVoices: () => [],
      addEventListener: () => {},
    });
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    cancel.mockClear(); // renderResult's own renderCardState call already invoked cancel once
    r.close();
    expect(cancel).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('close() is safe when SpeechSynthesis is unsupported (A10)', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading();
    expect(() => r.close()).not.toThrow();
    vi.unstubAllGlobals();
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

  it('renderResult always sets refineChips:true so the card shows the 5-chip row (4 from A3 + related from B13)', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelectorAll('.refine-chip').length).toBe(5);
  });

  it("wiring ctx.onRefine — clicking a refine chip invokes the callback with the chip's kind (A3)", () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    const calls: string[] = [];
    r.renderResult(result, { onRefine: (k) => calls.push(k) });
    card(h).querySelectorAll<HTMLButtonElement>('.refine-chip')[2]!.click(); // "Etymology"
    expect(calls).toEqual(['etymology']);
  });

  it('a second renderResult with ctx.refine set does not clobber the original snapshot; restoreOriginal() re-shows it (A3)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result); // original
    r.renderResult({ ...result, markdown: '**refined**' }, { refine: 'simpler' });
    expect(card(h).innerHTML).toContain('<strong>refined</strong>');
    r.restoreOriginal();
    expect(card(h).innerHTML).toContain('<strong>def</strong>'); // back to the ORIGINAL markdown
    expect(card(h).innerHTML).not.toContain('refined');
  });

  it('restoreOriginal() before any render is a no-op', () => {
    const h = host();
    expect(() => new InlineBottomSheetRenderer(h).restoreOriginal()).not.toThrow();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('close() resets the original snapshot — a fresh render after close is the new original (A3)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    r.close();
    r.renderResult({ ...result, markdown: '**second**' });
    r.restoreOriginal();
    expect(card(h).innerHTML).toContain('<strong>second</strong>');
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

  it('setSaved(false) clears any stale status, so a later re-save never flashes a leaked status', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: true });
    r.setStatus('known');
    r.setSaved(false);
    r.setSaved(true);
    expect(card(h).querySelector('.status-btn')).toBeNull();
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

describe('InlineBottomSheetRenderer — instant-cache badge (A9)', () => {
  it('renderResult reflects r.fromCache=true', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult({ ...result, fromCache: true });
    expect(card(h).querySelector('.cache-badge')).not.toBeNull();
  });

  it('renderResult reflects r.fromCache=false (the shared fixture default)', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.cache-badge')).toBeNull();
  });
});

describe('renderPartial (A1)', () => {
  it('paints a streaming CardState with the sanitized body and no interactive rows', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderPartial('bank', '**The land** alongside a river.');
    const c = card(h);
    expect(c.querySelector('h2')!.textContent).toBe('bank');
    expect(c.textContent).toContain('The land alongside a river.');
    expect(c.querySelector('.save-row')).toBeNull();
  });

  it('sets data-streaming on the card host while streaming, clears it on renderResult/renderError/close', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderPartial('bank', 'partial');
    expect(card(h).hasAttribute('data-streaming')).toBe(true);
    r.renderResult(result);
    expect(card(h).hasAttribute('data-streaming')).toBe(false);
    r.renderPartial('bank', 'partial again');
    expect(card(h).hasAttribute('data-streaming')).toBe(true);
    r.renderError(error);
    expect(card(h).hasAttribute('data-streaming')).toBe(false);
  });

  it('throttles repaints under the 80ms floor, using the injected clock', () => {
    const h = host();
    let t = 0;
    const r = new InlineBottomSheetRenderer(h, undefined, {}, () => t);
    r.renderLoading('bank');
    t = 0;
    r.renderPartial('bank', 'a');
    expect(card(h).textContent).toContain('a');
    t = 10; // under the 80ms floor
    r.renderPartial('bank', 'ab');
    expect(card(h).textContent).not.toContain('ab');
    t = 90; // past the floor from the last PAINTED call (t=0)
    r.renderPartial('bank', 'abc');
    expect(card(h).textContent).toContain('abc');
  });

  it('renderLoading clears a data-streaming attribute leaked by a superseded stream (Blocker fix)', () => {
    // A lookup superseded mid-stream (its terminal renderResult/renderError dropped by the
    // workflow abort guard) must not leave data-streaming set on the reused card — otherwise
    // the NEXT lookup's renderLoading announces with aria-live="off" (silenced for screen
    // readers), see lookup-card.ts's attributeChangedCallback.
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderPartial('bank', 'partial');
    expect(card(h).hasAttribute('data-streaming')).toBe(true);
    const region = h
      .querySelector('lookup-card')!
      .shadowRoot!.querySelector('.region') as HTMLElement;
    expect(region.getAttribute('aria-live')).toBe('off');
    r.renderLoading('shore');
    expect(card(h).hasAttribute('data-streaming')).toBe(false);
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('renderLoading resets the throttle clock so the next lookup always paints its first frame', () => {
    const h = host();
    let t = 0;
    const r = new InlineBottomSheetRenderer(h, undefined, {}, () => t);
    r.renderPartial('bank', 'a');
    t = 5; // still under 80ms of the previous lookup's timing
    r.renderLoading('shore');
    r.renderPartial('shore', 'b');
    expect(card(h).textContent).toContain('b');
  });
});

describe('InlineBottomSheetRenderer — Back navigation (A2)', () => {
  it('renderResult(r, { onBack }) sets CardState.canGoBack and shows a .back-btn', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { onBack: () => undefined });
    expect(card(h).querySelector('.back-btn')).not.toBeNull();
  });

  it('renderResult(r) without ctx.onBack renders no .back-btn', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result);
    expect(card(h).querySelector('.back-btn')).toBeNull();
  });

  it("clicking the card's back-btn invokes ctx.onBack", () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    const calls: number[] = [];
    r.renderResult(result, { onBack: () => calls.push(1) });
    card(h).querySelector<HTMLButtonElement>('.back-btn')!.click();
    expect(calls).toEqual([1]);
  });
});

describe('InlineBottomSheetRenderer — gloss mode (A5)', () => {
  afterEach(() => document.body.replaceChildren());
  const anchor: AnchorRect = { x: 10, y: 20, w: 30, h: 40 };
  function gloss(h: HTMLElement): HTMLElement | null {
    return h.querySelector('lookup-gloss');
  }

  it('regression: glossMode default false — renderResult opens the full card even with a translation + anchor', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true + anchor + translation mounts a compact gloss bubble at the anchor, not the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    const g = gloss(h);
    expect(g).not.toBeNull();
    expect(g!.style.left).toBe('10px');
    expect(g!.style.top).toBe('60px'); // anchor.y(20) + anchor.h(40)
    expect(h.querySelector('bottom-sheet')).toBeNull();
    expect(g!.textContent).toContain('ngân hàng');
  });

  it('glossMode=true with no translation on the result falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult(result);
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true with a BLANK translation also falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: '   ' });
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true + translation present but NO anchor falls back to the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank'); // no anchor → lastAnchor null
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(card(h)).not.toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('glossMode=true renderLoading(word, anchor) mounts a loading gloss bubble, not the full card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    const g = gloss(h);
    expect(g).not.toBeNull();
    expect(g!.querySelector('.gloss-spinner')).not.toBeNull();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('gloss mode: renderPartial during streaming does NOT open the full card behind the bubble', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderPartial('bank', '**partial**');
    expect(h.querySelector('bottom-sheet')).toBeNull();
    expect(gloss(h)).not.toBeNull();
  });

  it('dispatching "expand" swaps to the full card with the SAME already-computed result (no re-sanitize, no re-lookup)', () => {
    const h = host();
    let sanitizeCalls = 0;
    const r = new InlineBottomSheetRenderer(h, (md) => {
      sanitizeCalls++;
      return `SAFE:${md}` as SafeHtml;
    });
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(gloss(h)).not.toBeNull();
    const callsAfterFirstRender = sanitizeCalls;
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    const c = card(h);
    expect(c).not.toBeNull();
    expect(c.querySelector('h2')!.textContent).toBe('bank');
    expect(c.innerHTML).toContain(`SAFE:${result.markdown}`);
    expect(gloss(h)).toBeNull();
    expect(sanitizeCalls).toBe(callsAfterFirstRender);
  });

  it('post-expand stays expanded: a second renderResult (provider-switch re-run) updates the SAME open card — the bubble never reappears', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(gloss(h)).toBeNull();
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
  });

  it('errors always render the full card: renderError after a gloss-mode renderLoading removes the loading bubble', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    expect(gloss(h)).not.toBeNull();
    r.renderError(error);
    expect(gloss(h)).toBeNull();
    expect(card(h).querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('a mousedown outside the gloss bubble dismisses it without opening the full card', () => {
    const h = host();
    const outside = document.createElement('div');
    document.body.append(outside);
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(gloss(h)).not.toBeNull();
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(gloss(h)).toBeNull();
    expect(card(h)).toBeNull();
  });

  it('close() resets cardOpen — a fresh gloss-eligible renderResult after close() mounts a gloss bubble again', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    r.renderResult({ ...result, translation: 'ngân hàng' });
    gloss(h)!.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true }));
    r.close();
    r.renderLoading('bank', anchor); // re-sets lastAnchor (close() nulled it)
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(gloss(h)).not.toBeNull();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('outside-press dismiss during loading suppresses a late translation-bearing result (no bubble, no modal)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    const outside = document.createElement('div');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(gloss(h)).toBeNull();
    r.renderResult({ ...result, translation: 'ngân hàng' }); // late result for the dismissed lookup
    expect(gloss(h)).toBeNull();
    expect(h.querySelector('bottom-sheet')).toBeNull();
  });

  it('outside-press dismiss during loading suppresses a late TRANSLATION-ABSENT result (no unsolicited full modal)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    const outside = document.createElement('div');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    r.renderResult(result); // no translation
    expect(h.querySelector('bottom-sheet')).toBeNull();
    expect(gloss(h)).toBeNull();
  });

  it('a fresh renderLoading after a dismiss clears the dismissed state (next lookup renders normally)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.glossMode = true;
    r.renderLoading('bank', anchor);
    const outside = document.createElement('div');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    r.renderResult({ ...result, translation: 'ngân hàng' }); // suppressed
    r.renderLoading('bank', anchor); // NEW lookup
    r.renderResult({ ...result, translation: 'ngân hàng' });
    expect(gloss(h)).not.toBeNull();
  });
});

describe('InlineBottomSheetRenderer — pin cards (A7)', () => {
  // pinCurrent() creates a real <floating-pin> and calls placeFloatingPin() on it — production
  // always registers the element at startup via content.ts's call to registerContentElements();
  // this suite's earlier describe block never needed a registered custom element because it only
  // ever reads light-DOM content on <bottom-sheet>/<lookup-card>, which upgrade lazily.
  beforeAll(() => {
    registerContentElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function pinnedCard(h: HTMLElement): HTMLElement | null {
    return h.querySelector('floating-pin > lookup-card');
  }

  it('renderResult sets an enabled pin button when fewer than 3 are pinned', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    const btn = card(h).querySelector<HTMLButtonElement>('.pin-btn')!;
    expect(btn.disabled).toBe(false);
  });

  it('clicking Pin removes the bottom-sheet wrapper and creates a floating-pin containing the moved card (same headword)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();

    expect(h.querySelectorAll('bottom-sheet').length).toBe(0);
    expect(h.querySelectorAll('floating-pin').length).toBe(1);
    const pinned = pinnedCard(h)!;
    expect(pinned.querySelector('h2')!.textContent).toBe('bank');
  });

  it("the pinned copy's pin button renders as an inert Pinned badge", () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();

    const btn = pinnedCard(h)!.querySelector<HTMLButtonElement>('.pin-btn')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('the pinned copy has no .save-btn/.nudge-row, and a provider badge with no .prov-switch even when providers were switchable', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(
      { ...result, provider: 'gemini', nudge: true },
      { saved: true, providers: ['gemini', 'openai'] },
    );
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();

    const pinned = pinnedCard(h)!;
    expect(pinned.querySelector('.save-btn')).toBeNull();
    expect(pinned.querySelector('.nudge-row')).toBeNull();
    expect(pinned.querySelector('.prov-badge')).not.toBeNull();
    expect(pinned.querySelector('.prov-switch')).toBeNull();
  });

  it('a fresh renderLoading after pinning creates a brand-new live bottom-sheet while the pinned floating-pin is untouched', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();

    r.renderLoading('resilient');
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1);
    expect(h.querySelectorAll('floating-pin').length).toBe(1);
    expect(pinnedCard(h)!.querySelector('h2')!.textContent).toBe('bank');
  });

  it('dispatching close on a pinned copy removes only that floating-pin (others, and the live slot, are unaffected)', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult({ ...result, word: 'first' }, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();
    r.renderResult({ ...result, word: 'second' }, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();
    r.renderLoading('third'); // fresh live slot, unrelated to either pin

    const pins = [...h.querySelectorAll('floating-pin')];
    expect(pins.length).toBe(2);
    // The Close button lives in <lookup-card>'s SHADOW DOM (built by actionButton(), called from
    // connectedCallback) — light-DOM querySelector cannot pierce it.
    const closeBtn = pins[0]!
      .querySelector('lookup-card')!
      .shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    closeBtn.dispatchEvent(new Event('click', { bubbles: true, composed: true }));

    expect(h.querySelectorAll('floating-pin').length).toBe(1);
    expect(h.querySelectorAll('bottom-sheet').length).toBe(1); // the live "third" slot untouched
  });

  it('pinning 3 cards then rendering a 4th result yields a disabled pin button and exactly 3 floating-pin elements', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    for (const w of ['one', 'two', 'three']) {
      r.renderResult({ ...result, word: w }, { saved: false });
      card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();
    }
    r.renderResult({ ...result, word: 'four' }, { saved: false });

    expect(h.querySelectorAll('floating-pin').length).toBe(3);
    const btn = card(h).querySelector<HTMLButtonElement>('.pin-btn')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toContain('max 3');
  });

  it('a theme assignment after pinning re-stamps data-ad-theme on every pinned host and its card', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();

    r.theme = 'dark';
    const pin = h.querySelector('floating-pin')!;
    expect(pin.getAttribute('data-ad-theme')).toBe('dark');
    expect(pin.querySelector('lookup-card')!.getAttribute('data-ad-theme')).toBe('dark');
  });

  it('pinning resets the live-slot session so a later gloss-mode lookup still shows the compact bubble', () => {
    // A7 re-grounding guard: pinCurrent() resets cardOpen=false (mirroring close()), so the live
    // slot behaves as a fresh session after a pin. Without that reset, renderLoading's gloss gate
    // (`if (!this.cardOpen && ...)`) would stay shut and a gloss-mode reader who pinned once would
    // be stuck getting full cards on every later lookup. Here: pin a card (gloss off, so it opens a
    // full card and sets cardOpen=true), then turn gloss mode on and look up a NEW word — it must
    // mount the compact bubble, not a full card, and must not disturb the pinned card.
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();
    expect(h.querySelectorAll('floating-pin').length).toBe(1);

    r.glossMode = true;
    r.renderLoading('river', { x: 10, y: 20, w: 30, h: 40 });
    r.renderResult({ ...result, word: 'river', translation: 'sông' });

    expect(h.querySelector('lookup-gloss')).not.toBeNull();
    expect(h.querySelectorAll('bottom-sheet').length).toBe(0);
    expect(h.querySelectorAll('floating-pin').length).toBe(1); // pinned card untouched
  });

  it('a pinned card is decoupled — its internal events never reach the LIVE session handlers', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderResult(result, { saved: false });
    card(h).querySelector<HTMLButtonElement>('.pin-btn')!.click();
    const pinnedLc = h.querySelector('floating-pin > lookup-card')!;

    // A fresh live session installs its own one-shot handlers.
    const liveCalls: string[] = [];
    r.renderResult(
      { ...result, word: 'other' },
      {
        saved: false,
        providers: ['gemini', 'openai'],
        onSwitchProvider: () => liveCalls.push('switch'),
        onForceLiteral: () => liveCalls.push('literal'),
        onRefine: () => liveCalls.push('refine'),
        onBack: () => liveCalls.push('back'),
      },
    );

    // A page script dispatching the internal events at the DETACHED pinned card must be inert.
    pinnedLc.dispatchEvent(
      new CustomEvent('switch-provider', {
        detail: { provider: 'openai' },
        bubbles: true,
        composed: true,
      }),
    );
    pinnedLc.dispatchEvent(new CustomEvent('force-literal', { bubbles: true, composed: true }));
    pinnedLc.dispatchEvent(
      new CustomEvent('refine', { detail: { refine: 'simpler' }, bubbles: true, composed: true }),
    );
    pinnedLc.dispatchEvent(new CustomEvent('lookup-back', { bubbles: true, composed: true }));
    pinnedLc.dispatchEvent(new CustomEvent('pin', { bubbles: true, composed: true }));

    expect(liveCalls).toEqual([]); // no live-session handler fired
    expect(h.querySelectorAll('floating-pin').length).toBe(1); // `pin` did not force a 2nd pin
  });
});
