import { describe, it, expect, vi, beforeAll } from 'vitest';
import { axeViolations } from './a11y';
import { SettingsForm, ENV_KEY_NOTICE, type SettingsFormValue } from '../../src/ui/settings-form';
import { registerSettingsForm } from '../../src/ui/register';
import { DEFAULT_OUTPUT_FORMAT } from '../../src/domain/default-template';

beforeAll(() => {
  registerSettingsForm();
  // happy-dom does not implement window.confirm; stub it so vi.spyOn can wrap it.
  if (typeof window.confirm !== 'function') {
    (window as unknown as Record<string, unknown>).confirm = () => false;
  }
});

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
    el.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value = 'AIza-test';
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured).toMatchObject({
      apiKey: 'AIza-test',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
    });
  });

  it('emits the four action events', () => {
    const el = mountForm();
    const events = ['clear-cache', 'clear-history', 'test-connection', 'export-history'] as const;
    const captured = new Map<string, Event>();
    const spies = Object.fromEntries(
      events.map((n) => [
        n,
        vi.fn((e: Event) => {
          captured.set(n, e);
        }),
      ]),
    );
    for (const n of events) el.addEventListener(n, spies[n]!);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-cache')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#clear-history')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#test')!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>('#export')!.click();
    for (const n of events) {
      expect(spies[n]!).toHaveBeenCalledOnce();
      // Assert the frozen cross-bundle event-name contract.
      expect(captured.get(n)!.type).toBe(n);
    }
  });

  it('setStatus shows the message text and reveals the status line', () => {
    const el = mountForm();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(true); // hidden until something to say
    el.setStatus('Settings saved');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Settings saved');
    // Announced to assistive tech as a polite live region.
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('setStatus with the error tone marks the status as an error', () => {
    const el = mountForm();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    el.setStatus('Connection failed', 'error');
    expect(status.textContent).toBe('Connection failed');
    expect(status.classList.contains('error')).toBe(true);
  });

  it('setStatus clears the error tone when a success message follows', () => {
    const el = mountForm();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    el.setStatus('Connection failed', 'error');
    el.setStatus('Connection OK');
    expect(status.classList.contains('error')).toBe(false);
    expect(status.textContent).toBe('Connection OK');
  });

  it('setStatus with empty text hides the status line', () => {
    const el = mountForm();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    el.setStatus('Saved');
    el.setStatus('');
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
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
    el.value = {
      provider: 'gemini',
      apiKey: 'deferred-key',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'en',
      outputFormat: 'P',
      cacheEnabled: false,
      saveHistory: false,
      theme: 'sepia',
    };
    document.body.append(el); // connectedCallback flushes pending value
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value).toBe('deferred-key');
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#target')!.value).toBe('en');
  });

  it('four action events cross shadow boundary (composed: true)', () => {
    const el = mountForm();
    const actionMap = [
      ['clear-cache', '#clear-cache'],
      ['clear-history', '#clear-history'],
      ['test-connection', '#test'],
      ['export-history', '#export'],
    ] as const;
    const captured: Map<string, CustomEvent> = new Map();
    const handlers: Map<string, EventListener> = new Map();

    for (const [name] of actionMap) {
      const h: EventListener = (e) => {
        captured.set(name, e as CustomEvent);
      };
      handlers.set(name, h);
      document.body.addEventListener(name, h);
    }

    for (const [, sel] of actionMap) {
      el.shadowRoot!.querySelector<HTMLButtonElement>(sel)!.click();
    }

    for (const [name] of actionMap) {
      document.body.removeEventListener(name, handlers.get(name)!);
      const evt = captured.get(name);
      expect(evt, `${name} must reach document.body`).toBeDefined();
      expect(evt!.composed, `${name} must be composed:true`).toBe(true);
    }
  });

  it('"save" event crosses shadow boundary (composed: true)', () => {
    const el = mountForm();
    let capturedEvent: CustomEvent | null = null;
    const handler: EventListener = (e) => {
      capturedEvent = e as CustomEvent;
    };
    // Trigger submit on the shadow-internal <form>; composed:true on the
    // custom 'save' event is what allows it to reach this ancestor listener.
    document.body.addEventListener('save', handler);
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    document.body.removeEventListener('save', handler);
    expect(capturedEvent).not.toBeNull();
    // Verify the dispatched custom event carries composed:true so a change to
    // {composed:false} in the implementation would make this assertion red.
    expect(capturedEvent!.composed).toBe(true);
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

describe('<settings-form> restore default prompt', () => {
  it('restores the default after confirm when the field was customized', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'my custom prompt',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    expect(tpl.value).toBe(DEFAULT_OUTPUT_FORMAT);
    expect(confirmSpy).toHaveBeenCalledOnce();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.textContent).toBe('Card format restored — Save settings to apply.');
    confirmSpy.mockRestore();
  });

  it('leaves the template unchanged when the confirm is cancelled', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'my custom prompt',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    const tpl = el.shadowRoot!.querySelector<HTMLTextAreaElement>('#tpl')!;
    expect(tpl.value).toBe('my custom prompt');
    expect(confirmSpy).toHaveBeenCalledOnce();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.hidden).toBe(true); // no status on user cancel
    confirmSpy.mockRestore();
  });

  it('does not prompt when the template already equals the default', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    const confirmSpy = vi.spyOn(window, 'confirm');
    el.shadowRoot!.querySelector<HTMLButtonElement>('#reset-tpl')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    const status = el.shadowRoot!.querySelector<HTMLElement>('#status')!;
    expect(status.textContent).toBe('Card format is already the default.');
    confirmSpy.mockRestore();
  });
});

describe('<settings-form> env-key lock', () => {
  it('locks the key field, hides reveal, and marks it read-only when keyFromEnv is set', () => {
    const el = mountForm();
    el.keyFromEnv = true;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    const reveal = el.shadowRoot!.querySelector<HTMLButtonElement>('#reveal')!;
    expect(key.readOnly).toBe(true);
    expect(key.getAttribute('aria-readonly')).toBe('true');
    expect(key.classList.contains('locked')).toBe(true);
    expect(reveal.hidden).toBe(true);
  });

  it('reveals the full env notice on focus and reverts on blur', () => {
    const el = mountForm();
    el.keyFromEnv = true;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    const help = el.shadowRoot!.querySelector<HTMLElement>('#key-help')!;
    const hint = help.textContent;
    expect(hint).not.toBe(ENV_KEY_NOTICE);
    key.dispatchEvent(new Event('focus'));
    expect(help.textContent).toBe(ENV_KEY_NOTICE);
    key.dispatchEvent(new Event('blur'));
    expect(help.textContent).toBe(hint);
  });

  it('preserves the stored key on save so locking never wipes it', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: 'AIza-stored',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    el.keyFromEnv = true;
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured!.apiKey).toBe('AIza-stored');
  });

  it('does not display the stored key value while locked', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: 'AIza-stored',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    el.keyFromEnv = true;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(key.value).toBe('');
    expect(key.placeholder.length).toBeGreaterThan(0);
  });

  it('keyFromEnv set before connect applies the lock after hydration', () => {
    const el = document.createElement('settings-form') as SettingsForm;
    el.keyFromEnv = true;
    document.body.append(el);
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(key.readOnly).toBe(true);
  });

  it('has no axe violations while locked', async () => {
    const el = mountForm();
    el.keyFromEnv = true;
    expect(await axeViolations(el)).toEqual([]);
  });
});

describe('<settings-form> provider selection', () => {
  function valueWith(over: Partial<SettingsFormValue>): SettingsFormValue {
    return {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
      ...over,
    };
  }

  it('offers Gemini and OpenAI and defaults to Gemini', () => {
    const el = mountForm();
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    expect(select.value).toBe('gemini');
    expect([...select.options].map((o) => o.value)).toEqual(['gemini', 'openai', 'anthropic']);
    expect(el.shadowRoot!.querySelector('#key-label')!.textContent).toBe('Gemini API key');
  });

  it('switching provider swaps the key field label and value without losing either key', () => {
    const el = mountForm();
    el.value = valueWith({ apiKey: 'AIza-g', openaiApiKey: 'sk-o' });
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    expect(key.value).toBe('AIza-g');
    select.value = 'openai';
    select.dispatchEvent(new Event('change'));
    expect(el.shadowRoot!.querySelector('#key-label')!.textContent).toBe('OpenAI API key');
    expect(key.value).toBe('sk-o');
    select.value = 'gemini';
    select.dispatchEvent(new Event('change'));
    expect(key.value).toBe('AIza-g');
  });

  it('edits made before a switch are stashed and emitted on save', () => {
    const el = mountForm();
    el.value = valueWith({});
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    key.value = 'AIza-typed';
    select.value = 'openai';
    select.dispatchEvent(new Event('change'));
    key.value = 'sk-typed';
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured).toMatchObject({
      provider: 'openai',
      apiKey: 'AIza-typed',
      openaiApiKey: 'sk-typed',
    });
  });

  it('hydrating with provider openai renders the OpenAI key', () => {
    const el = mountForm();
    el.value = valueWith({ provider: 'openai', apiKey: 'AIza-g', openaiApiKey: 'sk-o' });
    expect(el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!.value).toBe('openai');
    expect(el.shadowRoot!.querySelector<HTMLInputElement>('#key')!.value).toBe('sk-o');
    expect(el.shadowRoot!.querySelector('#key-label')!.textContent).toBe('OpenAI API key');
  });

  it('env-key lock applies to Gemini only — switching to OpenAI unlocks the field', () => {
    const el = mountForm();
    el.value = valueWith({ apiKey: 'AIza-stored', openaiApiKey: 'sk-o' });
    el.keyFromEnv = true;
    const key = el.shadowRoot!.querySelector<HTMLInputElement>('#key')!;
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('#provider')!;
    expect(key.readOnly).toBe(true);
    select.value = 'openai';
    select.dispatchEvent(new Event('change'));
    expect(key.readOnly).toBe(false);
    expect(key.value).toBe('sk-o');
    expect(el.shadowRoot!.querySelector<HTMLElement>('#env-notice')!.hidden).toBe(true);
    // back to gemini → locked again, stored key still echoed on save
    select.value = 'gemini';
    select.dispatchEvent(new Event('change'));
    expect(key.readOnly).toBe(true);
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured!.apiKey).toBe('AIza-stored');
    expect(captured!.openaiApiKey).toBe('sk-o');
  });

  it('has no axe violations with the provider select present', async () => {
    const el = mountForm();
    expect(await axeViolations(el)).toEqual([]);
  });
});

describe('<settings-form> error-reporting toggle', () => {
  it('reflects errorReporting consent and emits error-reporting-change on toggle', () => {
    const form = mountForm();
    // give it a minimal value so it renders
    form.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'x',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
    };
    form.errorReporting = true;
    const checkbox = form.shadowRoot!.querySelector('#error-reporting') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    let emitted: { enabled: boolean } | undefined;
    form.addEventListener('error-reporting-change', (e: Event) => {
      emitted = (e as CustomEvent<{ enabled: boolean }>).detail;
    });
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(emitted).toEqual({ enabled: false });
  });
});

describe('<settings-form> fully themed (§5.8)', () => {
  it('renders the brand, mark, and device footer (no festive ribbon)', () => {
    const el = mountForm();
    const r = el.shadowRoot!;
    // §5.8 retires the festive ribbon; the Settings mock has no accent strip either.
    expect(r.querySelector('.ribbon')).toBeNull();
    expect(r.querySelector('.accent')).toBeNull();
    expect(r.querySelector('.brand')!.textContent).toContain('AI Dictionary');
    expect(r.querySelector('.mark')).not.toBeNull();
    expect(r.querySelector('footer')!.textContent).toContain('Stays on your device');
  });

  it('wears the --ad-* palette and leaves no native CSS system-color chrome (§5.8 bug guard)', () => {
    const el = mountForm();
    const css = [...el.shadowRoot!.adoptedStyleSheets[0]!.cssRules]
      .map((r) => r.cssText)
      .join('\n');
    // The page must read the Paperlight semantic tokens…
    expect(css).toContain('--ad-surface');
    expect(css).toContain('--ad-accent');
    // …and never fall back to browser-default system colors (§5.8: "if any control still shows
    // browser-default chrome, it is a bug").
    for (const sysColor of [
      'Canvas',
      'CanvasText',
      'ButtonFace',
      'ButtonText',
      'ButtonBorder',
      'Field',
      'GrayText',
      'LinkText',
      'AccentColor',
    ]) {
      expect(css, `must not use the native system color ${sysColor}`).not.toMatch(
        new RegExp(`[:\\s,(]${sysColor}\\b`),
      );
    }
  });

  it('groups controls into Connection, Translation, Appearance, and Privacy & data sections', () => {
    const el = mountForm();
    const heads = [...el.shadowRoot!.querySelectorAll('.sec .sec-h')].map((h) => h.textContent);
    expect(heads).toEqual(['Connection', 'Translation', 'Appearance', 'Privacy & data']);
  });

  it('keeps every required control (incl. #status) inside the redesigned markup', () => {
    const el = mountForm();
    const r = el.shadowRoot!;
    for (const sel of [
      '#key',
      '#reveal',
      '#target',
      '#tpl',
      '#reset-tpl',
      '#theme',
      '#cache',
      '#history',
      '#save',
      '#test',
      '#clear-cache',
      '#clear-history',
      '#export',
      '#key-help',
      '#status',
    ]) {
      expect(r.querySelector(sel), `${sel} must still exist`).not.toBeNull();
    }
  });

  it('uses a single adopted stylesheet', () => {
    const el = mountForm();
    expect(el.shadowRoot!.adoptedStyleSheets.length).toBe(1);
  });

  it('renders a segmented Theme control defaulting to sepia, offering dark + contrast + system', () => {
    const el = mountForm();
    // §5.8 / reference Settings mock: the Theme control is a segmented group of aria-pressed
    // buttons, not a native <select>.
    const seg = el.shadowRoot!.querySelector<HTMLElement>('#theme')!;
    expect(seg.getAttribute('role')).toBe('group');
    const buttons = [...seg.querySelectorAll<HTMLButtonElement>('button[data-pref]')];
    expect(buttons.map((b) => b.dataset.pref)).toEqual(['sepia', 'dark', 'contrast', 'system']);
    // Default = sepia pressed, the rest unpressed.
    expect(buttons.find((b) => b.getAttribute('aria-pressed') === 'true')!.dataset.pref).toBe(
      'sepia',
    );
  });

  it('round-trips the theme through value (pressed segment) and the save event', () => {
    const el = mountForm();
    el.value = {
      provider: 'gemini',
      apiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      targetLang: 'vi',
      outputFormat: 'T',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'dark',
    };
    const pressed = el.shadowRoot!.querySelector<HTMLButtonElement>(
      '#theme button[aria-pressed="true"]',
    )!;
    expect(pressed.dataset.pref).toBe('dark');
    let captured: SettingsFormValue | undefined;
    el.addEventListener('save', (e) => {
      captured = (e as CustomEvent<SettingsFormValue>).detail;
    });
    el.shadowRoot!.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(captured!.theme).toBe('dark');
  });

  it('keeps the env notice hidden until keyFromEnv is set', () => {
    const el = mountForm();
    const notice = el.shadowRoot!.querySelector<HTMLElement>('#env-notice')!;
    expect(notice.hidden).toBe(true);
    el.keyFromEnv = true;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(ENV_KEY_NOTICE);
  });

  it('applies the picked theme to the host immediately on press — live preview, before Save (issue #51)', () => {
    // The host CSS folds in THEME_CSS keyed off :host([data-ad-theme="…"]), so stamping the host
    // attribute the instant a segment is pressed re-themes the whole page. Persistence on Save.
    const el = mountForm();
    const seg = el.shadowRoot!.querySelector<HTMLElement>('#theme')!;
    for (const value of ['dark', 'system', 'contrast', 'sepia'] as const) {
      const btn = seg.querySelector<HTMLButtonElement>(`button[data-pref="${value}"]`)!;
      btn.click();
      expect(el.getAttribute('data-ad-theme')).toBe(value);
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    }
  });
});
