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
});
