import type { TriggerUI, AnchorRect } from '@ai-dict/core';
import '@ai-dict/shared-ui/lookup-trigger';

export class ChromeFloatingTrigger implements TriggerUI {
  private el: HTMLElement | null = null;
  private onClick: (() => void) | null = null;
  private readonly handler = (): void => this.onClick?.();

  constructor(private readonly host: HTMLElement = document.body) {}

  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.addEventListener('lookup-click', this.handler);
      this.host.append(this.el);
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
  }
}
