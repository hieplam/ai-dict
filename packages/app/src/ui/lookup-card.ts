import type { LookupError } from '../index';
import { adoptStyles } from './styles/adopt';
import { LIGHT_VARS, DARK_VARS, HOLLY_SVG } from './styles/tokens';

/**
 * A branded string type that marks HTML which has already passed the
 * sanitization pipeline (DOMPurify allowlist in adapters-shared, S4).
 * Never cast raw API content to SafeHtml — only the sanitizer may do so.
 */
export type SafeHtml = string & { readonly __brand: 'SafeHtml' };

/**
 * The three states the lookup card can display.
 * When kind === 'result', `safeHtml` MUST be the output of the sanitization
 * pipeline — never pass raw API content directly.
 */
export type CardState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; safeHtml: SafeHtml; word: string; target: string }
  | { kind: 'error'; error: LookupError };

// Decorative shadow-DOM icons. Stroked with currentColor so they inherit the token
// colour of their button; aria-hidden because each control carries its own aria-label.
const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12"/></svg>';
const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5 2v3.4c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V3.8l5-2z"/></svg>';

// Content lives in the card's LIGHT DOM, projected through a <slot>, so the shadow rules
// target slotted nodes via ::slotted(). `color`/`font` are inherited and cross the slot
// boundary from :host automatically. The card carries the full cozy surface (the
// <bottom-sheet> panel is neutralised so this is the single visible surface), adapting to
// light/dark via prefers-color-scheme.
// @keyframes spin is also defined in lookup-trigger.ts; each shadow root needs its own copy
// because CSS @keyframes are scoped per shadow tree — they cannot be shared across roots.
// The loading spinner is the ::before pseudo-element of the slotted .loadrow caption (styled
// via ::slotted(.loadrow)::before); per CSS Scoping Level 1, @keyframes defined in a shadow
// tree are not reliably in scope for light-DOM nodes, so we also inject the rule into the
// document stylesheet once on element registration as a belt-and-suspenders fallback.
const CSS = `:host{${LIGHT_VARS};display:block;box-sizing:border-box;width:100%;max-width:420px;margin:0 auto;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);border-radius:16px;box-shadow:var(--ad-shadow);overflow:hidden;color-scheme:light dark}
@media (prefers-color-scheme:dark){:host{${DARK_VARS}}::slotted(.setup-cta){background:color-mix(in oklab,var(--ad-pine) 86%,white)}}
.ribbon{height:4px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-amber) 52%,var(--ad-cranberry))}
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px 2px 16px}
.brand{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;letter-spacing:.01em;color:var(--ad-pine)}
.holly{width:21px;height:21px;flex:none}
.actions{display:inline-flex;gap:2px}
button[data-act]{display:inline-grid;place-items:center;width:28px;height:28px;border:0;background:transparent;color:var(--ad-ink-soft);border-radius:8px;cursor:pointer;font:inherit}
button[data-act]:hover{background:var(--ad-surface-soft);color:var(--ad-ink)}
button[data-act]:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
button[data-act] svg{width:15px;height:15px;pointer-events:none}
.region{padding:2px 16px 2px}
.footer{display:flex;align-items:center;gap:6px;margin:8px 16px 0;padding:10px 0 13px;border-top:1px solid var(--ad-line);font-size:11px;color:var(--ad-ink-soft)}
.footer svg{width:13px;height:13px;flex:none}
::slotted(h2){font-family:Georgia,"Times New Roman",serif;font-size:1.7rem;line-height:1.15;letter-spacing:-.01em;margin:.1em 0 .4em;color:var(--ad-ink);display:inline-block;max-width:100%;overflow-wrap:anywhere;padding-bottom:5px;background:linear-gradient(90deg,var(--ad-pine),var(--ad-cranberry)) left bottom/44px 3px no-repeat}
::slotted(.err){color:var(--ad-err);font-weight:500}
::slotted(.holly){display:block;width:30px;height:30px;margin:16px auto 2px}
::slotted(.setup-title){text-align:center;margin:8px 0 0;font-size:16px;font-weight:600;color:var(--ad-ink)}
::slotted(.setup-text){text-align:center;margin:6px auto 0;max-width:32ch;font-size:13.5px;line-height:1.55;color:var(--ad-ink-soft)}
::slotted(.setup-cta){display:block;margin:15px auto 6px;padding:9px 18px;border:0;border-radius:8px;background:var(--ad-pine);color:var(--ad-surface);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
::slotted(.setup-cta:hover){filter:brightness(1.06)}
::slotted(.setup-cta:focus-visible){outline:2px solid var(--ad-amber);outline-offset:2px}
@keyframes spin{to{transform:rotate(360deg)}}
::slotted(.loadrow){display:flex;align-items:center;gap:9px;margin:4px 0 9px;color:var(--ad-ink-soft);font-size:14px}
::slotted(.loadrow)::before{content:"";display:block;width:16px;height:16px;flex:none;border:2px solid var(--ad-line);border-top-color:var(--ad-amber);border-radius:50%;animation:spin .7s linear infinite}
@media (prefers-reduced-motion:reduce){::slotted(.loadrow)::before{animation:none}}`;

// Inject @keyframes spin into the document once so Firefox/Safari (which follow CSS
// Scoping Level 1 strictly) can resolve the animation on the light-DOM .spinner node.
let _docKeyframesInjected = false;
function ensureDocKeyframes(): void {
  if (_docKeyframesInjected) return;
  _docKeyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.append(style);
}

/**
 * The "open the options page" button. It dispatches a composed `open-settings` event that the
 * platform shell catches (content script → service worker `openOptionsPage`; side panel calls
 * it directly). The UI layer stays platform-agnostic — it never touches chrome.* itself.
 */
function settingsCta(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'setup-cta';
  b.textContent = label;
  b.addEventListener('click', () =>
    b.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })),
  );
  return b;
}

/**
 * First-run, no-key state. A keyless lookup can never succeed, so rather than a red failure we
 * render a warm setup nudge: the holly mark, a plain explainer that AI Dictionary runs on the
 * reader's own free Gemini key, and a single "Open Settings" action. Returned as top-level
 * light-DOM nodes so the card's `::slotted(...)` rules style them across the world boundary.
 */
function renderSetupInvite(): Node[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = HOLLY_SVG; // decorative (aria-hidden inside HOLLY_SVG); the text carries meaning
  const holly = tpl.content.firstElementChild as Element;
  const title = document.createElement('p');
  title.className = 'setup-title';
  title.textContent = 'Set up AI Dictionary';
  const text = document.createElement('p');
  text.className = 'setup-text';
  text.textContent =
    'AI Dictionary uses your own free Google Gemini key. Add it once to start looking up words.';
  return [holly, title, text, settingsCta('Open Settings')];
}

/**
 * Build the card's display content for a given state as LIGHT-DOM nodes.
 *
 * The nodes are placed in the card's light DOM (not its shadow) and projected
 * through a <slot>. This is what makes the card controllable across the Chrome
 * MV3 content-script world boundary: an isolated-world script can write shared-DOM
 * nodes, but cannot reach the JS `state` setter of a custom element whose class is
 * registered in the page's MAIN world (Chromium 390807). Same-world callers
 * (side panel) use the `state` setter, which funnels through this same helper.
 */
export function renderCardState(state: CardState): Node[] {
  if (state.kind === 'loading') {
    // The loading state must read as a populated, on-brand card, never an empty box. We show
    // the reader's own selected word as the headword the instant they click (it is known long
    // before the model replies), then a visible "Looking up the meaning…" caption with a small
    // amber spinner. The spinner is the caption's ::before pseudo-element (styled in CSS via
    // ::slotted(.loadrow)::before), so the rotating ring can never drag the text around with it
    // and we need no separate, rotation-prone ring element.
    // The caption is visible body text (not visually-hidden): the card's own aria-live="polite"
    // section announces it once. role="status" is intentionally omitted to avoid a nested live
    // region double-announcing in NVDA/JAWS.
    const nodes: Node[] = [];
    if (state.word) {
      const h = document.createElement('h2');
      h.textContent = state.word;
      nodes.push(h);
    }
    const cap = document.createElement('span');
    cap.className = 'loadrow';
    cap.textContent = 'Looking up the meaning…';
    nodes.push(cap);
    return nodes;
  }
  if (state.kind === 'error') {
    // First-run with no key isn't a failure, it's setup that hasn't happened yet — show a
    // warm onboarding nudge instead of a red error so the reader knows exactly what to do.
    if (state.error.code === 'NO_KEY') return renderSetupInvite();
    const h = document.createElement('h2');
    h.textContent = 'Lookup failed';
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = state.error.message;
    // A rejected key is the same dead-end as no key: hand the reader a way to fix it.
    if (state.error.code === 'INVALID_KEY') return [h, p, settingsCta('Open Settings')];
    return [h, p];
  }
  const h = document.createElement('h2');
  h.textContent = state.word;
  const body = document.createElement('div');
  body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
  return [h, body];
}

export class LookupCard extends HTMLElement {
  private _state: CardState = { kind: 'loading' };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    ensureDocKeyframes(); // inject document @keyframes for light-DOM spinner (Firefox/Safari)
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${HOLLY_SVG}<span>AI Dictionary</span>`;
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(this.actionButton('close', 'Close', ICON_CLOSE));
    bar.append(brand, actions);

    const region = document.createElement('section');
    region.className = 'region';
    region.setAttribute('aria-live', 'polite');
    region.append(document.createElement('slot'));

    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

    // festive top ribbon (pine → amber → cranberry); decorative, clipped by the rounded host
    const ribbon = document.createElement('div');
    ribbon.className = 'ribbon';

    root.append(ribbon, bar, region, footer);
    // Seed the default loading content only when nothing was provided before connection.
    // The content-script renderer writes light DOM directly across the world boundary;
    // overwriting it here (the MAIN-world upgrade can run after that write) would clobber
    // an already-rendered result back to "Looking up…".
    if (this.childNodes.length === 0) this.renderState();
  }

  private actionButton(act: 'close', label: string, icon: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon; // decorative aria-hidden SVG; accessible name comes from aria-label
    b.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent(act, { bubbles: true, composed: true })),
    );
    return b;
  }

  set state(s: CardState) {
    this._state = s;
    this.renderState();
  }
  get state(): CardState {
    return this._state;
  }

  /** Render the current state into the card's LIGHT DOM (projected via <slot>). */
  private renderState(): void {
    this.replaceChildren(...renderCardState(this._state));
  }
}
