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
    expect(btn.getAttribute('role')).toBe('button');
  });

  it('emits a composed "lookup-click" on activation', () => {
    const el = mount('lookup-trigger');
    const spy = vi.fn();
    el.addEventListener('lookup-click', spy);
    el.shadowRoot!.querySelector('button')!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const el = mount('lookup-trigger');
    expect(await axeViolations(el)).toEqual([]);
  });
});
