import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS } from './styles/tokens';
import type { SafeHtml } from './lookup-card';

/**
 * A5: the compact "Compact gloss" bubble — a one-line translation floating at the selection,
 * shown instead of the full card when gloss mode applies (see InlineBottomSheetRenderer).
 * Structurally closest to <lookup-trigger>: a shadow root wrapping a single native <button>,
 * styled as a small pill with the same token set. Content is written to the element's LIGHT DOM
 * and projected through a <slot> inside the shadow button — the same cross-world-safe pattern
 * <lookup-card> uses (Chromium bug 390807) — so callers use replaceChildren(...), never a
 * `.state` setter.
 */
export type GlossState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; word: string; safeHtml: SafeHtml };

export function renderGlossState(state: GlossState): Node[] {
  const word = document.createElement('strong');
  word.textContent = state.word ?? '…';
  if (state.kind === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'gloss-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    return [word, spinner];
  }
  const text = document.createElement('span');
  text.className = 'gloss-text';
  text.innerHTML = state.safeHtml; // trusted: sanitized upstream by the caller (S4)
  return [word, text];
}

const CSS = `:host{all:initial;${BASE_VARS};z-index:var(--adp-z-overlay);color-scheme:light}
${THEME_CSS}
button{display:inline-flex;align-items:center;gap:6px;max-width:280px;font:var(--adp-weight-semi) var(--adp-text-sm)/1.3 var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-surface);border:1px solid var(--ad-line-strong);padding:7px 13px;border-radius:var(--adp-radius-pill);box-shadow:var(--ad-shadow-trigger);cursor:pointer}
button:hover{background:var(--ad-surface-raised)}
button:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
.gloss-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ad-ink-soft)}
.gloss-text p{display:inline;margin:0}
@keyframes spin{to{transform:rotate(360deg)}}
.gloss-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){.gloss-spinner{animation:none}}`;

export class LookupGloss extends HTMLElement {
  private btn: HTMLButtonElement | null = null;

  static get observedAttributes(): string[] {
    return ['aria-label'];
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'aria-label' && this.btn) {
      if (value === null) this.btn.removeAttribute('aria-label');
      else this.btn.setAttribute('aria-label', value);
    }
  }

  connectedCallback(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(document.createElement('slot'));
    btn.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('expand', { bubbles: true, composed: true })),
    );
    root.append(btn);
    this.btn = btn;
    const label = this.getAttribute('aria-label');
    if (label !== null) btn.setAttribute('aria-label', label);
  }
}
