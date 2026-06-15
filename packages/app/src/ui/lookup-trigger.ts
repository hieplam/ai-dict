import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG } from './styles/tokens';

// `all:initial` isolates the host from arbitrary page CSS; it does NOT reset custom
// properties, so the Paperlight --ad-*/--adp-* tokens declared alongside it survive. The
// pill is sepia (warm paper) by default; THEME_CSS re-binds the palette when the composition
// root stamps data-ad-theme="dark"|"contrast" (or "system" on a dark OS). Because every colour
// is set explicitly from the token palette, the old `canvastext` regression (an invisible
// "Define" on dark-theme pages) cannot recur. The overlay z-index lifts the host above page
// stacking contexts — `all:initial` would otherwise reset it to `auto`, letting a positioned,
// positive-z ancestor of the selection occlude the trigger (support.claude.com wraps headings
// in a `z-3` container).
// @keyframes spin is duplicated per shadow root — keyframes are scoped per shadow tree.
const CSS = `:host{all:initial;${BASE_VARS};z-index:var(--adp-z-overlay);color-scheme:light}
${THEME_CSS}
button{display:inline-flex;align-items:center;gap:7px;font:var(--adp-weight-semi) var(--adp-text-sm)/1 var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-surface);border:1px solid var(--ad-line-strong);padding:7px 13px 7px 10px;border-radius:var(--adp-radius-pill);box-shadow:var(--ad-shadow-trigger);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),transform var(--adp-dur-fast) var(--adp-ease)}
button:hover{background:var(--ad-surface-raised);transform:translateY(-1px)}
button:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){button{transition:none}button:hover{transform:none}}
.mark{width:18px;height:18px;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){.spinner{animation:none}}`;

export class LookupTrigger extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);
    const btn = document.createElement('button');
    btn.type = 'button';
    // NOTE: no role="button" — a native <button> already carries the implicit ARIA role
    // 'button'; setting it explicitly violates the First Rule of ARIA and can cause screen
    // readers to announce "button button".
    btn.setAttribute('aria-label', 'Look up selected text');
    // Brand mark + visible label. The mark is decorative (aria-hidden in BRAND_MARK_SVG); the
    // button's accessible name comes from aria-label, so the name is stable across states.
    btn.innerHTML = `${BRAND_MARK_SVG}<span class="label">Define</span>`;
    btn.addEventListener('click', () => {
      // swap label → spinner; `disabled` alone signals unavailability — aria-busy on a
      // disabled button is contradictory (AT removes disabled buttons from the tree).
      btn.disabled = true;
      btn.querySelector('.label')?.remove();
      const ring = document.createElement('span');
      ring.className = 'spinner';
      ring.setAttribute('aria-hidden', 'true'); // decorative; btn retains its aria-label
      btn.append(ring);
      this.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true, composed: true }));
    });
    root.append(btn);
  }
}
