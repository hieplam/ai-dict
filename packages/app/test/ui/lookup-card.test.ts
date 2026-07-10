import { describe, it, expect, vi, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { LookupCard, renderCardState, type SafeHtml } from '../../src/ui/lookup-card';
import { registerContentElements } from '../../src/ui/register';

beforeAll(() => {
  registerContentElements();
});

/** Cast a trusted literal to SafeHtml for test fixtures only. */
const safe = (html: string) => html as SafeHtml;

function mountCard(): LookupCard {
  const el = document.createElement('lookup-card') as LookupCard;
  document.body.append(el);
  return el;
}

function mountCardWithSidePanel(): LookupCard {
  const el = document.createElement('lookup-card') as LookupCard;
  el.setAttribute('side-panel', '');
  document.body.append(el);
  return el;
}

/** Locate the visible loading caption (`.loadrow`) among the loading nodes. The spinner is
 * the caption's ::before pseudo-element (defined in CSS), not a DOM node. */
function loadingCaption(state: { kind: 'loading'; word?: string } = { kind: 'loading' }): {
  caption: HTMLElement;
  nodes: Node[];
} {
  const nodes = renderCardState(state);
  const caption = nodes.find(
    (n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('loadrow'),
  )!;
  return { caption, nodes };
}

describe('<lookup-card>', () => {
  it('has an aria-live region in the shadow and shows the loading text by default', () => {
    const el = mountCard();
    // The live region (with the projecting <slot>) lives in the shadow…
    const region = el.shadowRoot!.querySelector('[aria-live="polite"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('slot')).not.toBeNull();
    // …while the visible content lives in the LIGHT DOM (shared across worlds).
    expect(el.textContent).toContain('Looking up');
  });

  it('renders a result with a heading and the pre-sanitized body in light DOM', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
    // Content is in the card's light DOM so it crosses the content-script world boundary.
    expect(el.querySelector('h2')!.textContent).toBe('bank');
    expect(el.innerHTML).toContain('money place');
  });

  it('renders an error message in light DOM', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'NETWORK', message: 'Network failed.', retryable: true },
    };
    expect(el.querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('renders the no-key state as a setup invite (not a red error) with an Open Settings button', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false },
    };
    // No generic ".err" failure text, and no "Lookup failed" headword — this is onboarding.
    expect(el.querySelector('.err')).toBeNull();
    expect(el.textContent).not.toContain('Lookup failed');
    expect(el.querySelector('.setup-title')!.textContent).toBe('Set up AI Dictionary');
    expect(el.querySelector<HTMLButtonElement>('.setup-cta')!.textContent).toBe('Open Settings');
  });

  it('the no-key Open Settings button emits a composed "open-settings" event', () => {
    const el = mountCard();
    el.replaceChildren(
      ...renderCardState({
        kind: 'error',
        error: { code: 'NO_KEY', message: 'x', retryable: false },
      }),
    );
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('open-settings', handler);
    el.querySelector<HTMLButtonElement>('.setup-cta')!.click();
    document.body.removeEventListener('open-settings', handler);
    expect(evt).not.toBeNull();
    // Frozen cross-bundle contract: the shell listens for exactly this name, composed across shadows.
    expect(evt!.type).toBe('open-settings');
    expect(evt!.composed).toBe(true);
  });

  it('the header offers a Settings action (before Close) that emits a composed "open-settings"', () => {
    const el = mountCard();
    const acts = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-act]')];
    // Settings sits left of Close so Close keeps its familiar right-most spot.
    expect(acts.map((b) => b.dataset['act'])).toEqual(['settings', 'close']);
    const gear = acts[0]!;
    expect(gear.getAttribute('aria-label')).toBe('Settings');
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('open-settings', handler);
    gear.click();
    document.body.removeEventListener('open-settings', handler);
    expect(evt).not.toBeNull();
    // Frozen cross-bundle contract: same event name as the setup CTA, composed across shadows.
    expect(evt!.type).toBe('open-settings');
    expect(evt!.composed).toBe(true);
  });

  it('setup-invite slotted rules are !important so host-page resets cannot strip the centering', () => {
    // The invite nodes are slotted LIGHT-DOM children, so the host page's NORMAL declarations
    // beat the shadow's normal ::slotted() ones — a reset like button{margin:0} used to shove
    // the CTA off-centre (e1 bug). Inner-tree !important wins that tiebreak; pin it here.
    const el = mountCard();
    const sheet = el.shadowRoot!.adoptedStyleSheets[0]!;
    const rules = [...sheet.cssRules].map((r) => r.cssText);
    const cta = rules.find(
      (t) => t.includes('::slotted(.setup-cta)') && !t.includes(':hover') && !t.includes(':focus'),
    );
    expect(cta).toBeDefined();
    expect(cta).toMatch(/margin:\s*15px auto 6px\s*!important/);
    expect(cta).toMatch(/display:\s*block\s*!important/);
    for (const sel of ['.setup-title', '.setup-text']) {
      expect(rules.find((t) => t.includes(`::slotted(${sel})`))).toMatch(
        /text-align:\s*center\s*!important/,
      );
    }
    expect(rules.find((t) => t.includes('::slotted(.mark)'))).toMatch(
      /margin:\s*16px auto 2px\s*!important/,
    );
  });

  it('a rejected (invalid) key keeps the error but still offers Open Settings', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false },
    };
    expect(el.querySelector('.err')!.textContent).toBe('Google rejected the API key.');
    expect(el.querySelector<HTMLButtonElement>('.setup-cta')!.textContent).toBe('Open Settings');
  });

  it('renders content written straight to light DOM, with no .state setter (cross-world path)', () => {
    // Simulate the Chrome MV3 isolated-world reality: the card is a plain element whose
    // LookupCard class — and `.state` setter — live in the page MAIN world and are
    // unreachable. The card must still display content that is written directly into its
    // shared light DOM via the exported helper. This is the regression guard for the
    // "stuck on Looking up…" bug: the old card only rendered into its shadow via `.state`.
    const el = mountCard();
    el.replaceChildren(
      ...renderCardState({
        kind: 'result',
        word: 'tree',
        target: 'vi',
        safeHtml: safe('<p>a plant</p>'),
      }),
    );
    expect(el.querySelector('h2')!.textContent).toBe('tree');
    expect(el.innerHTML).toContain('a plant');
    // The shadow <slot> is what projects that light DOM into view.
    expect(el.shadowRoot!.querySelector('slot')).not.toBeNull();
  });

  it('emits "close" (and has no "expand" button)', () => {
    const el = mountCard();
    let closeEvt: Event | null = null;
    const close = vi.fn((e: Event) => {
      closeEvt = e;
    });
    el.addEventListener('close', close);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(close).toHaveBeenCalledOnce();
    // Assert the frozen cross-bundle event-name contract.
    expect(closeEvt!.type).toBe('close');
    // The dead "Expand" button was removed — it dispatched an event no one listened for.
    expect(el.shadowRoot!.querySelector('[data-act="expand"]')).toBeNull();
  });

  it('state set before connect is preserved (not overwritten by the default loading content)', () => {
    // Setting state before connection writes light DOM; connectedCallback must NOT clobber it
    // back to the default loading content (it only seeds loading when the card is empty).
    const el = document.createElement('lookup-card') as LookupCard;
    el.state = { kind: 'result', word: 'test', target: 'vi', safeHtml: safe('<p>hi</p>') };
    document.body.append(el);
    expect(el.querySelector('h2')!.textContent).toBe('test');
  });

  it('does not re-initialize shadow on second connectedCallback', () => {
    const el = mountCard();
    document.body.removeChild(el);
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('"close" event crosses shadow boundary (composed: true)', () => {
    const el = mountCard();
    let capturedEvent: CustomEvent | null = null;
    const handler = (e: Event): void => {
      capturedEvent = e as CustomEvent;
    };
    // Trigger the click from inside the shadow root; composed:true on the
    // custom event is what allows it to reach this ancestor listener.
    document.body.addEventListener('close', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="close"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    document.body.removeEventListener('close', handler);
    expect(capturedEvent).not.toBeNull();
    // Verify the dispatched custom event carries composed:true so a change to
    // {composed:false} in the implementation would make this assertion red.
    expect(capturedEvent!.composed).toBe(true);
  });

  it('renderCardState loading returns a visible .loadrow caption, with the spinner as its ::before, and @keyframes', () => {
    const el = mountCard();
    const { caption, nodes } = loadingCaption();
    // The caption is a real, VISIBLE element (not visually-hidden) carrying the loading text.
    expect(caption).toBeDefined();
    expect(caption.textContent).toContain('Looking up');
    // role="status" is intentionally absent — the card's aria-live="polite" section announces;
    // a nested live region double-announces in NVDA/JAWS.
    expect(caption.getAttribute('role')).toBeNull();
    // combined textContent must contain "Looking up"
    const combined = nodes.map((n) => (n as HTMLElement).textContent ?? '').join('');
    expect(combined).toContain('Looking up');
    // The spinner is the caption's ::before pseudo-element with the spin animation, and the
    // card's adopted CSS must define @keyframes spin for it to resolve.
    const sheet = el.shadowRoot!.adoptedStyleSheets[0]!;
    const css = [...sheet.cssRules].map((r) => r.cssText).join('\n');
    expect(css).toContain('::slotted(.loadrow)::before');
    const hasKeyframes = [...sheet.cssRules].some(
      (r) => r instanceof CSSKeyframesRule || r.cssText.includes('@keyframes'),
    );
    expect(hasKeyframes).toBe(true);
  });

  it('the rotating spinner cannot drag the caption text (spinner is generated content, not a wrapper element)', () => {
    // Regression guard for the old bug where the "Looking up…" label sat INSIDE the rotating
    // ring and span around with it. Now the spinner is the caption's ::before pseudo-element,
    // so it is structurally impossible for any animated DOM node to contain the text.
    const { caption } = loadingCaption();
    expect(caption.querySelector('*')).toBeNull(); // no child elements — text only
    expect(caption.classList.contains('loadrow')).toBe(true);
  });

  it('loading caption is visible body text (no sr-only class) and CSP-safe (no inline style attribute)', () => {
    // The caption is intentionally visible now: a lone hidden spinner made the card read as
    // an empty box to sighted readers. It must not carry an inline `style` attribute, since
    // extension pages run under `style-src 'self'` which blocks inline styles.
    const { caption } = loadingCaption();
    expect(caption.classList.contains('sr-only')).toBe(false);
    expect(caption.hasAttribute('style')).toBe(false);
  });

  it('loading shows the selected word as the headword the instant Define is clicked', () => {
    // The key fix: the reader's selected word is known immediately, so the card renders it as
    // the serif headword right away instead of showing an empty box until the model replies.
    const { nodes } = loadingCaption({ kind: 'loading', word: 'resilient' });
    const h = nodes.find((n): n is HTMLElement => n instanceof HTMLElement && n.tagName === 'H2');
    expect(h).toBeDefined();
    expect(h!.textContent).toBe('resilient');
  });

  it('loading without a word still renders a non-empty card (caption only, no headword)', () => {
    const { caption, nodes } = loadingCaption({ kind: 'loading' });
    expect(nodes.some((n) => n instanceof HTMLElement && n.tagName === 'H2')).toBe(false);
    expect(caption.textContent).toContain('Looking up');
  });

  it('has no axe violations (loading state)', async () => {
    const el = mountCard();
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (loading state with word headword)', async () => {
    const el = mountCard();
    el.state = { kind: 'loading', word: 'resilient' };
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (result state)', async () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'sky', target: 'vi', safeHtml: safe('<p>the sky</p>') };
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (error state)', async () => {
    const el = mountCard();
    el.state = { kind: 'error', error: { code: 'NETWORK', message: 'fail', retryable: false } };
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations (no-key setup invite)', async () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false },
    };
    expect(await axeViolations(el)).toEqual([]);
  });

  it('omits the side-panel action by default (no side-panel attribute)', () => {
    const el = mountCard();
    expect(el.shadowRoot!.querySelector('[data-act="side-panel"]')).toBeNull();
    const acts = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-act]')];
    expect(acts.map((b) => b.dataset['act'])).toEqual(['settings', 'close']);
  });

  it('with the side-panel attribute, renders the action FIRST (before Settings and Close)', () => {
    const el = mountCardWithSidePanel();
    const acts = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-act]')];
    expect(acts.map((b) => b.dataset['act'])).toEqual(['side-panel', 'settings', 'close']);
    const btn = acts[0]!;
    expect(btn.getAttribute('aria-label')).toBe('Open in side panel');
    expect(btn.getAttribute('title')).toBe('Open in side panel');
  });

  it('the side-panel action emits a composed, bubbling "open-side-panel" event', () => {
    const el = mountCardWithSidePanel();
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('open-side-panel', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="side-panel"]')!.click();
    document.body.removeEventListener('open-side-panel', handler);
    expect(evt).not.toBeNull();
    // Frozen cross-bundle contract: the Chrome shell listens for exactly this name.
    expect(evt!.type).toBe('open-side-panel');
    expect(evt!.composed).toBe(true);
    expect(evt!.bubbles).toBe(true);
  });

  it('has no axe violations with the side-panel action present (result state)', async () => {
    const el = mountCardWithSidePanel();
    el.state = { kind: 'result', word: 'sky', target: 'vi', safeHtml: safe('<p>the sky</p>') };
    expect(await axeViolations(el)).toEqual([]);
  });
});

describe('<lookup-card> provider metadata row (badge, fallback note, picker)', () => {
  it('result with a provider renders a .meta-row with the provider badge label', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'anthropic',
    };
    const row = el.querySelector('.meta-row');
    expect(row).not.toBeNull();
    expect(el.querySelector('.prov-badge')!.textContent).toBe('Claude');
  });

  it('result WITHOUT a provider renders no .meta-row (e.g. entries cached before this feature)', () => {
    const nodes = renderCardState({
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
    });
    const hasMeta = nodes.some((n) => n instanceof HTMLElement && n.classList.contains('meta-row'));
    expect(hasMeta).toBe(false);
  });

  it('fallbackFrom renders a .fallback-note naming the failed and answering providers', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'anthropic',
      fallbackFrom: 'gemini',
    };
    expect(el.querySelector('.fallback-note')!.textContent).toBe(
      'Gemini unavailable — answered by Claude',
    );
  });

  it('≥2 providers renders a .prov-switch; picking an option fires composed switch-provider', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      providers: ['gemini', 'openai', 'anthropic'],
    };
    const sw = el.querySelector<HTMLButtonElement>('.prov-switch');
    expect(sw).not.toBeNull();
    // The current provider's option is selected + disabled; others are actionable.
    const current = el.querySelector<HTMLButtonElement>('.prov-menu [data-provider="gemini"]')!;
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(current.disabled).toBe(true);

    let evt: CustomEvent<{ provider: string }> | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent<{ provider: string }>;
    };
    document.body.addEventListener('switch-provider', handler);
    el.querySelector<HTMLButtonElement>('.prov-menu [data-provider="openai"]')!.click();
    document.body.removeEventListener('switch-provider', handler);
    expect(evt).not.toBeNull();
    expect(evt!.composed).toBe(true);
    expect(evt!.detail.provider).toBe('openai');
  });

  it('a single configured provider renders no .prov-switch (nothing to switch to)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      providers: ['gemini'],
    };
    expect(el.querySelector('.prov-switch')).toBeNull();
  });

  it('the Switch button toggles the listbox open/closed via aria-expanded', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      providers: ['gemini', 'openai'],
    };
    const sw = el.querySelector<HTMLButtonElement>('.prov-switch')!;
    const menu = el.querySelector<HTMLElement>('.prov-menu')!;
    expect(menu.hidden).toBe(true);
    expect(sw.getAttribute('aria-expanded')).toBe('false');
    sw.click();
    expect(menu.hidden).toBe(false);
    expect(sw.getAttribute('aria-expanded')).toBe('true');
  });

  it('has no axe violations with the provider picker present (result state)', async () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'sky',
      target: 'vi',
      safeHtml: safe('<p>the sky</p>'),
      provider: 'gemini',
      providers: ['gemini', 'openai'],
    };
    expect(await axeViolations(el)).toEqual([]);
  });
});

describe('<lookup-card> idiom label + force-literal button (A8)', () => {
  it('an idiom result renders the defined-as label and a "Show literal word" button', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>To die.</p>'),
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    expect(el.querySelector('.defined-as__label')!.textContent).toBe(
      'Defined as "kick the bucket" (idiom)',
    );
    expect(el.querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.textContent).toBe(
      'Show literal word',
    );
  });

  it('clicking the button fires a composed force-literal event', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>To die.</p>'),
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const handler = vi.fn();
    document.body.addEventListener('force-literal', handler);
    el.querySelector<HTMLButtonElement>('.defined-as__literal-btn')!.click();
    document.body.removeEventListener('force-literal', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a literal result (isIdiom: false) renders no .defined-as row', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bucket',
      target: 'vi',
      safeHtml: safe('<p>A pail.</p>'),
      definedAs: { term: 'bucket', isIdiom: false },
    };
    expect(el.querySelector('.defined-as')).toBeNull();
  });

  it('a result with no definedAs renders no .defined-as row (back-compat)', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
    expect(el.querySelector('.defined-as')).toBeNull();
  });
});

describe('<lookup-card> save/star affordance (B1)', () => {
  it('an unsaved result renders a Save button with aria-pressed=false', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
    };
    const btn = el.querySelector<HTMLButtonElement>('.save-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toContain('Save');
    expect(btn.getAttribute('aria-label')).toBe('Save bank to your word list');
  });

  it('a saved result renders aria-pressed=true and the Saved label', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: true,
    };
    const btn = el.querySelector<HTMLButtonElement>('.save-btn')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toContain('Saved');
    expect(btn.getAttribute('aria-label')).toBe('Remove bank from saved words');
  });

  it('clicking the save button fires a composed toggle-save event with the word in detail', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
    };
    const handler = vi.fn();
    document.body.addEventListener('toggle-save', handler);
    el.querySelector<HTMLButtonElement>('.save-btn')!.click();
    document.body.removeEventListener('toggle-save', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ word: string }>;
    expect(event.detail).toEqual({ word: 'bank' });
  });

  it('the loading and error states render no save row (only result carries it)', () => {
    const { nodes } = loadingCaption();
    expect(nodes.some((n) => n instanceof HTMLElement && n.classList.contains('save-row'))).toBe(
      false,
    );
    const errorNodes = renderCardState({
      kind: 'error',
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    expect(
      errorNodes.some((n) => n instanceof HTMLElement && n.classList.contains('save-row')),
    ).toBe(false);
  });
});

describe('<lookup-card> repeat-offender nudge (B7)', () => {
  it('a result with nudge:true renders the banner with the exact copy', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const row = el.querySelector('.nudge-row')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('3rd time meeting this word — save it?');
  });

  it('clicking the nudge Save button fires the SAME composed toggle-save event the star uses', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const handler = vi.fn();
    document.body.addEventListener('toggle-save', handler);
    el.querySelector<HTMLButtonElement>('.nudge-row__save-btn')!.click();
    document.body.removeEventListener('toggle-save', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ word: string }>;
    expect(event.detail).toEqual({ word: 'bank' });
  });

  it('clicking the dismiss button fires a composed dismiss-nudge event', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    const handler = vi.fn();
    document.body.addEventListener('dismiss-nudge', handler);
    el.querySelector<HTMLButtonElement>('.nudge-row__dismiss-btn')!.click();
    document.body.removeEventListener('dismiss-nudge', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('nudge absent/false renders no banner (back-compat)', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
    expect(el.querySelector('.nudge-row')).toBeNull();
  });

  it('the loading and error states render no nudge row (only result carries it)', () => {
    const { nodes } = loadingCaption();
    expect(nodes.some((n) => n instanceof HTMLElement && n.classList.contains('nudge-row'))).toBe(
      false,
    );
  });

  it('has no axe violations (result state with nudge banner)', async () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      nudge: true,
    };
    expect(await axeViolations(el)).toEqual([]);
  });
});
