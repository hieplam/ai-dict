import { adoptStyles } from './styles/adopt';

export interface SettingsFormValue {
  apiKey: string;
  targetLang: string;
  promptTemplate: string;
  cacheEnabled: boolean;
  saveHistory: boolean;
}

const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
label{display:block;margin:8px 0 4px;font-weight:600}
.row{margin-bottom:12px}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box}
.actions button{margin-right:8px}`;

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
</form>`;

export class SettingsForm extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: SettingsFormValue | null = null;

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
    this.q<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent<SettingsFormValue>('save', { detail: this.collect(), bubbles: true, composed: true }));
    });
    this.relay('#test', 'test-connection');
    this.relay('#clear-cache', 'clear-cache');
    this.relay('#clear-history', 'clear-history');
    this.relay('#export', 'export-history');

    if (this._pendingValue !== null) {
      this.value = this._pendingValue;
      this._pendingValue = null;
    }
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
      apiKey: this.q<HTMLInputElement>('#key').value,
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
    this.q<HTMLInputElement>('#key').value = v.apiKey;
    this.q<HTMLSelectElement>('#target').value = v.targetLang;
    this.q<HTMLTextAreaElement>('#tpl').value = v.promptTemplate;
    this.q<HTMLInputElement>('#cache').checked = v.cacheEnabled;
    this.q<HTMLInputElement>('#history').checked = v.saveHistory;
  }
}

if (!customElements.get('settings-form')) customElements.define('settings-form', SettingsForm);
