import type { TriggerUI, AnchorRect } from '@ai-dict/core';
import '@ai-dict/shared-ui/lookup-trigger';

const DISMISS_EVENTS = ['mousedown', 'touchstart'] as const;

export class SafariFloatingTrigger implements TriggerUI {
  private el: HTMLElement | null = null;
  private onClick: (() => void) | null = null;
  private readonly handler = (): void => this.onClick?.();
  // Dismiss the bubble when the user starts an interaction anywhere but on it.
  // composedPath() pierces the shadow DOM, so a press on the "Define" button
  // counts as "inside" and lets the click through to fire the lookup.
  private readonly onOutsidePress = (e: Event): void => {
    if (this.el && !e.composedPath().includes(this.el)) this.hide();
  };

  constructor(private readonly host: HTMLElement = document.body) {}

  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.addEventListener('lookup-click', this.handler);
      this.host.append(this.el);
      // Capture phase so pages that stopPropagation can't trap the dismissal.
      for (const t of DISMISS_EVENTS) document.addEventListener(t, this.onOutsidePress, true);
    }
    this.el.style.position = 'fixed';
    this.el.style.left = `${anchor.x}px`;
    this.el.style.top = `${anchor.y + anchor.h}px`;
  }

  hide(): void {
    this.el?.removeEventListener('lookup-click', this.handler);
    this.el?.remove();
    this.el = null;
    this.onClick = null;
    for (const t of DISMISS_EVENTS) document.removeEventListener(t, this.onOutsidePress, true);
  }
}
