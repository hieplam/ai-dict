import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG, ICON_SHIELD } from './styles/tokens';
import { DEFAULT_OUTPUT_FORMAT, PROMPT_ENVELOPE } from '../domain/default-template';
import type { Provider, Theme } from '../domain/types';

export interface SettingsFormValue {
  provider: Provider;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  targetLang: string;
  outputFormat: string;
  // Full prompt envelope override (advanced, #62). '' = use the built-in envelope. The textarea
  // is prefilled with the real built-in envelope for editing, but '' is emitted until the user
  // actually edits it (or a legacy custom envelope was supplied).
  promptEnvelope: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  theme: Theme;
  // NOTE: `hasKey` and `configuredProviders` are intentionally absent — they are
  // derived fields computed on save/read and never emitted by the form's 'save' event.
}

// Per-provider copy for the single key row; the row morphs as the select changes
// so both keys are kept and switching providers never wipes the other key.
const KEY_LABEL: Record<Provider, string> = {
  gemini: 'Gemini API key',
  openai: 'OpenAI API key',
  anthropic: 'Anthropic (Claude) API key',
};

// Single source of truth for the "key comes from the build env" wording, shared
// by the inline hint here and the options-page banner so the two never drift.
export const ENV_KEY_NOTICE =
  'Gemini API key is loaded from the GEMINI_API_KEY build env. This field is ignored.';
// Resting copy under the locked field; focus/click swaps it for ENV_KEY_NOTICE.
const ENV_KEY_HINT = 'Locked — supplied by this build. Click to learn more.';
const DEFAULT_KEY_HELP = 'Stored locally on this device only.';
const ENV_KEY_PLACEHOLDER = 'Loaded from GEMINI_API_KEY build env';

// The Theme options the segmented control offers, in display order. Each maps 1:1 to a Theme.
const THEME_OPTIONS: ReadonlyArray<{ pref: Theme; label: string }> = [
  { pref: 'sepia', label: 'Sepia' },
  { pref: 'dark', label: 'Dark' },
  { pref: 'contrast', label: 'High Contrast' },
  { pref: 'system', label: 'Match system' },
];

// Settings is FULLY THEMED in Paperlight (hand-off §5.8, which supersedes any earlier "keep it
// native" guidance): the whole options page wears the --ad-* palette and re-themes live with the
// Theme picker, exactly like the card and side panel — there is no native browser-chrome surface
// left. The host folds in BASE_VARS (sepia default) + THEME_CSS, so stamping data-ad-theme on the
// host re-binds the entire page's semantic layer (not just color-scheme). Every control resolves to
// a token from the §5.8 mapping table; nothing references a CSS system color keyword.
const CSS = `:host{${BASE_VARS};display:block;min-height:100vh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-surface-sunken);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
header{display:flex;align-items:center;gap:8px;max-width:640px;margin:0 auto;padding:18px 22px 6px}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:22px;height:22px;flex:none}
.col{max-width:640px;margin:0 auto;padding:2px 22px 26px}
h1.title{font-family:var(--adp-font-serif);font-weight:var(--adp-weight-reg);font-size:1.9rem;line-height:1.15;letter-spacing:var(--adp-tracking-head);margin:.2em 0 .6em;color:var(--ad-ink)}
.sec{background:var(--ad-surface);border:1px solid var(--ad-line);border-radius:12px;padding:18px 20px;margin:0 0 16px}
.sec-h{margin:0 0 14px;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-bold);letter-spacing:.08em;text-transform:uppercase;color:var(--ad-ink-faint)}
label{display:block;margin:16px 0 7px;font-weight:var(--adp-weight-semi);font-size:var(--adp-text-sm);color:var(--ad-ink)}
.sec-h + label{margin-top:0}
label.check{display:flex;align-items:center;gap:10px;margin:6px 0;font-weight:var(--adp-weight-med);font-size:14px;color:var(--ad-ink);cursor:pointer}
label.check input{width:17px;height:17px;flex:none;accent-color:var(--ad-accent);cursor:pointer}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--ad-line-strong);border-radius:8px;background:var(--ad-surface-sunken);color:var(--ad-ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ad-accent);outline-offset:2px;border-color:var(--ad-accent)}
select{appearance:none;cursor:pointer;padding-right:36px;background:var(--ad-surface-sunken);background-image:linear-gradient(45deg,transparent 50%,var(--ad-ink-faint) 50%),linear-gradient(135deg,var(--ad-ink-faint) 50%,transparent 50%);background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
textarea{resize:vertical;font-family:var(--adp-font-mono);font-size:var(--adp-text-sm);line-height:1.55;color:var(--ad-ink-soft);min-height:72px}
.keyrow{display:flex;gap:8px;align-items:stretch}
.keyrow input{flex:1}
input.locked{background:var(--ad-surface-sunken);color:var(--ad-ink-faint);cursor:help}
#key-help,#tpl-help{margin:7px 0 0;font-size:var(--adp-text-xs);color:var(--ad-ink-faint)}
#tpl-help{margin:0 0 8px}
.env-notice{display:flex;gap:9px;margin:12px 0 0;padding:10px 13px;background:var(--ad-accent-soft);border-left:3px solid var(--ad-accent);border-radius:6px;font-size:var(--adp-text-sm);line-height:1.5;color:var(--ad-ink)}
.seg{display:inline-flex;flex-wrap:wrap;background:var(--ad-surface-sunken);border:1px solid var(--ad-line);border-radius:10px;padding:3px;gap:2px}
.seg button{appearance:none;border:0;cursor:pointer;font:inherit;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-semi);color:var(--ad-ink-soft);background:transparent;padding:7px 16px;border-radius:8px;white-space:nowrap;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
.seg button[aria-pressed="true"]{background:var(--ad-accent);color:var(--ad-on-accent)}
.seg button:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.seg-help{margin:10px 0 0;font-size:var(--adp-text-xs);color:var(--ad-ink-faint)}
@media (prefers-reduced-motion:reduce){.seg button{transition:none}}
.inline-actions{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:16px;padding-top:16px;border-top:1px dashed var(--ad-line-strong)}
button{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;padding:9px 16px;border-radius:8px;cursor:pointer;border:1px solid var(--ad-line-strong);background:transparent;color:var(--ad-ink);white-space:nowrap}
button:hover{background:var(--ad-surface-raised)}
button:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button.link{border:none;background:none;color:var(--ad-accent-ink);padding:0;font-size:14px;text-decoration:underline;text-underline-offset:2px}
button.link:hover{background:none;text-decoration:none}
.savebar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:4px}
button.primary{background:var(--ad-accent);border-color:transparent;color:var(--ad-on-accent);padding:11px 22px}
button.primary:hover{filter:brightness(1.06);background:var(--ad-accent)}
.savebar .muted{font-size:var(--adp-text-xs);color:var(--ad-ink-faint)}
#status{margin:16px 0 0;padding:12px 14px;border-radius:6px;border-left:3px solid var(--ad-accent);background:var(--ad-accent-soft);color:var(--ad-ink);font-size:14px;font-weight:var(--adp-weight-semi)}
#status.error{border-left-color:var(--ad-error);background:var(--ad-surface-raised);color:var(--ad-error)}
footer{display:flex;align-items:center;gap:6px;max-width:640px;margin:0 auto;padding:13px 22px 18px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
footer svg{width:13px;height:13px;flex:none}
details.advanced{margin:2px 0 0}
details.advanced>summary{cursor:pointer;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-semi);color:var(--ad-ink-soft);padding:6px 0;list-style:none;user-select:none}
details.advanced>summary::-webkit-details-marker{display:none}
details.advanced>summary::before{content:"▸";display:inline-block;margin-right:8px;color:var(--ad-ink-faint);transition:transform var(--adp-dur-fast) var(--adp-ease)}
details.advanced[open]>summary::before{transform:rotate(90deg)}
details.advanced>summary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px;border-radius:4px}
#envelope-help{margin:8px 0;font-size:var(--adp-text-xs);color:var(--ad-ink-faint)}
#envelope{min-height:180px}
@media (prefers-reduced-motion:reduce){details.advanced>summary::before{transition:none}}
[hidden]{display:none}`;

const MARKUP = `<header><span class="brand">${BRAND_MARK_SVG}<span>AI Dictionary</span></span></header>
<form>
  <div class="col">
    <h1 class="title">Settings</h1>
    <section class="sec" aria-labelledby="sec-conn">
      <h2 class="sec-h" id="sec-conn">Connection</h2>
      <label for="provider">AI provider</label>
      <select id="provider">
        <option value="gemini">Gemini (Google)</option>
        <option value="openai">ChatGPT (OpenAI)</option>
        <option value="anthropic">Claude (Anthropic)</option>
      </select>
      <label for="key" id="key-label">Gemini API key</label>
      <div class="keyrow">
        <input id="key" type="password" autocomplete="off" aria-describedby="key-help" />
        <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
      </div>
      <p id="key-help">Stored locally on this device only.</p>
      <p id="env-notice" class="env-notice" hidden></p>
      <div class="inline-actions">
        <button type="button" id="test">Test connection</button>
      </div>
    </section>
    <section class="sec" aria-labelledby="sec-trans">
      <h2 class="sec-h" id="sec-trans">Translation</h2>
      <label for="target">Target language</label>
      <select id="target"><option value="vi">Vietnamese</option><option value="en">English</option></select>
      <label for="tpl">Card format</label>
      <p id="tpl-help">Describe how the answer card is laid out. The selected word, its
        sentence, the page title, and the safety rules are always sent automatically.</p>
      <textarea id="tpl" rows="5"></textarea>
      <div class="inline-actions">
        <button type="button" id="reset-tpl">Restore default</button>
      </div>
      <details class="advanced">
        <summary>Advanced</summary>
        <p id="envelope-help">Full prompt envelope — placeholders: {word} {context} {target_lang}
          {source_lang} {title} {output_format}. Editing this takes over the built-in safety
          constraints. Leave it as-is to keep the default.</p>
        <textarea id="envelope" rows="10" spellcheck="false"></textarea>
        <div class="inline-actions">
          <button type="button" id="envelope-reset">Reset to default</button>
        </div>
      </details>
    </section>
    <section class="sec" aria-labelledby="sec-look">
      <h2 class="sec-h" id="sec-look">Appearance</h2>
      <label id="theme-label">Theme</label>
      <div class="seg" id="theme" role="group" aria-labelledby="theme-label">
        ${THEME_OPTIONS.map(
          (o) =>
            // Sepia is the default pressed segment until value hydration presses the stored theme.
            `<button type="button" data-pref="${o.pref}" aria-pressed="${o.pref === 'sepia'}">${o.label}</button>`,
        ).join('')}
      </div>
      <p class="seg-help">Changes how the lookup card and side panel look. Saved on this device only.</p>
    </section>
    <section class="sec" aria-labelledby="sec-priv">
      <h2 class="sec-h" id="sec-priv">Privacy &amp; data</h2>
      <label class="check"><input type="checkbox" id="cache" /> Cache lookups</label>
      <label class="check"><input type="checkbox" id="history" /> Save history</label>
      <label class="check"><input type="checkbox" id="error-reporting" /> Send anonymous error reports</label>
      <div class="inline-actions">
        <button type="button" id="clear-cache">Clear cache</button>
        <button type="button" id="clear-history">Clear history</button>
        <button type="button" id="export" class="link">Export history</button>
      </div>
    </section>
    <div class="savebar">
      <button type="submit" id="save" class="primary">Save settings</button>
      <span class="muted">Changes apply after saving</span>
    </div>
    <p id="status" role="status" aria-live="polite" hidden></p>
  </div>
</form>
<footer>${ICON_SHIELD}<span>Stays on your device</span></footer>`;

export class SettingsForm extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: SettingsFormValue | null = null;
  // When the build baked in GEMINI_API_KEY the stored Gemini key is irrelevant
  // (the SW ignores it), so the field is locked while Gemini is selected. We
  // still echo the stored key back on save so toggling this state never
  // silently wipes what the user had entered.
  private _keyFromEnv = false;
  private _errorReporting = false;
  private _provider: Provider = 'gemini';
  // One stash per provider; the visible #key field shows only the selected
  // provider's key and is committed back into the stash before any switch/save.
  private _keys: Record<Provider, string> = { gemini: '', openai: '', anthropic: '' };
  // The envelope textarea is prefilled with the built-in envelope for editing, so a non-empty
  // textarea does NOT by itself mean an override. This flag records whether the current textarea
  // content is a real override (a legacy custom envelope was hydrated, or the user typed) — only
  // then does `collect()` emit it; otherwise it emits '' (= "use the built-in envelope").
  private _envelopeEdited = false;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.root, CSS);
    this.root.innerHTML = MARKUP;

    this.q<HTMLButtonElement>('#reveal').addEventListener('click', () => {
      const key = this.q<HTMLInputElement>('#key');
      const revealBtn = this.q<HTMLButtonElement>('#reveal');
      key.type = key.type === 'password' ? 'text' : 'password';
      revealBtn.setAttribute('aria-label', key.type === 'text' ? 'Hide API key' : 'Reveal API key');
    });

    // A locked field is read-only (not `disabled`) precisely so it still takes
    // focus on tab/click — that is what lets us surface the full notice here.
    const key = this.q<HTMLInputElement>('#key');
    const help = this.q<HTMLElement>('#key-help');
    key.addEventListener('focus', () => {
      if (this.isKeyLocked()) help.textContent = ENV_KEY_NOTICE;
    });
    key.addEventListener('blur', () => {
      if (this.isKeyLocked()) help.textContent = ENV_KEY_HINT;
    });
    this.q<HTMLSelectElement>('#provider').addEventListener('change', () => {
      this.commitKeyField();
      this._provider = this.q<HTMLSelectElement>('#provider').value as Provider;
      this.syncKeyField();
    });
    // Live theme preview: the shadow CSS folds in THEME_CSS keyed on :host([data-ad-theme="…"]),
    // so stamping the host attribute the instant a segment is pressed re-themes the WHOLE page (the
    // --ad-* palette, not just color-scheme). Persistence still happens only on Save (the
    // composition root re-stamps the same attribute then).
    this.q<HTMLElement>('#theme').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pref]');
      if (!btn) return;
      this.setThemePref(btn.dataset['pref'] as Theme);
    });
    this.q<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.dispatchEvent(
        new CustomEvent<SettingsFormValue>('save', {
          detail: this.collect(),
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.relay('#test', 'test-connection');
    this.relay('#clear-cache', 'clear-cache');
    this.relay('#clear-history', 'clear-history');
    this.relay('#export', 'export-history');
    this.q<HTMLInputElement>('#error-reporting').addEventListener('change', () => {
      this.dispatchEvent(
        new CustomEvent<{ enabled: boolean }>('error-reporting-change', {
          detail: { enabled: this.q<HTMLInputElement>('#error-reporting').checked },
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.q<HTMLButtonElement>('#reset-tpl').addEventListener('click', () =>
      this.restoreDefaultTemplate(),
    );
    // Any edit to the envelope textarea promotes its content to a real override.
    this.q<HTMLTextAreaElement>('#envelope').addEventListener('input', () => {
      this._envelopeEdited = true;
    });
    this.q<HTMLButtonElement>('#envelope-reset').addEventListener('click', () =>
      this.resetEnvelope(),
    );

    if (this._pendingValue !== null) {
      this.value = this._pendingValue;
      this._pendingValue = null;
    }
    // Enforce the lock last so it wins over any value just hydrated above.
    this.syncKeyField();
    this.q<HTMLInputElement>('#error-reporting').checked = this._errorReporting;
  }

  /** Lock the Gemini key field because the build supplies GEMINI_API_KEY itself. */
  set keyFromEnv(on: boolean) {
    this._keyFromEnv = on;
    if (this.shadowRoot) this.syncKeyField();
  }
  get keyFromEnv(): boolean {
    return this._keyFromEnv;
  }

  /**
   * Current error-reporting consent (granted = checked). Wired to the errlog
   * consent store via the composition root, NOT the settings save flow — so it
   * is deliberately absent from SettingsFormValue/collect().
   */
  set errorReporting(on: boolean) {
    this._errorReporting = on;
    if (this.shadowRoot) this.q<HTMLInputElement>('#error-reporting').checked = on;
  }
  get errorReporting(): boolean {
    return this._errorReporting;
  }

  /** The env lock applies to the Gemini key only — OpenAI keys always come from the user. */
  private isKeyLocked(): boolean {
    return this._keyFromEnv && this._provider === 'gemini';
  }

  /** Stash the visible key into the selected provider's slot (locked field never overwrites). */
  private commitKeyField(): void {
    if (!this.isKeyLocked()) this._keys[this._provider] = this.q<HTMLInputElement>('#key').value;
  }

  /** The Theme currently pressed in the segmented control (defaults to sepia if none is). */
  private getThemePref(): Theme {
    const pressed = this.root.querySelector<HTMLButtonElement>(
      '#theme button[aria-pressed="true"]',
    );
    return (pressed?.dataset['pref'] as Theme) ?? 'sepia';
  }

  /** Press the segment for `pref` (clearing the others) and stamp it for the live preview. */
  private setThemePref(pref: Theme): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('#theme button[data-pref]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset['pref'] === pref));
    }
    this.setAttribute('data-ad-theme', pref);
  }

  /** Re-render the key row for the selected provider, including the env lock state. */
  private syncKeyField(): void {
    const key = this.q<HTMLInputElement>('#key');
    const reveal = this.q<HTMLButtonElement>('#reveal');
    const help = this.q<HTMLElement>('#key-help');
    const envNotice = this.q<HTMLElement>('#env-notice');
    this.q<HTMLElement>('#key-label').textContent = KEY_LABEL[this._provider];
    if (this.isKeyLocked()) {
      key.readOnly = true;
      key.value = '';
      key.type = 'text';
      key.placeholder = ENV_KEY_PLACEHOLDER;
      key.classList.add('locked');
      key.setAttribute('aria-readonly', 'true');
      reveal.hidden = true;
      help.textContent = ENV_KEY_HINT;
      envNotice.textContent = ENV_KEY_NOTICE;
      envNotice.hidden = false;
    } else {
      key.readOnly = false;
      key.type = 'password';
      this.q<HTMLButtonElement>('#reveal').setAttribute('aria-label', 'Reveal API key');
      key.value = this._keys[this._provider];
      key.placeholder = '';
      key.classList.remove('locked');
      key.removeAttribute('aria-readonly');
      reveal.hidden = false;
      help.textContent = DEFAULT_KEY_HELP;
      envNotice.hidden = true;
    }
  }

  /**
   * Surface the outcome of an action (save, test, clear, export) to the user.
   * Empty text hides the line. Text is set via textContent — never innerHTML —
   * so it can never inject model-influenced HTML (rule-sanitize-model-output).
   */
  setStatus(text: string, tone: 'ok' | 'error' = 'ok'): void {
    const status = this.q<HTMLElement>('#status');
    status.textContent = text;
    status.hidden = text.length === 0;
    status.classList.toggle('error', tone === 'error');
  }

  /**
   * Re-populate the card-format field with the shipped DEFAULT_OUTPUT_FORMAT.
   * Fills the field only — the user must still Save (matches the form's
   * "Changes apply after saving" contract). If the field already holds the
   * default there is nothing to lose, so we skip the confirm and just say so;
   * a customized field prompts a confirm() before its contents are replaced.
   */
  private restoreDefaultTemplate(): void {
    const tpl = this.q<HTMLTextAreaElement>('#tpl');
    if (tpl.value === DEFAULT_OUTPUT_FORMAT) {
      this.setStatus('Card format is already the default.');
      return;
    }
    const ok = window.confirm(
      'Replace your card format with the default? Your current format will be lost.',
    );
    if (!ok) return;
    tpl.value = DEFAULT_OUTPUT_FORMAT;
    this.setStatus('Card format restored — Save settings to apply.');
  }

  /**
   * Reset the Advanced envelope back to the built-in default: re-prefill the textarea with the
   * real `PROMPT_ENVELOPE` and clear the edited flag, so `collect()` emits '' (= "use built-in").
   * Fills the field only — the user must still Save (matches the form's apply-on-save contract).
   */
  private resetEnvelope(): void {
    this.q<HTMLTextAreaElement>('#envelope').value = PROMPT_ENVELOPE;
    this._envelopeEdited = false;
    this.setStatus('Envelope reset — Save settings to apply.');
  }

  private q<T extends Element>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`settings-form: missing ${sel}`);
    return el;
  }

  private relay(sel: string, event: string): void {
    this.q<HTMLButtonElement>(sel).addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
    });
  }

  private collect(): SettingsFormValue {
    // Stash the visible field first; a locked field never overwrites, so the
    // stored (env-superseded) Gemini key is echoed back unchanged.
    this.commitKeyField();
    return {
      provider: this._provider,
      apiKey: this._keys.gemini,
      openaiApiKey: this._keys.openai,
      anthropicApiKey: this._keys.anthropic,
      targetLang: this.q<HTMLSelectElement>('#target').value,
      outputFormat: this.q<HTMLTextAreaElement>('#tpl').value,
      // The prefilled built-in envelope is emitted as '' (use built-in) unless it's a real override.
      promptEnvelope: this._envelopeEdited ? this.q<HTMLTextAreaElement>('#envelope').value : '',
      cacheEnabled: this.q<HTMLInputElement>('#cache').checked,
      saveHistory: this.q<HTMLInputElement>('#history').checked,
      theme: this.getThemePref(),
    };
  }

  set value(v: SettingsFormValue) {
    if (!this.shadowRoot) {
      // Shadow not yet built — defer until connectedCallback flushes _pendingValue.
      this._pendingValue = v;
      return;
    }
    // Settings saved before the provider field existed lack provider/openaiApiKey.
    this._provider = v.provider ?? 'gemini';
    this._keys = {
      gemini: v.apiKey,
      openai: v.openaiApiKey ?? '',
      anthropic: v.anthropicApiKey ?? '',
    };
    this.q<HTMLSelectElement>('#provider').value = this._provider;
    this.q<HTMLSelectElement>('#target').value = v.targetLang;
    this.q<HTMLTextAreaElement>('#tpl').value = v.outputFormat;
    // Prefill-from-reality: an empty override shows the built-in envelope for editing but stays ''
    // on save; a supplied (legacy custom) override is shown verbatim and counts as edited.
    const hasOverride = (v.promptEnvelope ?? '') !== '';
    this.q<HTMLTextAreaElement>('#envelope').value = hasOverride
      ? v.promptEnvelope
      : PROMPT_ENVELOPE;
    this._envelopeEdited = hasOverride;
    this.q<HTMLInputElement>('#cache').checked = v.cacheEnabled;
    this.q<HTMLInputElement>('#history').checked = v.saveHistory;
    this.setThemePref(v.theme);
    // Render the key row for the (possibly changed) provider + lock state.
    this.syncKeyField();
  }
}
