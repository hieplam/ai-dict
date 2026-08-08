import { describe, it, expect, vi, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import {
  LookupCard,
  renderCardState,
  type SafeHtml,
  type CardState,
} from '../../src/ui/lookup-card';
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

  it('a rejected (invalid) key keeps the error but offers a fix-key CTA', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false },
    };
    expect(el.querySelector('.err')!.textContent).toBe('Google rejected the API key.');
    expect(el.querySelector<HTMLButtonElement>('.setup-cta')!.textContent).toBe(
      'Fix key in Settings',
    );
  });

  it('the INVALID_KEY CTA fires open-settings with fixKey:true in its detail (C6)', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false },
    };
    const handler = vi.fn();
    document.body.addEventListener('open-settings', handler);
    el.querySelector<HTMLButtonElement>('.setup-cta')!.click();
    document.body.removeEventListener('open-settings', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ fixKey?: boolean } | undefined>;
    expect(event.detail?.fixKey).toBe(true);
  });

  it('D1: a BILLING error renders the honest message with NO CTA button', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: {
        code: 'BILLING',
        message:
          'Claude account has no credits or billing set up. Add credits with Anthropic, then try again.',
        retryable: false,
      },
    };
    expect(el.querySelector('.err')!.textContent).toContain('no credits or billing');
    expect(el.querySelector('.setup-cta')).toBeNull();
  });

  it('the NO_KEY setup-invite CTA still fires open-settings with no fixKey (C6 regression guard)', () => {
    const el = mountCard();
    el.state = {
      kind: 'error',
      error: { code: 'NO_KEY', message: 'Add your key.', retryable: false },
    };
    const handler = vi.fn();
    document.body.addEventListener('open-settings', handler);
    el.querySelector<HTMLButtonElement>('.setup-cta')!.click();
    document.body.removeEventListener('open-settings', handler);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ fixKey?: boolean } | undefined>;
    expect(event.detail?.fixKey).not.toBe(true);
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

describe('<lookup-card> instant-cache badge (A9)', () => {
  it('fromCache:true renders a .cache-badge reading "Cached", before the provider badge', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      fromCache: true,
    };
    const row = el.querySelector('.meta-row')!;
    const badge = row.querySelector('.cache-badge')!;
    expect(badge.textContent).toBe('Cached');
    // Cache badge is the leading child — first thing the eye lands on.
    expect(row.firstElementChild).toBe(badge);
    expect(row.querySelector('.prov-badge')).not.toBeNull();
  });

  it('fromCache:true with NO provider still renders the row with the cache badge', () => {
    const nodes = renderCardState({
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      fromCache: true,
    });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('meta-row'),
    );
    expect(row).toBeDefined();
    expect(row!.querySelector('.cache-badge')!.textContent).toBe('Cached');
    expect(row!.querySelector('.prov-badge')).toBeNull();
  });

  it('fromCache:false renders no .cache-badge', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      fromCache: false,
    };
    expect(el.querySelector('.cache-badge')).toBeNull();
    expect(el.querySelector('.prov-badge')).not.toBeNull(); // unaffected
  });

  it('fromCache absent and no provider still renders no .meta-row at all (unchanged guard)', () => {
    const nodes = renderCardState({
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
    });
    const hasMeta = nodes.some((n) => n instanceof HTMLElement && n.classList.contains('meta-row'));
    expect(hasMeta).toBe(false);
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

describe('<lookup-card> refine chips + back-to-original (A3)', () => {
  // `& { refineChips?: boolean | undefined }` widens just this one field so the
  // 'refineChips absent/false' test below can pass `refineChips: undefined` explicitly —
  // exactOptionalPropertyTypes (tsconfig.base.json) makes bare Partial<T> reject an explicit
  // `undefined` for a non-optional-source field even though the field itself is `?:`.
  function resultState(
    extra: Omit<Partial<Extract<CardState, { kind: 'result' }>>, 'refineChips'> & {
      refineChips?: boolean | undefined;
    } = {},
  ): CardState {
    return {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      refineChips: true,
      ...extra,
    } as CardState;
  }

  it('renders exactly 5 refine chips with the pinned copy, in order, none active (4 from A3 + related from B13)', () => {
    const el = mountCard();
    el.state = resultState();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.refine-chip')];
    expect(chips.map((b) => b.textContent)).toEqual([
      'Simpler',
      'More examples',
      'Etymology',
      'Use it',
      'Related words',
    ]);
    for (const chip of chips) {
      expect(chip.getAttribute('aria-pressed')).toBe('false');
      expect(chip.disabled).toBe(false);
    }
    expect(el.querySelector('.refine-back-btn')).toBeNull();
  });

  it('clicking a non-active chip fires a composed refine event with the chip id', () => {
    const el = mountCard();
    el.state = resultState();
    let evt: CustomEvent<{ refine: string }> | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent<{ refine: string }>;
    };
    document.body.addEventListener('refine', handler);
    el.querySelectorAll<HTMLButtonElement>('.refine-chip')[1]!.click(); // "More examples"
    document.body.removeEventListener('refine', handler);
    expect(evt).not.toBeNull();
    expect(evt!.detail.refine).toBe('examples');
    expect(evt!.composed).toBe(true);
  });

  it('the active refine chip is aria-pressed + disabled; a Back to original pill appears', () => {
    const el = mountCard();
    el.state = resultState({ refine: 'etymology' });
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.refine-chip')];
    const etymology = chips.find((b) => b.textContent === 'Etymology')!;
    expect(etymology.getAttribute('aria-pressed')).toBe('true');
    expect(etymology.disabled).toBe(true);
    for (const chip of chips) {
      if (chip !== etymology) {
        expect(chip.getAttribute('aria-pressed')).toBe('false');
        expect(chip.disabled).toBe(false);
      }
    }
    const back = el.querySelector<HTMLButtonElement>('.refine-back-btn')!;
    expect(back.textContent).toBe('Back to original');
  });

  it('clicking Back to original fires a composed refine-back event with no detail', () => {
    const el = mountCard();
    el.state = resultState({ refine: 'simpler' });
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('refine-back', handler);
    el.querySelector<HTMLButtonElement>('.refine-back-btn')!.click();
    document.body.removeEventListener('refine-back', handler);
    expect(evt).not.toBeNull();
    expect(evt!.composed).toBe(true);
  });

  it('a result with refineChips absent/false renders no .refine-row at all (side-panel omission)', () => {
    const el = mountCard();
    el.state = resultState({ refineChips: undefined });
    expect(el.querySelector('.refine-row')).toBeNull();
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

  it('a saved result with status learning renders a status toggle showing Learning (B5)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: true,
      status: 'learning',
    };
    const btn = el.querySelector<HTMLButtonElement>('.status-btn')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Learning');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Mark bank as known');
  });

  it('a saved result with status known renders a status toggle showing Known (B5)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: true,
      status: 'known',
    };
    const btn = el.querySelector<HTMLButtonElement>('.status-btn')!;
    expect(btn.textContent).toContain('Known');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Mark bank as learning');
  });

  it('an unsaved result renders no status toggle, even if status were somehow present (B5)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: false,
      status: 'learning',
    };
    expect(el.querySelector('.status-btn')).toBeNull();
  });

  it('a saved result with no status renders no status toggle (back-compat) (B5)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: true,
    };
    expect(el.querySelector('.status-btn')).toBeNull();
  });

  it('clicking the status toggle fires a composed toggle-status event with the word in detail (B5)', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>money place</p>'),
      saved: true,
      status: 'learning',
    };
    const handler = vi.fn();
    document.body.addEventListener('toggle-status', handler);
    el.querySelector<HTMLButtonElement>('.status-btn')!.click();
    document.body.removeEventListener('toggle-status', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ word: string }>;
    expect(event.detail).toEqual({ word: 'bank' });
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

describe('A10 speak button (TTS pronunciation)', () => {
  class FakeSpeechSynthesis extends EventTarget {
    cancel = vi.fn();
    speak = vi.fn();
    private _voices: SpeechSynthesisVoice[];
    constructor(voices: SpeechSynthesisVoice[] = []) {
      super();
      this._voices = voices;
    }
    getVoices(): SpeechSynthesisVoice[] {
      return this._voices;
    }
    setVoices(voices: SpeechSynthesisVoice[]): void {
      this._voices = voices;
      this.dispatchEvent(new Event('voiceschanged'));
    }
  }

  class FakeUtterance {
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    constructor(public text: string) {}
  }

  const LOCAL_EN_US = {
    lang: 'en-US',
    localService: true,
    default: true,
    name: 'Local US English',
    voiceURI: 'local-en-US',
  } as SpeechSynthesisVoice;

  const REMOTE_EN_GB = {
    lang: 'en-GB',
    localService: false,
    default: false,
    name: 'Remote UK English',
    voiceURI: 'remote-en-GB',
  } as SpeechSynthesisVoice;

  it('omits the speak button entirely when SpeechSynthesis is unsupported (A10)', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector('.speak-btn')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows the speak button immediately when a local English voice is already installed (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector<HTMLButtonElement>('.speak-btn')!.hidden).toBe(false);
    vi.unstubAllGlobals();
  });

  it('renders the speak button hidden, then reveals it once voiceschanged reports a local English voice (A10)', () => {
    const synth = new FakeSpeechSynthesis([]);
    vi.stubGlobal('speechSynthesis', synth);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const btn = el.querySelector<HTMLButtonElement>('.speak-btn')!;
    expect(btn.hidden).toBe(true);
    synth.setVoices([LOCAL_EN_US]);
    expect(btn.hidden).toBe(false);
    vi.unstubAllGlobals();
  });

  it('stays hidden when only a remote (non-local) voice is available — never risks a cloud TTS call (A10)', () => {
    const synth = new FakeSpeechSynthesis([REMOTE_EN_GB]);
    vi.stubGlobal('speechSynthesis', synth);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const btn = el.querySelector<HTMLButtonElement>('.speak-btn')!;
    expect(btn.hidden).toBe(true);
    synth.setVoices([REMOTE_EN_GB]); // voiceschanged fires again, still zero local voices
    expect(btn.hidden).toBe(true);
    vi.unstubAllGlobals();
  });

  it('clicking the speak button cancels any in-flight utterance, then speaks the word ONLY with a local English voice (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<h2>IPA</h2><p>/bæŋk/</p><p>a financial institution</p>'),
    };
    const synth = globalThis.speechSynthesis as unknown as FakeSpeechSynthesis;
    // mountCard()'s connectedCallback (default loading render) and el.state's own result render
    // each already invoked cancel() once — isolate the click's own call, same pattern
    // inline-bottom-sheet-renderer.test.ts uses for its close()-cancel test.
    synth.cancel.mockClear();
    el.querySelector<HTMLButtonElement>('.speak-btn')!.click();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utter = synth.speak.mock.calls[0]![0] as unknown as FakeUtterance;
    expect(utter.text).toBe('bank'); // the word only — never the definition body
    expect(utter.voice).toBe(LOCAL_EN_US);
    expect(utter.lang).toBe('en-US');
    vi.unstubAllGlobals();
  });

  it('a click makes zero speak() calls if no local voice remains at click time (never guesses) (A10)', () => {
    const synth = new FakeSpeechSynthesis([LOCAL_EN_US]);
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    synth.setVoices([]); // degrade after render, before the click
    el.querySelector<HTMLButtonElement>('.speak-btn')!.click();
    expect(synth.speak).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('renders no speak button for loading or error states — only alongside a result (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const { nodes: loadingNodes } = loadingCaption();
    expect(
      loadingNodes.some((n) => n instanceof HTMLElement && n.classList.contains('speak-btn')),
    ).toBe(false);
    const errorNodes = renderCardState({
      kind: 'error',
      error: { code: 'NETWORK', message: 'x', retryable: true },
    });
    expect(
      errorNodes.some((n) => n instanceof HTMLElement && n.classList.contains('speak-btn')),
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it('places the speak button as a top-level sibling immediately after the headword, before the save row (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const h2 = el.querySelector('h2')!;
    expect(h2.nextElementSibling?.classList.contains('speak-btn')).toBe(true);
    expect(h2.nextElementSibling?.nextElementSibling?.classList.contains('save-row')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('cancels any in-flight utterance on every renderCardState call — loading, result, and error (A10)', () => {
    const synth = new FakeSpeechSynthesis([LOCAL_EN_US]);
    vi.stubGlobal('speechSynthesis', synth);
    renderCardState({ kind: 'loading' });
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    renderCardState({ kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') });
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    renderCardState({ kind: 'error', error: { code: 'NETWORK', message: 'x', retryable: true } });
    expect(synth.cancel).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('labels the speak button with the exact word for screen readers (A10)', () => {
    vi.stubGlobal('speechSynthesis', new FakeSpeechSynthesis([LOCAL_EN_US]));
    const el = mountCard();
    el.state = { kind: 'result', word: 'serendipity', target: 'vi', safeHtml: safe('<p>x</p>') };
    expect(el.querySelector('.speak-btn')!.getAttribute('aria-label')).toBe(
      'Say "serendipity" aloud',
    );
    vi.unstubAllGlobals();
  });
});

describe('renderCardState — streaming (A1)', () => {
  it('renders the headword + sanitized body and nothing interactive', () => {
    const nodes = renderCardState({
      kind: 'streaming',
      word: 'bank',
      safeHtml: safe('<p>The land alongside a river.</p>'),
    });
    const wrap = document.createElement('div');
    wrap.append(...nodes);
    expect(wrap.querySelector('h2')!.textContent).toBe('bank');
    expect(wrap.textContent).toContain('The land alongside a river.');
    expect(wrap.querySelector('.save-row')).toBeNull();
    expect(wrap.querySelector('.status-btn')).toBeNull();
    expect(wrap.querySelector('.nudge-row')).toBeNull();
    expect(wrap.querySelector('.meta-row')).toBeNull();
  });

  it('shows the defined-as label without the literal-word button while streaming', () => {
    const nodes = renderCardState({
      kind: 'streaming',
      word: 'bucket',
      safeHtml: safe('<p>...</p>'),
      definedAs: { term: 'kick the bucket', isIdiom: true },
    });
    const wrap = document.createElement('div');
    wrap.append(...nodes);
    expect(wrap.querySelector('.defined-as__label')!.textContent).toContain('kick the bucket');
    expect(wrap.querySelector('.defined-as__literal-btn')).toBeNull();
  });
});

describe('LookupCard — data-streaming aria-live toggle (A1)', () => {
  it('flips the region aria-live between "off" and "polite"', () => {
    const el = document.createElement('lookup-card') as LookupCard;
    document.body.append(el);
    const region = el.shadowRoot!.querySelector('.region')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    el.toggleAttribute('data-streaming', true);
    expect(region.getAttribute('aria-live')).toBe('off');
    el.toggleAttribute('data-streaming', false);
    expect(region.getAttribute('aria-live')).toBe('polite');
    el.remove();
  });
});
