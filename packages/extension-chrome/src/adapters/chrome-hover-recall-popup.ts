import { type AnchorRect, type Theme, type HoverRecallValue } from '@ai-dict/app';

// Same 'HoverRecallPopup' custom element the app registers via registerContentElements(); this
// file only needs its instance methods, typed structurally so it needs no class import.
interface HoverRecallPopupEl extends HTMLElement {
  show(anchor: AnchorRect, value: HoverRecallValue): void;
  hide(): void;
}

/** Chrome-shell adapter owning the singleton <hover-recall-popup> element's lifecycle — mirrors
 * chrome-floating-trigger.ts's shape. Unlike that trigger, the element is created ONCE (not
 * lazily) since there is no outside-press-listener lifecycle tied to it (design spec §2.7). */
export class ChromeHoverRecallPopup {
  readonly element: HoverRecallPopupEl;
  private _theme: Theme = 'sepia';

  constructor(host: HTMLElement = document.body) {
    this.element = document.createElement('hover-recall-popup') as HoverRecallPopupEl;
    this.element.setAttribute('data-ad-theme', this._theme);
    host.append(this.element);
  }

  set theme(t: Theme) {
    this._theme = t;
    this.element.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  show(anchor: AnchorRect, value: HoverRecallValue): void {
    this.element.show(anchor, value);
  }

  hide(): void {
    this.element.hide();
  }
}
