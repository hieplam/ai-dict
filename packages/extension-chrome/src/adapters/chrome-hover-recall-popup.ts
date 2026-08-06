import { type AnchorRect, type Theme, type HoverRecallValue } from '@ai-dict/app';

/** Chrome-shell adapter owning the singleton <hover-recall-popup> element. Mirrors
 * chrome-floating-trigger.ts: the element is DEFINED in the page's MAIN world
 * (content-elements.ts, world:MAIN) but this adapter runs in content.ts's ISOLATED world, so it
 * drives the element ONLY through shared-DOM operations that cross the MV3 world boundary —
 * ATTRIBUTES (word/preview/open/data-ad-theme) and inline STYLE — never a JS method/property
 * call, which would not cross (Chromium 390807; see inline-bottom-sheet-renderer.ts:74-81).
 * Created ONCE (not lazily): no outside-press-listener lifecycle is tied to it (design spec §2.7). */
export class ChromeHoverRecallPopup {
  readonly element: HTMLElement;
  private _theme: Theme = 'sepia';

  constructor(host: HTMLElement = document.body) {
    this.element = document.createElement('hover-recall-popup');
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
    const el = this.element;
    el.setAttribute('word', value.word);
    el.setAttribute('preview', value.preview);
    // Position below the anchor, set `open` (which makes the box visible + gives it real layout),
    // then clamp into the viewport — flip above the word on bottom overflow, clamp left on right
    // overflow. Minimal + self-contained (A6's smart placement is a separate card).
    // getBoundingClientRect on the shared element reads real page layout even from this world.
    el.style.left = `${anchor.x}px`;
    el.style.top = `${anchor.y + anchor.h}px`;
    el.setAttribute('open', '');
    const r = el.getBoundingClientRect();
    const vw = globalThis.innerWidth ?? 0;
    const vh = globalThis.innerHeight ?? 0;
    let left = anchor.x;
    let top = anchor.y + anchor.h;
    if (r.width && left + r.width > vw) left = Math.max(0, vw - r.width - 8);
    if (r.height && top + r.height > vh) top = Math.max(0, anchor.y - r.height);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  hide(): void {
    this.element.removeAttribute('open');
  }
}
