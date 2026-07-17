import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG, ICON_SHIELD } from './styles/tokens';
import { normalize, hintFor } from '../domain/key-hygiene';

// Where a reader creates a free Gemini key. Surfaced as the first onboarding step so a
// first-time user is never left wondering where the key comes from.
export const GET_KEY_URL = 'https://aistudio.google.com/apikey';

/** What the onboarding screen collects: just enough to make the extension usable. */
export interface OnboardingValue {
  apiKey: string;
  targetLang: string;
}

// ICON_SHIELD is the canonical §5.10 footer glyph from tokens.ts.
// Small "opens in a new tab" arrow, paired with the Google AI Studio link.
const ICON_EXTERNAL =
  '<svg class="ext" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3"/><path d="M9.5 2.5H13.5V6.5"/><path d="M13.5 2.5 7.5 8.5"/></svg>';

// The first-run screen the options page shows until a key exists. It is the same Paperlight
// surface as the rest of the UI (3px spruce→clay accent strip, warm glow, --ad-* tokens) and is
// fully responsive: one centred column that reflows from a wide tab down to a narrow window, the
// key row wrapping rather than overflowing. The single blocking step is the API key — language has
// a sensible default — so the checklist shows what is already done (language) and what is still
// missing (the key), and the progress count moves the moment a key is pasted.
const CSS = `:host{${BASE_VARS};display:block;min-height:100vh;box-sizing:border-box;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);color-scheme:light}
${THEME_CSS}
*{box-sizing:border-box}
::selection{background:var(--ad-selection)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.accent{height:3px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
header{display:flex;align-items:center;gap:8px;max-width:560px;margin:0 auto;padding:14px clamp(16px,5vw,22px) 6px}
.brand{display:inline-flex;align-items:center;gap:8px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.brand .mark{width:22px;height:22px;flex:none}
main{max-width:560px;margin:0 auto;padding:6px clamp(16px,5vw,22px) 30px}
.hero{text-align:center;padding:10px 0 4px}
.mark.hero-mark{width:46px;height:46px;margin:0 auto 6px;display:block}
h1.title{font-family:var(--adp-font-serif);font-size:clamp(1.7rem,1.4rem + 1.4vw,2.1rem);line-height:1.12;letter-spacing:var(--adp-tracking-head);margin:.1em 0 .3em;color:var(--ad-ink);text-wrap:balance}
.lead{margin:0 auto;max-width:46ch;font-size:14.5px;line-height:1.6;color:var(--ad-ink-soft);text-wrap:pretty}
.panel{margin:20px 0 0;border:1px solid var(--ad-line);border-radius:14px;padding:6px clamp(14px,4vw,20px) 18px;background:var(--ad-surface-raised)}
.panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:14px 0 4px;border-bottom:1px solid var(--ad-line)}
.panel-h{margin:0;font-size:var(--adp-text-body);font-weight:var(--adp-weight-bold);color:var(--ad-ink)}
.progress{margin:0;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);color:var(--ad-accent-ink)}
.steps{list-style:none;margin:0;padding:0}
.step{display:flex;gap:13px;padding:16px 0;border-bottom:1px solid var(--ad-line)}
.step:last-child{border-bottom:0;padding-bottom:6px}
.dot{width:21px;height:21px;border-radius:50%;flex:none;margin-top:1px;border:2px solid var(--ad-line-strong);position:relative;background:var(--ad-surface);transition:background var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
.step.done .dot{background:var(--ad-accent);border-color:var(--ad-accent)}
.step.done .dot::after{content:"";position:absolute;left:6px;top:2.5px;width:4px;height:9px;border:solid var(--ad-on-accent);border-width:0 2px 2px 0;transform:rotate(45deg)}
.step-body{flex:1 1 auto;min-width:0}
.step-title{margin:0;font-size:14.5px;font-weight:var(--adp-weight-semi);color:var(--ad-ink)}
.step-sub{margin:2px 0 0;font-size:var(--adp-text-sm);line-height:1.5;color:var(--ad-ink-soft)}
select{font:inherit;margin-top:10px;width:100%;max-width:240px;padding:9px 11px;border:1px solid var(--ad-line-strong);border-radius:10px;background:var(--ad-surface);color:var(--ad-ink)}
.getkey{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:var(--adp-text-sm);font-weight:var(--adp-weight-semi);color:var(--ad-accent-ink);text-decoration:underline;text-underline-offset:2px}
.getkey:hover{text-decoration:none}
.getkey:focus-visible{outline:2px solid var(--ad-accent);outline-offset:3px;border-radius:4px}
.getkey .ext{width:14px;height:14px;flex:none}
.keyrow{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;margin-top:11px}
.keyrow input{flex:1 1 200px;min-width:0;font:inherit;padding:10px 12px;border:1px solid var(--ad-line-strong);border-radius:10px;background:var(--ad-surface);color:var(--ad-ink)}
input:focus,select:focus{outline:2px solid var(--ad-accent);outline-offset:1px;border-color:transparent}
#reveal{font:inherit;font-weight:var(--adp-weight-semi);font-size:var(--adp-text-sm);padding:9px 14px;border-radius:10px;cursor:pointer;border:1px solid var(--ad-line-strong);background:var(--ad-surface);color:var(--ad-ink)}
#reveal:hover{background:var(--ad-surface-raised)}
#reveal:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
#key-help{margin:8px 0 0;font-size:var(--adp-text-xs);color:var(--ad-ink-soft)}
#key-hint{margin:8px 0 0;padding:8px 11px;border-radius:8px;border-left:3px solid var(--ad-accent);background:var(--ad-accent-soft);color:var(--ad-ink);font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi)}
.actions{margin-top:18px}
button.primary{font:inherit;font-weight:var(--adp-weight-semi);font-size:14px;width:100%;padding:12px 18px;border-radius:11px;cursor:pointer;border:1px solid transparent;background:var(--ad-accent);color:var(--ad-on-accent)}
button.primary:hover{filter:brightness(1.06)}
button.primary:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
#status{margin:13px 0 0;padding:9px 12px;border-radius:8px;border-left:3px solid var(--ad-accent);background:var(--ad-surface-sunken);color:var(--ad-ink);font-size:var(--adp-text-sm);font-weight:var(--adp-weight-semi)}
#status.error{border-left-color:var(--ad-error);color:var(--ad-error)}
footer{display:flex;align-items:center;gap:6px;max-width:560px;margin:0 auto;padding:6px clamp(16px,5vw,22px) 20px;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
footer svg{width:13px;height:13px;flex:none}
[hidden]{display:none}`;

const MARKUP = `<div class="accent" aria-hidden="true"></div>
<header><span class="brand">${BRAND_MARK_SVG}<span>AI Dictionary</span></span></header>
<form novalidate>
  <main>
    <div class="hero">
      ${BRAND_MARK_SVG.replace('class="mark"', 'class="mark hero-mark"')}
      <h1 class="title">Welcome to AI Dictionary</h1>
      <p class="lead">Look up any English word right where you're reading, translated into your language, powered by your own free Google Gemini key. Nothing leaves your device but the word you choose.</p>
    </div>
    <section class="panel" aria-labelledby="setup-h">
      <div class="panel-head">
        <h2 class="panel-h" id="setup-h">Finish setup</h2>
        <p class="progress" id="progress"></p>
      </div>
      <ol class="steps">
        <li class="step done" id="step-lang">
          <span class="dot"></span>
          <div class="step-body">
            <p class="step-title">Reading language</p>
            <p class="step-sub">Definitions are translated into this language. Change it anytime.</p>
            <label class="sr-only" for="target">Reading language</label>
            <select id="target"><option value="vi">Vietnamese</option><option value="en">English</option></select>
          </div>
        </li>
        <li class="step todo" id="step-key">
          <span class="dot"></span>
          <div class="step-body">
            <p class="step-title">Add your Gemini API key</p>
            <p class="step-sub">Free from Google AI Studio, about a minute to create. Paste it below to activate the extension.</p>
            <a class="getkey" id="getkey" href="${GET_KEY_URL}" target="_blank" rel="noopener noreferrer">Get a free API key${ICON_EXTERNAL}</a>
            <div class="keyrow">
              <input id="key" type="password" autocomplete="off" placeholder="Paste your key (AIza…)" aria-label="Gemini API key" aria-describedby="key-help" />
              <button type="button" id="reveal" aria-label="Reveal API key">Show</button>
            </div>
            <p id="key-help">Stored locally on this device only.</p>
            <p id="key-hint" aria-live="polite" hidden></p>
          </div>
        </li>
      </ol>
      <div class="actions">
        <button type="submit" id="activate" class="primary">Save &amp; activate</button>
      </div>
      <p id="status" role="status" aria-live="polite" hidden></p>
    </section>
  </main>
</form>
<footer>${ICON_SHIELD}<span>Stays on your device</span></footer>`;

export class OnboardingView extends HTMLElement {
  private root!: ShadowRoot;
  private _pendingValue: OnboardingValue | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.root = this.attachShadow({ mode: 'open' });
    adoptStyles(this.root, CSS);
    this.root.innerHTML = MARKUP;

    const key = this.q<HTMLInputElement>('#key');
    this.q<HTMLButtonElement>('#reveal').addEventListener('click', () => {
      const reveal = this.q<HTMLButtonElement>('#reveal');
      key.type = key.type === 'password' ? 'text' : 'password';
      reveal.setAttribute('aria-label', key.type === 'text' ? 'Hide API key' : 'Reveal API key');
    });
    // Live progress: the moment a key is present, step 2 flips to done and the count moves.
    key.addEventListener('input', () => {
      this.refreshProgress();
      this.refreshKeyHint();
    });

    this.q<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });

    if (this._pendingValue !== null) {
      this.value = this._pendingValue;
      this._pendingValue = null;
    }
    this.refreshProgress();
    this.refreshKeyHint();
    // Arrivals from the no-key card should land directly on the one thing they must do.
    key.focus();
  }

  /** Validate then emit `save` so the host (options page) can persist + advance to settings. */
  private submit(): void {
    const apiKey = normalize(this.q<HTMLInputElement>('#key').value);
    if (apiKey.length === 0) {
      this.setStatus('Paste your Gemini API key to activate the extension.', 'error');
      this.q<HTMLInputElement>('#key').focus();
      return;
    }
    this.dispatchEvent(
      new CustomEvent<OnboardingValue>('save', {
        detail: { apiKey, targetLang: this.q<HTMLSelectElement>('#target').value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Reflect what is done vs. still missing: language is always ready, the key is the gate. */
  private refreshProgress(): void {
    const hasKey = this.q<HTMLInputElement>('#key').value.trim().length > 0;
    const stepKey = this.q<HTMLElement>('#step-key');
    stepKey.classList.toggle('done', hasKey);
    stepKey.classList.toggle('todo', !hasKey);
    const done = 1 + (hasKey ? 1 : 0);
    this.q<HTMLElement>('#progress').textContent = hasKey
      ? '2 of 2 — activate to finish'
      : `${done} of 2 ready`;
  }

  /** C5: live, non-blocking hint when a pasted key looks like a different provider's or is
   * implausibly short/malformed — never blocks activation (roadmap C5 scope fence). */
  private refreshKeyHint(): void {
    const hint = hintFor('gemini', normalize(this.q<HTMLInputElement>('#key').value));
    const el = this.q<HTMLElement>('#key-hint');
    el.textContent = hint?.message ?? '';
    el.hidden = hint === null;
  }

  /** Surface save/persist outcomes inline (mirrors settings-form). Empty text hides the line. */
  setStatus(text: string, tone: 'ok' | 'error' = 'ok'): void {
    const status = this.q<HTMLElement>('#status');
    status.textContent = text;
    status.hidden = text.length === 0;
    status.classList.toggle('error', tone === 'error');
  }

  set value(v: OnboardingValue) {
    if (!this.shadowRoot) {
      this._pendingValue = v;
      return;
    }
    this.q<HTMLSelectElement>('#target').value = v.targetLang;
    this.q<HTMLInputElement>('#key').value = v.apiKey;
    this.refreshProgress();
    this.refreshKeyHint();
  }

  private q<T extends Element>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`onboarding-view: missing ${sel}`);
    return el;
  }
}
