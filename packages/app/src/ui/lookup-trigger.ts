import { adoptStyles } from './styles/adopt';
import { LIGHT_VARS, DARK_VARS, HOLLY_SVG } from './styles/tokens';

// `all:initial` isolates the host from arbitrary page CSS; it does NOT reset custom
// properties, so the cozy --ad-* tokens declared alongside it survive. `color-scheme:
// light dark` lets the pill adapt to the page/OS theme, and because every colour is set
// explicitly from the warm token palette, the old `canvastext` regression (an invisible
// "Define" on dark-theme pages) cannot recur. `z-index:2147483647` lifts the host above
// page stacking contexts — `all:initial` would otherwise reset it to `auto`, letting a
// positioned, positive-z ancestor of the selection occlude the trigger (support.claude.com
// wraps headings in a `z-3` container).
// @keyframes spin is duplicated per shadow root — keyframes are scoped per shadow tree.
const CSS = `:host{all:initial;${LIGHT_VARS};z-index:2147483647;color-scheme:light dark}
@media (prefers-color-scheme:dark){:host{${DARK_VARS}}}
button{display:inline-flex;align-items:center;gap:7px;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ad-ink);background:var(--ad-surface);border:1px solid var(--ad-line);padding:7px 12px 7px 9px;border-radius:999px;box-shadow:0 2px 5px oklch(0.4 0.05 50 / 0.16),0 10px 22px -10px oklch(0.4 0.06 45 / 0.4);cursor:pointer}
button:hover{background:var(--ad-surface-soft)}
button:focus-visible{outline:2px solid var(--ad-amber);outline-offset:2px}
.holly{width:18px;height:18px;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:13px;height:13px;border:2px solid var(--ad-line);border-top-color:var(--ad-amber);border-radius:50%;animation:spin .7s linear infinite}`;

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
    // Holly mark + visible label. The holly is decorative (aria-hidden in HOLLY_SVG); the
    // button's accessible name comes from aria-label, so the name is stable across states.
    btn.innerHTML = `${HOLLY_SVG}<span class="label">Define</span>`;
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
