import type { AnchorRect } from '../domain/types';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

export interface HoverRecallValue {
  word: string;
  preview: string;
}

// A small floating card, deliberately simpler than <lookup-card>/<bottom-sheet> — B4's design
// spec §2.4 pins this as plain text only (never innerHTML), so there is no sanitize surface here
// at all. Positioned by the caller (the Chrome adapter, packages/extension-chrome/src/adapters/
// chrome-hover-recall-popup.ts) via inline left/top; this element owns only its own box styling.
const CSS = `:host{all:initial;${BASE_VARS};position:fixed;z-index:var(--adp-z-overlay);color-scheme:light;font:var(--adp-text-sm)/1.4 var(--adp-font-sans)}
${THEME_CSS}
.pop{max-width:260px;padding:10px 12px;border-radius:var(--adp-radius-control);background:var(--ad-surface);border:1px solid var(--ad-line-strong);box-shadow:var(--ad-shadow-card);color:var(--ad-ink)}
.word{display:block;font-family:var(--adp-font-serif);font-weight:var(--adp-weight-bold);font-size:15px;margin-bottom:2px}
.preview{display:block;margin:0 0 8px;color:var(--ad-ink-soft);overflow-wrap:anywhere}
.view-link{display:inline-flex;border:0;background:transparent;color:var(--ad-accent-ink);font:inherit;font-weight:var(--adp-weight-semi);padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.view-link:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}`;

export class HoverRecallPopup extends HTMLElement {
  private wordEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private currentWord = '';

  connectedCallback(): void {
    this.hidden = true;
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'note');
    this.wordEl = document.createElement('strong');
    this.wordEl.className = 'word';
    this.previewEl = document.createElement('span');
    this.previewEl.className = 'preview';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'view-link';
    link.textContent = 'View full entry';
    link.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('view-full-entry', {
          detail: { word: this.currentWord },
          bubbles: true,
          composed: true,
        }),
      );
    });
    pop.append(this.wordEl, this.previewEl, link);
    root.append(pop);
  }

  show(anchor: AnchorRect, value: HoverRecallValue): void {
    this.currentWord = value.word;
    this.wordEl.textContent = value.word;
    this.previewEl.textContent = value.preview; // textContent only — never innerHTML (no sanitize surface)
    this.hidden = false;
    this.style.left = `${anchor.x}px`;
    this.style.top = `${anchor.y + anchor.h}px`;
    // Clamp to the viewport once the box has real layout (happy-dom returns a zero rect — a
    // harmless no-op there; verified for real in the e2e suite, design spec §5.7).
    const r = this.getBoundingClientRect();
    const vw = globalThis.innerWidth ?? 0;
    const vh = globalThis.innerHeight ?? 0;
    let left = anchor.x;
    let top = anchor.y + anchor.h;
    if (r.width && left + r.width > vw) left = Math.max(0, vw - r.width - 8);
    if (r.height && top + r.height > vh) top = Math.max(0, anchor.y - r.height);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }

  hide(): void {
    this.hidden = true;
  }
}
