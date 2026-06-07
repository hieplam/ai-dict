import { adoptStyles } from './styles/adopt';
import { LIGHT_VARS, DARK_VARS, HOLLY_SVG } from './styles/tokens';

// Restated locally to keep this component self-contained — the codebase already
// duplicates this small shield across side-panel-view.ts and lookup-card.ts;
// consolidating all three into tokens.ts is a separate, out-of-scope cleanup.
const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5 2v3.4c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V3.8l5-2z"/></svg>';

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

const CSS = `:host{${LIGHT_VARS};display:block;min-height:100vh;box-sizing:border-box;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light dark}
@media (prefers-color-scheme:dark){:host{${DARK_VARS}}button.primary{background:color-mix(in oklab,var(--ad-pine) 86%,white)}}
*{box-sizing:border-box}
.ribbon{height:4px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-amber) 52%,var(--ad-cranberry))}
header{display:flex;align-items:center;gap:8px;max-width:640px;margin:0 auto;padding:14px 18px 6px}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.01em;color:var(--ad-pine)}
.holly{width:22px;height:22px;flex:none}
.col{max-width:640px;margin:0 auto;padding:2px 18px 26px}
h1.title{font-family:Georgia,"Times New Roman",serif;font-size:1.8rem;line-height:1.15;letter-spacing:-.01em;margin:.1em 0 .55em;color:var(--ad-ink);display:inline-block;padding-bottom:6px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-cranberry)) left bottom/46px 3px no-repeat}
.sec{border:1px solid var(--ad-line);border-radius:13px;padding:15px 16px;margin:0 0 14px;background:var(--ad-surface-soft)}
.sec-h{margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ad-ink-soft)}
label{display:block;margin:12px 0 5px;font-weight:600;font-size:13px;color:var(--ad-ink)}
label.check{display:flex;align-items:center;gap:9px;margin:9px 0;font-weight:500;font-size:14px}
label.check input{width:16px;height:16px;flex:none;accent-color:var(--ad-pine)}
input,select,textarea{font:inherit;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--ad-line);border-radius:10px;background:var(--ad-surface);color:var(--ad-ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ad-amber);outline-offset:1px;border-color:transparent}
textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.keyrow{display:flex;gap:8px;align-items:stretch}
.keyrow input{flex:1}
input.locked{background:var(--ad-surface-soft);color:var(--ad-ink-soft);cursor:help}
#key-help{margin:6px 0 0;font-size:12px;color:var(--ad-ink-soft)}
.env-notice{margin:10px 0 0;padding:9px 12px;border-left:3px solid var(--ad-amber);background:var(--ad-surface);border-radius:0 8px 8px 0;font-size:13px;line-height:1.5;color:var(--ad-ink)}
.inline-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;padding-top:11px;border-top:1px dashed var(--ad-line)}
button{font:inherit;font-weight:600;font-size:13px;padding:9px 15px;border-radius:10px;cursor:pointer;border:1px solid var(--ad-line);background:var(--ad-surface);color:var(--ad-ink)}
button:hover{background:var(--ad-surface-soft)}
button:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
button.sm{padding:6px 11px;font-size:12px}
button.link{border:none;background:none;color:var(--ad-pine);padding:6px 4px;text-decoration:underline;text-underline-offset:2px}
button.link:hover{background:none;text-decoration:none}
.savebar{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:2px}
button.primary{background:var(--ad-pine);border-color:transparent;color:var(--ad-surface)}
button.primary:hover{background:var(--ad-pine);filter:brightness(1.06)}
.savebar .muted{font-size:12px;color:var(--ad-ink-soft)}
#status{margin:14px 0 0;padding:9px 12px;border-radius:8px;border-left:3px solid var(--ad-pine);background:var(--ad-surface-soft);color:var(--ad-ink);font-size:13px;font-weight:600}
#status.error{border-left-color:var(--ad-err);color:var(--ad-err)}
footer{display:flex;align-items:center;gap:6px;max-width:640px;margin:0 auto;padding:13px 18px 18px;border-top:1px solid var(--ad-line);font-size:11px;color:var(--ad-ink-soft)}
footer svg{width:13px;height:13px;flex:none}
[hidden]{display:none}`;

const MARKUP = `<div class="ribbon"></div>
<header><span class="brand">${HOLLY_SVG}<span>AI Dictionary</span></span></header>
<form>
  <div class="col">
    <h1 class="title">Settings</h1>
    <section class="sec" aria-labelledby="sec-conn">
      <h2 class="sec-h" id="sec-conn">Connection</h2>
      <label for="key">Gemini API key</label>
      <div class="keyrow">
        <input id="key" type="password" autocomplete="off" aria-describedby="key-help" />
        <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
      </div>
      <p id="key-help">Stored locally on this device only.</p>
      <p id="env-notice" class="env-notice" hidden></p>
      <div class="inline-actions">
        <button type="button" id="test" class="sm">Test connection</button>
      </div>
    </section>
    <section class="sec" aria-labelledby="sec-trans">
      <h2 class="sec-h" id="sec-trans">Translation</h2>
      <label for="target">Target language</label>
      <select id="target"><option value="vi">Vietnamese</option><option value="es">Spanish</option></select>
      <label for="tpl">Prompt template</label>
      <textarea id="tpl" rows="6"></textarea>
    </section>
    <section class="sec" aria-labelledby="sec-priv">
      <h2 class="sec-h" id="sec-priv">Privacy &amp; data</h2>
      <label class="check"><input type="checkbox" id="cache" /> Cache lookups</label>
      <label class="check"><input type="checkbox" id="history" /> Save history</label>
      <div class="inline-actions">
        <button type="button" id="clear-cache" class="sm">Clear cache</button>
        <button type="button" id="clear-history" class="sm">Clear history</button>
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
    const envNotice = this.q<HTMLElement>('#env-notice');
    if (this._keyFromEnv) {
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
      key.value = this._storedApiKey;
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
