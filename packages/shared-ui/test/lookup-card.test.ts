import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import { LookupCard, type SafeHtml } from '../src/lookup-card';
import '../src/lookup-card';

/** Cast a trusted literal to SafeHtml for test fixtures only. */
const safe = (html: string) => html as SafeHtml;

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
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>money place</p>') };
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
    let closeEvt: Event | null = null;
    let expandEvt: Event | null = null;
    const close = vi.fn((e: Event) => { closeEvt = e; });
    const expand = vi.fn((e: Event) => { expandEvt = e; });
    el.addEventListener('close', close); el.addEventListener('expand', expand);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="expand"]')!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
    // Assert the frozen cross-bundle event-name contract.
    expect(closeEvt!.type).toBe('close');
    expect(expandEvt!.type).toBe('expand');
  });

  it('state setter before connect is a no-op render (no shadowRoot crash)', () => {
    // Set state before appending to DOM: region is null, render should be skipped
    const el = document.createElement('lookup-card') as LookupCard;
    el.state = { kind: 'result', word: 'test', target: 'vi', safeHtml: safe('<p>hi</p>') };
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

  it('"close" event crosses shadow boundary (composed: true)', () => {
    const el = mountCard();
    let capturedEvent: CustomEvent | null = null;
    const handler = (e: Event): void => { capturedEvent = e as CustomEvent; };
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

  it('"expand" event crosses shadow boundary (composed: true)', () => {
    const el = mountCard();
    let capturedEvent: CustomEvent | null = null;
    const handler = (e: Event): void => { capturedEvent = e as CustomEvent; };
    // Mirror of the 'close' boundary test: listener on document.body must
    // receive the event dispatched by the in-shadow expand button so that
    // a regression to composed:false would turn this red.
    document.body.addEventListener('expand', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-act="expand"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    document.body.removeEventListener('expand', handler);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.composed).toBe(true);
    expect(capturedEvent!.bubbles).toBe(true);
  });

  it('has no axe violations (loading state)', async () => {
    const el = mountCard();
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
