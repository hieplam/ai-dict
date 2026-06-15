import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

// The panel is a transparent, centring container — the slotted <lookup-card> carries the
// Paperlight surface (bg, radius, shadow), so the sheet never frames it in a second card
// (the One Surface Rule). A warm dim --ad-scrim sets the focus; the slide-up easing is an
// ease-out curve (no bounce). The host folds in the tokens and is stamped with data-ad-theme
// (by the renderer, mirroring the card) so --ad-scrim resolves to the reader's theme.
//
// The panel caps at 88dvh (with an 88vh fallback for older browsers) and is the scroll
// container (`overflow-y:auto`); a long definition scrolls inside it instead of growing the
// sheet past the viewport. `dvh` tracks the DYNAMIC visual viewport, so on mobile browsers whose
// collapsible address bar makes `100vh` taller than the visible screen (iOS Safari, some Android),
// the sheet stays fully on-screen — `88vh` there could push the panel's top (anchored to
// bottom:0) above the visible area and clip the header when content is long (issue #52).
// It is deliberately a BLOCK,
// not a flex box: as a flex item the card would inherit `flex-shrink:1` and get squashed to the
// 88dvh cap, and since the card is `overflow:hidden` the overflow would be clipped (no scroll).
// As a block the card keeps its natural height, overflows the cap, and the panel scrolls. The
// card centres itself horizontally via `::slotted(*){margin:0 auto}` (it sets its own max-width).
const CSS = `:host{${BASE_VARS};position:fixed;inset:0;z-index:var(--adp-z-overlay)}
${THEME_CSS}
.scrim{position:absolute;inset:0;background:var(--ad-scrim)}
.panel{position:absolute;left:0;right:0;bottom:0;
  max-height:88vh;max-height:88dvh;overflow-y:auto;overscroll-behavior:contain;padding:0 14px max(14px, env(safe-area-inset-bottom));
  transition:transform var(--adp-dur-slow) var(--adp-ease)}
::slotted(*){display:block;margin:0 auto}
:host([reduced]) .panel{transition:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;

export class BottomSheet extends HTMLElement {
  private prevFocus: HTMLElement | null = null;
  private panel: HTMLElement | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      adoptStyles(root, CSS);
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        this.setAttribute('reduced', '');

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
    if (e.key === 'Escape') {
      e.preventDefault();
      this.dismiss();
      return;
    }
    if (e.key === 'Tab') this.trapFocus(e);
  };

  private focusables(): HTMLElement[] {
    const sel = 'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])';
    return [...this.querySelectorAll<HTMLElement>(sel)].filter(
      (el) => !el.hasAttribute('disabled'),
    );
  }

  private trapFocus(e: KeyboardEvent): void {
    const f = this.focusables();
    if (f.length === 0) {
      e.preventDefault();
      this.panel?.focus();
      return;
    }
    const first = f[0]!;
    const last = f[f.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  dismiss(): void {
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }
}
