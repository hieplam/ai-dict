import { registerContentElements, type TriggerUI, type AnchorRect, type Theme } from '@ai-dict/app';
import { TRIGGER_SHOWN_MARK } from './trigger-marks';
export { TRIGGER_SHOWN_MARK } from './trigger-marks';
registerContentElements();

const DISMISS_EVENTS = ['mousedown', 'touchstart'] as const;

export class ChromeFloatingTrigger implements TriggerUI {
  private el: HTMLElement | null = null;
  private _theme: Theme = 'sepia';
  private onClick: (() => void) | null = null;
  private readonly handler = (): void => this.onClick?.();
  // Dismiss the bubble when the user starts an interaction anywhere but on it.
  // composedPath() pierces the shadow DOM, so a press on the "Define" button
  // counts as "inside" and lets the click through to fire the lookup.
  private readonly onOutsidePress = (e: Event): void => {
    if (this.el && !e.composedPath().includes(this.el)) this.hide();
  };

  constructor(private readonly host: HTMLElement = document.body) {}

  /** Stored theme preference, stamped as an attribute on the bubble (set by content.ts). */
  set theme(t: Theme) {
    this._theme = t;
    this.el?.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  private _quiet = false;

  /** A13: true when the current page's registrable domain is in the quiet-sites list. Read once
   * per show() call — a site muted while an earlier bubble is already visible does not
   * retroactively hide that bubble; the mute takes effect starting with the next selection
   * (mirrors theme's own "settings arrive after the bubble is already up" precedent above). */
  set quiet(q: boolean) {
    this._quiet = q;
  }
  get quiet(): boolean {
    return this._quiet;
  }

  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.setAttribute('data-ad-theme', this._theme);
      this.el.addEventListener('lookup-click', this.handler);
      // A13: on a muted site, the element is still created and wired (so A4's activate() can
      // still click it) but never mounted to the page — no DOM node, no paint. This is
      // "visually silent" literally, not display:none, and needs no CSS/attribute at all.
      if (!this._quiet) {
        this.host.append(this.el);
        // Capture phase so pages that stopPropagation can't trap the dismissal.
        for (const t of DISMISS_EVENTS) document.addEventListener(t, this.onOutsidePress, true);
      }
    }
    if (!this._quiet) {
      this.el.style.position = 'fixed';
      this.el.style.left = `${anchor.x}px`;
      this.el.style.top = `${anchor.y + anchor.h}px`;
      // A13: a muted site's un-mounted bubble must never be marked "shown" (design spec §2.4).
      requestAnimationFrame(() => performance.mark(TRIGGER_SHOWN_MARK));
    }
  }

  /**
   * Keyboard-shortcut path (A4 define-selection): fire the same click the mouse would, on
   * whatever trigger bubble is currently showing. Returns false (no-op) if nothing is
   * selected/shown — matches "define what I just selected": nothing selected, nothing to do.
   */
  activate(): boolean {
    const btn = this.el?.shadowRoot?.querySelector('button');
    if (btn instanceof HTMLButtonElement && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  hide(): void {
    this.el?.removeEventListener('lookup-click', this.handler);
    this.el?.remove();
    this.el = null;
    this.onClick = null;
    for (const t of DISMISS_EVENTS) document.removeEventListener(t, this.onOutsidePress, true);
  }
}
