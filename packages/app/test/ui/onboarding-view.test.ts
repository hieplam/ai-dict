import { describe, it, expect, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { OnboardingView, GET_KEY_URL, type OnboardingValue } from '../../src/ui/onboarding-view';
import { registerOnboarding } from '../../src/ui/register';

beforeAll(() => {
  registerOnboarding();
});

function mount(): OnboardingView {
  const el = document.createElement('onboarding-view') as OnboardingView;
  document.body.append(el);
  return el;
}

describe('<onboarding-view>', () => {
  it('renders the Paperlight chrome: accent strip, brand mark, welcome heading, privacy footer', () => {
    const r = mount().shadowRoot!;
    expect(r.querySelector('.accent')).not.toBeNull();
    expect(r.querySelector('.brand')!.textContent).toContain('AI Dictionary');
    expect(r.querySelector('.mark')).not.toBeNull();
    expect(r.querySelector('h1.title')!.textContent).toMatch(/welcome/i);
    expect(r.querySelector('footer')!.textContent).toContain('Stays on your device');
  });

  it('points the reader at a free key with a new-tab link to Google AI Studio', () => {
    const link = mount().shadowRoot!.querySelector<HTMLAnchorElement>('#getkey')!;
    expect(link.getAttribute('href')).toBe(GET_KEY_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    // Opening an extension page's link to a new tab without noopener is a tabnabbing risk.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toMatch(/get a free api key/i);
  });

  it('shows what is done vs missing: language ready, key still needed', () => {
    const r = mount().shadowRoot!;
    expect(r.querySelector('#step-lang')!.classList.contains('done')).toBe(true);
    expect(r.querySelector('#step-key')!.classList.contains('todo')).toBe(true);
    expect(r.querySelector('#progress')!.textContent).toBe('1 of 2 ready');
  });

  it('advances progress the moment a key is pasted', () => {
    const el = mount();
    const r = el.shadowRoot!;
    const key = r.querySelector<HTMLInputElement>('#key')!;
    key.value = 'AIza-typed';
    key.dispatchEvent(new Event('input'));
    expect(r.querySelector('#step-key')!.classList.contains('done')).toBe(true);
    expect(r.querySelector('#progress')!.textContent).toMatch(/2 of 2/);
  });

  it('masks the key and toggles reveal', () => {
    const r = mount().shadowRoot!;
    const key = r.querySelector<HTMLInputElement>('#key')!;
    expect(key.type).toBe('password');
    r.querySelector<HTMLButtonElement>('#reveal')!.click();
    expect(key.type).toBe('text');
    r.querySelector<HTMLButtonElement>('#reveal')!.click();
    expect(key.type).toBe('password');
  });

  it('emits "save" with the trimmed key and chosen language on activate', () => {
    const el = mount();
    const r = el.shadowRoot!;
    r.querySelector<HTMLInputElement>('#key')!.value = '  AIza-real  ';
    r.querySelector<HTMLSelectElement>('#target')!.value = 'en';
    let captured: OnboardingValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<OnboardingValue>).detail;
    });
    r.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured).toEqual({ apiKey: 'AIza-real', targetLang: 'en' });
  });

  it('blocks activation with an error when the key is empty (no save emitted)', () => {
    const el = mount();
    let fired = false;
    el.addEventListener('save', () => {
      fired = true;
    });
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(fired).toBe(false);
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(false);
    expect(status.classList.contains('error')).toBe(true);
  });

  it('"save" crosses the shadow boundary (composed: true)', () => {
    const el = mount();
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value = 'AIza-x';
    let evt: CustomEvent | null = null;
    const handler = (e: Event): void => {
      evt = e as CustomEvent;
    };
    document.body.addEventListener('save', handler);
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    document.body.removeEventListener('save', handler);
    expect(evt).not.toBeNull();
    expect(evt!.composed).toBe(true);
  });

  it('value setter hydrates the language select and key field', () => {
    const el = mount();
    el.value = { apiKey: 'AIza-seed', targetLang: 'en' };
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#target')!.value).toBe('en');
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value).toBe('AIza-seed');
  });

  it('value set before connect defers hydration until connectedCallback', () => {
    const el = document.createElement('onboarding-view') as OnboardingView;
    el.value = { apiKey: '', targetLang: 'en' };
    document.body.append(el);
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#target')!.value).toBe('en');
  });

  it('setStatus shows, errors, and hides the status line', () => {
    const el = mount();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(true);
    el.setStatus('Could not save', 'error');
    expect(status.hidden).toBe(false);
    expect(status.classList.contains('error')).toBe(true);
    el.setStatus('');
    expect(status.hidden).toBe(true);
  });

  it('uses a single adopted stylesheet', () => {
    expect(mount().shadowRoot!.adoptedStyleSheets.length).toBe(1);
  });

  it('does not re-initialize the shadow on reconnect', () => {
    const el = mount();
    document.body.removeChild(el);
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('form').length).toBe(1);
  });

  it('has no axe violations', async () => {
    expect(await axeViolations(mount())).toEqual([]);
  });

  it('setBusy(true) disables both buttons, relabels activate, and hides any prior save-anyway (C2)', () => {
    const el = mount();
    const r = el.shadowRoot!;
    el.showSaveAnyway(true);
    el.setBusy(true);
    const activate = r.querySelector<HTMLButtonElement>('#activate')!;
    const saveAnyway = r.querySelector<HTMLButtonElement>('#save-anyway')!;
    expect(activate.disabled).toBe(true);
    expect(activate.textContent).toBe('Activating…');
    expect(saveAnyway.disabled).toBe(true);
    expect(saveAnyway.hidden).toBe(true);
  });

  it('setBusy(false) restores the activate button label and enabled state (C2)', () => {
    const el = mount();
    const r = el.shadowRoot!;
    el.setBusy(true);
    el.setBusy(false);
    const activate = r.querySelector<HTMLButtonElement>('#activate')!;
    expect(activate.disabled).toBe(false);
    expect(activate.textContent).toBe('Save & activate');
  });

  it("showSaveAnyway toggles the escape-hatch button's hidden state (C2)", () => {
    const el = mount();
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('#save-anyway')!;
    expect(btn.hidden).toBe(true);
    el.showSaveAnyway(true);
    expect(btn.hidden).toBe(false);
    el.showSaveAnyway(false);
    expect(btn.hidden).toBe(true);
  });

  it('submit() is a no-op while busy — no second "save" event fires (C2)', () => {
    const el = mount();
    const r = el.shadowRoot!;
    r.querySelector<HTMLInputElement>('#key')!.value = 'AIza-x';
    let count = 0;
    el.addEventListener('save', () => count++);
    r.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(count).toBe(1);
    r.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(count).toBe(1); // setBusy(true) fired on the first submit; the second is swallowed
  });

  it('clicking "Save anyway" emits a composed save-anyway event with the trimmed key/language (C2)', () => {
    const el = mount();
    const r = el.shadowRoot!;
    r.querySelector<HTMLInputElement>('#key')!.value = '  AIza-real  ';
    r.querySelector<HTMLSelectElement>('#target')!.value = 'en';
    let captured: OnboardingValue | undefined;
    document.body.addEventListener('save-anyway', (e) => {
      captured = (e as CustomEvent<OnboardingValue>).detail;
    });
    r.querySelector<HTMLButtonElement>('#save-anyway')!.click();
    expect(captured).toEqual({ apiKey: 'AIza-real', targetLang: 'en' });
  });

  it('"Save anyway" blocks on an empty key with the same inline error as Save & activate (C2)', () => {
    const el = mount();
    let fired = false;
    el.addEventListener('save-anyway', () => {
      fired = true;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('#save-anyway')!.click();
    expect(fired).toBe(false);
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(false);
    expect(status.classList.contains('error')).toBe(true);
  });
});
