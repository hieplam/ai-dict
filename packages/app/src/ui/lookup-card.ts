import type { LookupError } from '../index';
import { adoptStyles } from './styles/adopt';

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
  | { kind: 'loading' }
  | { kind: 'result'; safeHtml: SafeHtml; word: string; target: string }
  | { kind: 'error'; error: LookupError };

// Content lives in the card's LIGHT DOM, projected through a <slot>, so the
// shadow rules target slotted nodes via ::slotted(). `color`/`font` are inherited
// and cross the slot boundary from :host automatically.
// @keyframes spin is also defined in lookup-trigger.ts; each shadow root needs its own copy
// because CSS @keyframes are scoped per shadow tree — they cannot be shared across roots.
// The .spinner div lives in light DOM and is projected via ::slotted(); per CSS Scoping
// Level 1, @keyframes defined in a shadow tree are not in scope for light-DOM elements, so
// we also inject the rule into the document stylesheet once on element registration.
const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
.bar{display:flex;gap:8px;justify-content:flex-end;padding:8px}
.region{padding:0 12px 12px}
::slotted(h2){font-size:1.1rem;margin:0 0 8px}
::slotted(.err){color:#b00020}
::slotted(.sr-only){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@keyframes spin{to{transform:rotate(360deg)}}
::slotted(.spinner){display:inline-block;width:16px;height:16px;border:2px solid #ccc;border-top-color:#1a73e8;border-radius:50%;animation:spin .7s linear infinite}`;

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
    // spinner ring (light DOM, projected via ::slotted(.spinner)) + a visually-hidden
    // SIBLING label. The label must NOT be a child of the ring: the ring rotates, so a
    // child label rotates with it. It is hidden via the `.sr-only` class from the card's
    // adopted (constructable) stylesheet, NOT an inline `style` attribute — extension
    // pages such as the side panel run under `style-src 'self'`, which blocks inline
    // styles, so an inline-styled label un-hides and (as a ring child) spins with it.
    // role="status" omitted — the card's own aria-live="polite" section announces; a
    // nested live region double-announces in NVDA/JAWS.
    const ring = document.createElement('div');
    ring.className = 'spinner';
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = 'Looking up…';
    return [ring, label];
  }
  if (state.kind === 'error') {
    const h = document.createElement('h2');
    h.textContent = 'Lookup failed';
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = state.error.message;
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
    bar.append(this.actionButton('expand', 'Expand'), this.actionButton('close', 'Close'));

    const region = document.createElement('section');
    region.className = 'region';
    region.setAttribute('aria-live', 'polite');
    region.append(document.createElement('slot'));

    root.append(bar, region);
    // Seed the default loading content only when nothing was provided before connection.
    // The content-script renderer writes light DOM directly across the world boundary;
    // overwriting it here (the MAIN-world upgrade can run after that write) would clobber
    // an already-rendered result back to "Looking up…".
    if (this.childNodes.length === 0) this.renderState();
  }

  private actionButton(act: 'expand' | 'close', label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    b.textContent = label;
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
