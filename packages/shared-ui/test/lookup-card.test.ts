import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import { LookupCard } from '../src/lookup-card';
import '../src/lookup-card';

function mountCard(): LookupCard {
  const el = document.createElement('lookup-card') as LookupCard;
  document.body.append(el);
  return el;
}

describe('<lookup-card>', () => {
  it('has an aria-live region and loading state by default', () => {
    const el = mountCard();
    const region = el.shadowRoot!.querySelector('[aria-live="polite"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Looking up');
  });

  it('renders a result with a heading and the pre-sanitized body', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: '<p>money place</p>' };
    const root = el.shadowRoot!;
    expect(root.querySelector('h2')!.textContent).toBe('bank');
    expect(root.querySelector('[aria-live]')!.innerHTML).toContain('money place');
  });

  it('renders an error message', () => {
    const el = mountCard();
    el.state = { kind: 'error', error: { code: 'NETWORK', message: 'Network failed.', retryable: true } };
    expect(el.shadowRoot!.querySelector('.err')!.textContent).toBe('Network failed.');
  });

  it('emits "close" and "expand"', () => {
    const el = mountCard();
    const close = vi.fn(); const expand = vi.fn();
    el.addEventListener('close', close); el.addEventListener('expand', expand);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="expand"]')!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('state setter before connect is a no-op render (no shadowRoot crash)', () => {
    // Set state before appending to DOM: region is null, render should be skipped
    const el = document.createElement('lookup-card') as LookupCard;
    el.state = { kind: 'result', word: 'test', target: 'vi', safeHtml: '<p>hi</p>' };
    // Now connect — should render the pre-set state
    document.body.append(el);
    expect(el.shadowRoot!.querySelector('h2')!.textContent).toBe('test');
  });

  it('does not re-initialize shadow on second connectedCallback', () => {
    const el = mountCard();
    document.body.removeChild(el);
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('has no axe violations (loading state)', async () => {
    const el = mountCard();
    expect(await axeViolations(el)).toEqual([]);
  });
});
