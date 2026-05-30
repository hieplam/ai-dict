import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import '../src/bottom-sheet';

function mountSheet(): HTMLElement {
  const el = document.createElement('bottom-sheet');
  el.innerHTML = '<button id="a">a</button><button id="b">b</button>';
  document.body.append(el); // connectedCallback wires ARIA + focus
  return el;
}

describe('<bottom-sheet>', () => {
  it('exposes a labelled modal dialog', () => {
    const el = mountSheet();
    const dialog = el.shadowRoot!.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('dismisses on Escape and on scrim click', () => {
    const el = mountSheet();
    const spy = vi.fn();
    el.addEventListener('dismiss', spy);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.shadowRoot!.querySelector('.scrim')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('traps Tab focus within its focusables', () => {
    const el = mountSheet();
    const a = el.querySelector<HTMLButtonElement>('#a')!;
    const b = el.querySelector<HTMLButtonElement>('#b')!;
    b.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(a); // wrapped last → first
  });

  it('restores focus to the opener on disconnect', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const el = mountSheet();
    el.remove();
    expect(document.activeElement).toBe(opener);
  });

  it('marks reduced-motion when the user prefers it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = mountSheet();
    expect(el.hasAttribute('reduced')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('wraps Shift+Tab from first focusable to last', () => {
    const el = mountSheet();
    const a = el.querySelector<HTMLButtonElement>('#a')!;
    const b = el.querySelector<HTMLButtonElement>('#b')!;
    a.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(b); // wrapped first → last
  });

  it('ignores Tab when not on a boundary focusable', () => {
    const el = mountSheet();
    const a = el.querySelector<HTMLButtonElement>('#a')!;
    // focus the first element, then Tab forward (not at last)
    // Add an extra button so "a" is not the last
    const c = document.createElement('button');
    c.id = 'c';
    el.append(c);
    a.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    // focus should NOT have been moved by trapFocus (a is not the last)
    expect(document.activeElement).toBe(a);
  });

  it('does not skip shadowRoot guard on second connect', () => {
    const el = mountSheet();
    // Remove and re-append: shadowRoot should already exist, connectedCallback guard fires
    document.body.removeChild(el);
    document.body.append(el);
    // Should still have exactly one dialog (not duplicated)
    expect(el.shadowRoot!.querySelectorAll('[role="dialog"]').length).toBe(1);
  });

  it('Escape still dismisses after remove+reappend cycle', () => {
    const el = mountSheet();
    document.body.removeChild(el);
    document.body.append(el); // re-connection — listener must be re-registered
    const spy = vi.fn();
    el.addEventListener('dismiss', spy);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('handles missing matchMedia gracefully (no reduced attr)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const el = mountSheet();
    expect(el.hasAttribute('reduced')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('"dismiss" event crosses shadow boundary (composed: true)', () => {
    const el = mountSheet();
    const spy = vi.fn();
    // Attach to an ancestor outside the shadow host — only receives if composed: true
    document.body.addEventListener('dismiss', spy);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.removeEventListener('dismiss', spy);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const el = mountSheet();
    expect(await axeViolations(el)).toEqual([]);
  });
});
