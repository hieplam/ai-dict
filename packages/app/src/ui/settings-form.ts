import { adoptStyles } from './styles/adopt';

export interface SettingsFormValue {
  apiKey: string;
  targetLang: string;
  promptTemplate: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
  // NOTE: `hasKey` is intentionally absent — it is a derived field computed by
  // the storage adapter as `Boolean(apiKey)` on read and is never emitted by
  // the form's 'save' event.
}

// Single source of truth for the "key comes from the build env" wording, shared
// by the inline hint here and the options-page banner so the two never drift.
export const ENV_KEY_NOTICE =
  'Gemini API key is loaded from the GEMINI_API_KEY build env. This field is ignored.';
// Resting copy under the locked field; focus/click swaps it for ENV_KEY_NOTICE.
const ENV_KEY_HINT = 'Locked — supplied by this build. Click to learn more.';
const DEFAULT_KEY_HELP = 'Stored locally on this device only.';
const ENV_KEY_PLACEHOLDER = 'Loaded from GEMINI_API_KEY build env';

const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
label{display:block;margin:8px 0 4px;font-weight:600}
.row{margin-bottom:12px}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box}
input.locked{background:#f1f3f4;color:#5f6368;cursor:help}
[hidden]{display:none}
.actions button{margin-right:8px}
#status{margin:12px 0 0;padding:8px 12px;border-radius:4px;background:#e6f4ea;color:#137333;font-weight:600}
#status.error{background:#fce8e6;color:#c5221f}`;

const MARKUP = `<form>
  <div class="row">
    <label for="key">Gemini API key</label>
    <input id="key" type="password" autocomplete="off" aria-describedby="key-help" />
    <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
    <p id="key-help">Stored locally on this device only.</p>
  </div>
  <div class="row">
    <label for="target">Target language</label>
    <select id="target"><option value="vi">Vietnamese</option><option value="es">Spanish</option></select>
  </div>
  <div class="row">
    <label for="tpl">Prompt template</label>
    <textarea id="tpl" rows="6"></textarea>
  </div>
  <div class="row">
    <label><input type="checkbox" id="cache" /> Cache lookups</label>
    <label><input type="checkbox" id="history" /> Save history</label>
  </div>
  <div class="row actions">
    <button type="submit" id="save">Save</button>
    <button type="button" id="test">Test connection</button>
    <button type="button" id="clear-cache">Clear cache</button>
    <button type="button" id="clear-history">Clear history</button>
    <button type="button" id="export">Export history</button>
  </div>
  <p id="status" role="status" aria-live="polite" hidden></p>
</form>`;

export class SettingsForm extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: SettingsFormValue | null = null;
  // When the build baked in GEMINI_API_KEY the stored key is irrelevant (the SW
  // ignores it), so the field is locked. We still echo the stored key back on
  // save so toggling this state never silently wipes what the user had entered.
  private _keyFromEnv = false;
  private _storedApiKey = '';

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
      if (this._keyFromEnv) help.textContent = ENV_KEY_NOTICE;
    });
    key.addEventListener('blur', () => {
      if (this._keyFromEnv) help.textContent = ENV_KEY_HINT;
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

    if (this._pendingValue !== null) {
      this.value = this._pendingValue;
      this._pendingValue = null;
    }
    // Enforce the lock last so it wins over any value just hydrated above.
    this.applyKeyLock();
  }

  /** Lock the key field because the build supplies GEMINI_API_KEY itself. */
  set keyFromEnv(on: boolean) {
    this._keyFromEnv = on;
    if (this.shadowRoot) this.applyKeyLock();
  }
  get keyFromEnv(): boolean {
    return this._keyFromEnv;
  }

  private applyKeyLock(): void {
    const key = this.q<HTMLInputElement>('#key');
    const reveal = this.q<HTMLButtonElement>('#reveal');
    const help = this.q<HTMLElement>('#key-help');
    if (this._keyFromEnv) {
      key.readOnly = true;
      key.value = '';
      key.type = 'text';
      key.placeholder = ENV_KEY_PLACEHOLDER;
      key.classList.add('locked');
      key.setAttribute('aria-readonly', 'true');
      reveal.hidden = true;
      help.textContent = ENV_KEY_HINT;
    } else {
      key.readOnly = false;
      key.value = this._storedApiKey;
      key.placeholder = '';
      key.classList.remove('locked');
      key.removeAttribute('aria-readonly');
      reveal.hidden = false;
      help.textContent = DEFAULT_KEY_HELP;
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
    return {
      // Locked → the input is blanked for display, so echo the stored key back.
      apiKey: this._keyFromEnv ? this._storedApiKey : this.q<HTMLInputElement>('#key').value,
      targetLang: this.q<HTMLSelectElement>('#target').value,
      promptTemplate: this.q<HTMLTextAreaElement>('#tpl').value,
      cacheEnabled: this.q<HTMLInputElement>('#cache').checked,
      saveHistory: this.q<HTMLInputElement>('#history').checked,
    };
  }

  set value(v: SettingsFormValue) {
    if (!this.shadowRoot) {
      // Shadow not yet built — defer until connectedCallback flushes _pendingValue.
      this._pendingValue = v;
      return;
    }
    this._storedApiKey = v.apiKey;
    this.q<HTMLInputElement>('#key').value = v.apiKey;
    this.q<HTMLSelectElement>('#target').value = v.targetLang;
    this.q<HTMLTextAreaElement>('#tpl').value = v.promptTemplate;
    this.q<HTMLInputElement>('#cache').checked = v.cacheEnabled;
    this.q<HTMLInputElement>('#history').checked = v.saveHistory;
    // Re-assert the lock if the key arrived after keyFromEnv was set.
    if (this._keyFromEnv) this.applyKeyLock();
  }
}
