import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import '../src/lookup-trigger';

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
    const handler = (e: Event): void => { capturedEvent = e as CustomEvent; };
    // Dispatch the triggering click from inside the shadow root so only a
    // composed:true custom event can reach this ancestor listener.
    document.body.addEventListener('lookup-click', handler);
    el.shadowRoot!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
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
});
