import type { LookupError } from '@ai-dict/core';
import { adoptStyles } from './styles/adopt';

export type CardState =
  | { kind: 'loading' }
  | { kind: 'result'; safeHtml: string; word: string; target: string }
  | { kind: 'error'; error: LookupError };

const CSS = `:host{display:block;font:14px/1.5 system-ui;color:#202124}
.bar{display:flex;gap:8px;justify-content:flex-end;padding:8px}
.region{padding:0 12px 12px}
h2{font-size:1.1rem;margin:0 0 8px}
.err{color:#b00020}`;

export class LookupCard extends HTMLElement {
  private region: HTMLElement | null = null;
  private _state: CardState = { kind: 'loading' };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.append(this.actionButton('expand', 'Expand'), this.actionButton('close', 'Close'));

    const region = document.createElement('section');
    region.className = 'region';
    region.setAttribute('aria-live', 'polite');

    root.append(bar, region);
    this.region = region;
    this.render();
  }

  private actionButton(act: 'expand' | 'close', label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    b.textContent = label;
    b.addEventListener('click', () => this.dispatchEvent(new CustomEvent(act, { bubbles: true, composed: true })));
    return b;
  }

  set state(s: CardState) {
    this._state = s;
    if (this.region) this.render();
  }
  get state(): CardState { return this._state; }

  private render(): void {
    const region = this.region;
    if (!region) return;
    region.replaceChildren();
    const s = this._state;
    if (s.kind === 'loading') { region.textContent = 'Looking up…'; return; }
    if (s.kind === 'error') {
      const h = document.createElement('h2'); h.textContent = 'Lookup failed';
      const p = document.createElement('p'); p.className = 'err'; p.textContent = s.error.message;
      region.append(h, p);
      return;
    }
    const h = document.createElement('h2'); h.textContent = s.word;
    const body = document.createElement('div');
    body.innerHTML = s.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
    region.append(h, body);
  }
}

if (!customElements.get('lookup-card')) customElements.define('lookup-card', LookupCard);
