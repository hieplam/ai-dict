import { describe, it, expect, vi, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { registerContentElements } from '../../src/ui/register';

beforeAll(() => {
  registerContentElements();
});

function mount<T extends HTMLElement>(tag: string): T {
  const el = document.createElement(tag) as T;
  document.body.append(el);
  return el;
}

describe('<lookup-trigger>', () => {
  it('renders an accessible button with adopted styles', () => {
    const el = mount('lookup-trigger');
    const root = el.shadowRoot!;
    expect(root.adoptedStyleSheets.length).toBe(1); // happy-dom constructable-stylesheet smoke check
    const btn = root.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    // A native <button> already carries the implicit ARIA role 'button'.
    // Setting role="button" explicitly violates the First Rule of ARIA and can
    // cause screen readers to announce "button button" — assert it is absent.
    expect(btn.getAttribute('role')).toBeNull();
  });

  it('the "Define" button declares an explicit text color (stays visible on dark-theme pages)', () => {
    // Regression: the button previously set background:#fff but no `color`. With
    // :host{all:initial} the text fell back to the system `canvastext` colour, which
    // resolves to (near-)white on a dark-theme page → an invisible "Define" on a white
    // box. Pinning an explicit colour makes it theme-independent.
    const el = mount('lookup-trigger');
    const rules = [...el.shadowRoot!.adoptedStyleSheets[0]!.cssRules] as CSSStyleRule[];
    const buttonRule = rules.find((r) => r.selectorText === 'button');
    expect(buttonRule).toBeTruthy();
    expect(buttonRule!.style.color).not.toBe('');
  });

  it(':host pins a high z-index so the trigger is not occluded by page stacking contexts', () => {
    // Regression (support.claude.com): `all:initial` resets z-index to `auto`, so the
    // host paints at z=0 in body's stacking context. Pages that wrap selectable text
    // in a positioned ancestor with a positive z-index (e.g. a `z-3` heading container)
    // then cover the trigger — the bubble renders but hit-testing returns the page
    // element underneath. mousedown on what looks like "Define" falls outside our
    // composedPath check and the capture-phase outside-press handler dismisses the
    // bubble before the click can fire.
    const el = mount('lookup-trigger');
    const rules = [...el.shadowRoot!.adoptedStyleSheets[0]!.cssRules] as CSSStyleRule[];
    const hostRule = rules.find((r) => r.selectorText === ':host');
    expect(hostRule).toBeTruthy();
    expect(parseInt(hostRule!.style.zIndex, 10)).toBeGreaterThanOrEqual(2147483647);
  });

  it('theme contract: light needs no attribute; [theme="dark"] and dark-OS [theme="system"] swap the palette', () => {
    const el = mount('lookup-trigger');
    const sheet = el.shadowRoot!.adoptedStyleSheets[0]!;
    const rules = [...sheet.cssRules];
    const styleRules = rules.filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
    // Unconditional dark override for the explicit setting.
    expect(styleRules.some((r) => r.selectorText === ':host([theme="dark"])')).toBe(true);
    // OS-following dark only inside the media query, and only for theme="system" —
    // a host WITHOUT the attribute (or with theme="light") must never go dark.
    const media = rules.find(
      (r): r is CSSMediaRule =>
        r instanceof CSSMediaRule && r.conditionText.includes('prefers-color-scheme'),
    );
    expect(media).toBeTruthy();
    const mediaSelectors = [...media!.cssRules]
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .map((r) => r.selectorText);
    expect(mediaSelectors).toContain(':host([theme="system"])');
    expect(mediaSelectors).not.toContain(':host');
  });

  it('emits a composed "lookup-click" on activation', () => {
    const el = mount('lookup-trigger');
    const spy = vi.fn();
    el.addEventListener('lookup-click', spy);
    el.shadowRoot!.querySelector('button')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('"lookup-click" event crosses shadow boundary (composed: true)', () => {
    const el = mount('lookup-trigger');
    let capturedEvent: CustomEvent | null = null;
    const handler = (e: Event): void => {
      capturedEvent = e as CustomEvent;
    };
    // Dispatch the triggering click from inside the shadow root so only a
    // composed:true custom event can reach this ancestor listener.
    document.body.addEventListener('lookup-click', handler);
    el.shadowRoot!.querySelector('button')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    document.body.removeEventListener('lookup-click', handler);
    expect(capturedEvent).not.toBeNull();
    // The custom event itself must carry composed:true — asserting this means
    // changing the dispatch to {composed:false} would make the test red.
    expect(capturedEvent!.composed).toBe(true);
  });

  it('has no axe violations', async () => {
    const el = mount('lookup-trigger');
    expect(await axeViolations(el)).toEqual([]);
  });

  it('has no axe violations in post-click state (disabled + spinner)', async () => {
    // Regression guard: if aria-label were accidentally dropped, the disabled button
    // would have no accessible name in this state — axe would catch it here.
    const el = mount('lookup-trigger');
    el.shadowRoot!.querySelector('button')!.click();
    expect(await axeViolations(el)).toEqual([]);
  });

  it('clicking the button sets disabled, renders an aria-hidden .spinner in shadow, and still emits lookup-click', () => {
    const el = mount('lookup-trigger');
    const spy = vi.fn();
    el.addEventListener('lookup-click', spy);
    const btn = el.shadowRoot!.querySelector('button')!;
    btn.click();
    // button must be disabled (aria-busy is intentionally absent — it is contradictory on a
    // disabled button: AT removes disabled buttons from the interactive tree and ignores aria-busy)
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    // a decorative aria-hidden spinner must appear inside the shadow root
    const spinner = el.shadowRoot!.querySelector('.spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.getAttribute('aria-hidden')).toBe('true');
    // the lookup-click event must still fire
    expect(spy).toHaveBeenCalledOnce();
  });
});
