import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';

export interface HoverRecallValue {
  word: string;
  preview: string;
}

// A small floating card, deliberately simpler than <lookup-card>/<bottom-sheet>. B4's design
// spec §2.4 pins it to PLAIN TEXT only (textContent, never innerHTML) — no sanitize surface here.
//
// Cross-world contract: this element is DEFINED in the page's MAIN world (content-elements.ts,
// world:MAIN) but DRIVEN from content.ts's ISOLATED world via the ChromeHoverRecallPopup adapter.
// A JS method/property call never crosses that boundary (Chromium 390807 — see
// inline-bottom-sheet-renderer.ts:74-81), so the adapter drives this element ONLY through
// shared-DOM ATTRIBUTES: `word`/`preview` carry the content, presence of `open` toggles
// visibility, `data-ad-theme` re-themes. attributeChangedCallback (dispatched in this element's
// MAIN world whenever ANY world mutates the shared node's attribute) re-renders the text.
// Visibility is an EXPLICIT shadow rule `:host([open])` — never the UA `[hidden]` rule, which
// `all:initial` on :host resets away (its display would fall back to `inline`, staying visible).
const CSS = `:host{all:initial;${BASE_VARS};position:fixed;z-index:var(--adp-z-overlay);color-scheme:light;font:var(--adp-text-sm)/1.4 var(--adp-font-sans);display:none}
:host([open]){display:block}
${THEME_CSS}
.pop{max-width:260px;padding:10px 12px;border-radius:var(--adp-radius-control);background:var(--ad-surface);border:1px solid var(--ad-line-strong);box-shadow:var(--ad-shadow-card);color:var(--ad-ink)}
.word{display:block;font-family:var(--adp-font-serif);font-weight:var(--adp-weight-bold);font-size:15px;margin-bottom:2px}
.preview{display:block;margin:0 0 8px;color:var(--ad-ink-soft);overflow-wrap:anywhere}
.view-link{display:inline-flex;border:0;background:transparent;color:var(--ad-accent-ink);font:inherit;font-weight:var(--adp-weight-semi);padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.view-link:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}`;

export class HoverRecallPopup extends HTMLElement {
  static readonly observedAttributes = ['word', 'preview'];

  private wordEl!: HTMLElement;
  private previewEl!: HTMLElement;

  connectedCallback(): void {
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
          detail: { word: this.getAttribute('word') ?? '' },
          bubbles: true,
          composed: true,
        }),
      );
    });
    pop.append(this.wordEl, this.previewEl, link);
    root.append(pop);
    // Paint any attributes the adapter set BEFORE this element upgraded — same pre-upgrade
    // attribute-read pattern lookup-card uses for data-ad-theme/side-panel in connectedCallback.
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.shadowRoot) this.render();
  }

  private render(): void {
    // textContent ONLY — never innerHTML (S4: this element has no sanitize surface by construction).
    this.wordEl.textContent = this.getAttribute('word') ?? '';
    this.previewEl.textContent = this.getAttribute('preview') ?? '';
  }
}
