import { adoptStyles } from './styles/adopt';

const CSS = `:host{all:initial}
button{font:600 13px/1 system-ui;padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;cursor:pointer}
button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}`;

export class LookupTrigger extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    // NOTE: no role="button" — a native <button> already carries the implicit
    // ARIA role 'button'; setting it explicitly violates the First Rule of ARIA
    // and can cause screen readers to announce "button button".
    btn.setAttribute('aria-label', 'Look up selected text');
    btn.textContent = 'Define';
    btn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true, composed: true }));
    });
    root.append(btn);
  }
}

if (!customElements.get('lookup-trigger')) customElements.define('lookup-trigger', LookupTrigger);
