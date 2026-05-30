import { adoptStyles } from './styles/adopt';

const CSS = `:host{position:fixed;inset:0;z-index:2147483647}
.scrim{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.panel{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:12px 12px 0 0;
  max-height:80vh;overflow:auto;padding:12px;transition:transform .25s ease}
:host([reduced]) .panel{transition:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;

export class BottomSheet extends HTMLElement {
  private prevFocus: HTMLElement | null = null;
  private panel: HTMLElement | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      adoptStyles(root, CSS);
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.setAttribute('reduced', '');

      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', () => this.dismiss());

      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'sheet-title');
      panel.tabIndex = -1;
      const title = document.createElement('h2');
      title.id = 'sheet-title';
      title.className = 'sr-only';
      title.textContent = 'Dictionary lookup';
      panel.append(title, document.createElement('slot'));

      root.append(scrim, panel);
      this.panel = panel;
    }
    // Always (re-)register the listener and capture focus on every connection.
    this.addEventListener('keydown', this.onKeydown);
    this.prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.panel?.focus();
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKeydown);
    this.prevFocus?.focus();
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); this.dismiss(); return; }
    if (e.key === 'Tab') this.trapFocus(e);
  };

  private focusables(): HTMLElement[] {
    const sel = 'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])';
    return [...this.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.hasAttribute('disabled'));
  }

  private trapFocus(e: KeyboardEvent): void {
    const f = this.focusables();
    if (f.length === 0) { e.preventDefault(); this.panel?.focus(); return; }
    const first = f[0]!;
    const last = f[f.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  dismiss(): void {
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }
}

if (!customElements.get('bottom-sheet')) customElements.define('bottom-sheet', BottomSheet);
