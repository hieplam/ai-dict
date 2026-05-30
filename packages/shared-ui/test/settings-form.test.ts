import { describe, it, expect, vi } from 'vitest';
import { axeViolations } from './a11y';
import { SettingsForm, type SettingsFormValue } from '../src/settings-form';
import '../src/settings-form';

function mountForm(): SettingsForm {
  const el = document.createElement('settings-form') as SettingsForm;
  document.body.append(el);
  return el;
}

describe('<settings-form>', () => {
  it('masks the API key and toggles reveal', () => {
    const el = mountForm();
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(key.type).toBe('password');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!.click();
    expect(key.type).toBe('text');
  });

  it('emits "save" with the collected form value', () => {
    const el = mountForm();
    el.value = { apiKey: '', targetLang: 'vi', promptTemplate: 'T', cacheEnabled: true, saveHistory: true };
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => { captured = (e as CustomEvent<SettingsFormValue>).detail; });
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value = 'AIza-test';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(captured).toMatchObject({ apiKey: 'AIza-test', targetLang: 'vi', promptTemplate: 'T', cacheEnabled: true, saveHistory: true });
  });

  it('emits the four action events', () => {
    const el = mountForm();
    const events = ['clear-cache', 'clear-history', 'test-connection', 'export-history'] as const;
    const spies = Object.fromEntries(events.map((n) => [n, vi.fn()]));
    for (const n of events) el.addEventListener(n, spies[n]!);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-cache')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-history')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#test')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#export')!.click();
    for (const n of events) expect(spies[n]!).toHaveBeenCalledOnce();
  });

  it('reveal toggles back to password on second click', () => {
    const el = mountForm();
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!.click(); // → text
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!.click(); // → password
    expect(key.type).toBe('password');
  });

  it('reveal button updates aria-label to reflect current state', () => {
    const el = mountForm();
    const revealBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!;
    expect(revealBtn.getAttribute('aria-label')).toBe('Reveal API key');
    revealBtn.click(); // now revealed
    expect(revealBtn.getAttribute('aria-label')).toBe('Hide API key');
    revealBtn.click(); // back to hidden
    expect(revealBtn.getAttribute('aria-label')).toBe('Reveal API key');
  });

  it('value setter before connect defers hydration until connectedCallback', () => {
    const el = document.createElement('settings-form') as SettingsForm;
    // Set value before appending to DOM (no shadowRoot yet) — must not throw
    el.value = { apiKey: 'deferred-key', targetLang: 'es', promptTemplate: 'P', cacheEnabled: false, saveHistory: false };
    document.body.append(el); // connectedCallback flushes pending value
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value).toBe('deferred-key');
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#target')!.value).toBe('es');
  });

  it('"save" event crosses shadow boundary (composed: true)', () => {
    const el = mountForm();
    const spy = vi.fn();
    // Attach to an ancestor outside the shadow host — only receives if composed: true
    document.body.addEventListener('save', spy);
    el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    document.body.removeEventListener('save', spy);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does not re-initialize shadow on second connectedCallback', () => {
    const el = mountForm();
    document.body.removeChild(el);
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('form').length).toBe(1);
  });

  it('has no axe violations', async () => {
    const el = mountForm();
    expect(await axeViolations(el)).toEqual([]);
  });
});
