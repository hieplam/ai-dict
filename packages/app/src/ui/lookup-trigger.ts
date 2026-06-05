import { adoptStyles } from './styles/adopt';

// `color-scheme:light` pins system colours so the OS dark mode does not repaint the
// control; `color:#202124` gives the label an explicit dark colour (matching the card)
// instead of inheriting the theme-dependent system `canvastext`, which is otherwise
// (near-)white on dark-theme pages and vanishes against the white button.
const CSS = `:host{all:initial;color-scheme:light}
button{font:600 13px/1 system-ui;color:#202124;padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;cursor:pointer}
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
