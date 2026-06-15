import type { LookupError } from '../index';
import { adoptStyles } from './styles/adopt';
import { BASE_VARS, THEME_CSS, BRAND_MARK_SVG } from './styles/tokens';

/**
 * A branded string type that marks HTML which has already passed the
 * sanitization pipeline (DOMPurify allowlist in adapters-shared, S4).
 * Never cast raw API content to SafeHtml — only the sanitizer may do so.
 */
export type SafeHtml = string & { readonly __brand: 'SafeHtml' };

/**
 * The three states the lookup card can display.
 * When kind === 'result', `safeHtml` MUST be the output of the sanitization
 * pipeline — never pass raw API content directly.
 */
export type CardState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result'; safeHtml: SafeHtml; word: string; target: string }
  | { kind: 'error'; error: LookupError };

// Decorative shadow-DOM icons. Stroked with currentColor so they inherit the token
// colour of their button; aria-hidden because each control carries its own aria-label.
const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12"/></svg>';
const ICON_SHIELD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5 2v3.4c0 3-2.1 5.2-5 6.2-2.9-1-5-3.2-5-6.2V3.8l5-2z"/></svg>';
// "Tune" sliders — the header's always-available path to the options page.
export const ICON_SETTINGS =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 5H4.2M7.8 5H13.5M2.5 11H8.2M11.8 11H13.5"/><circle cx="6" cy="5" r="1.8"/><circle cx="10" cy="11" r="1.8"/></svg>';

// Content lives in the card's LIGHT DOM, projected through a <slot>, so the shadow rules
// target slotted nodes via ::slotted(). `color`/`font` are inherited and cross the slot
// boundary from :host automatically. The card carries the full cozy surface (the
// <bottom-sheet> panel is neutralised so this is the single visible surface). Light by
// default; THEME_DARK_CSS swaps the palette per the stamped theme attribute.
// Page CSS reaches these slotted light-DOM nodes too, and an outer tree's NORMAL declarations
// beat the shadow's normal ::slotted() ones (CSS Scoping tree-context order) — a host reset as
// mundane as `button{margin:0}` was enough to shove the setup CTA off-centre. The setup-invite
// rules are therefore !important: IMPORTANT declarations from the inner tree win the same
// tiebreak against any outer author CSS, reset or not, regardless of specificity.
// @keyframes spin is also defined in lookup-trigger.ts; each shadow root needs its own copy
// because CSS @keyframes are scoped per shadow tree — they cannot be shared across roots.
// The loading spinner is the ::before pseudo-element of the slotted .loadrow caption (styled
// via ::slotted(.loadrow)::before); per CSS Scoping Level 1, @keyframes defined in a shadow
// tree are not reliably in scope for light-DOM nodes, so we also inject the rule into the
// document stylesheet once on element registration as a belt-and-suspenders fallback.
const CSS = `:host{${BASE_VARS};display:block;box-sizing:border-box;width:100%;max-width:var(--adp-card-width);margin:0 auto;font:var(--adp-text-body)/var(--adp-leading-body) var(--adp-font-sans);color:var(--ad-ink);background:var(--ad-glow),var(--ad-surface);border-radius:var(--adp-radius-card);box-shadow:var(--ad-shadow-card);overflow:hidden;color-scheme:light}
${THEME_CSS}
::selection{background:var(--ad-selection)}
/* The 3px spruce→clay accent strip replaces the old festive rainbow ribbon: one quiet sweep,
   clipped by the card's 18px radius. Decorative — aria-hidden on the element. */
.accent{height:3px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm) 92%)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px 2px 16px}
.brand{display:inline-flex;align-items:center;gap:7px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:21px;height:21px;flex:none}
.actions{display:inline-flex;align-items:center;gap:4px}
button[data-act]{display:inline-grid;place-items:center;height:var(--adp-action-size);width:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
button[data-act]:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
button[data-act]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button[data-act] svg{pointer-events:none;flex:none}
/* Close stays a bare icon — its X is universally understood and keeps the right-most spot. */
button[data-act="close"] svg{width:15px;height:15px}
/* Settings is the labeled .text variant: gear + the word "Settings", widened, hover-fill like
   the other icon buttons. The visible word removes the icon ambiguity with Close. */
button[data-act="settings"]{display:inline-flex;align-items:center;gap:5px;width:auto;padding:0 11px 0 9px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);letter-spacing:.01em}
button[data-act="settings"] svg{width:14px;height:14px}
button[data-act="settings"] .lbl{line-height:1}
@media (prefers-reduced-motion:reduce){button[data-act]{transition:none}}
.region{padding:2px 16px 2px}
.footer{display:flex;align-items:center;gap:6px;margin:8px 16px 0;padding:10px 0 13px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
.footer svg{width:13px;height:13px;flex:none}
/* The signature headword: one serif (Georgia), with a 44×3px spruce→clay underline swatch —
   reads like a dictionary entry's rule. Georgia is the ONLY serif on the surface. */
::slotted(h2){font-family:var(--adp-font-serif);font-size:var(--adp-text-headword);line-height:var(--adp-leading-tight);letter-spacing:var(--adp-tracking-head);margin:.1em 0 .4em;color:var(--ad-ink);display:inline-block;max-width:100%;overflow-wrap:anywhere;padding-bottom:5px;background:linear-gradient(90deg,var(--ad-accent),var(--ad-warm)) left bottom/44px 3px no-repeat}
::slotted(.err){color:var(--ad-error);font-weight:500}
::slotted(.mark){display:block !important;width:34px !important;height:34px !important;margin:16px auto 2px !important}
::slotted(.setup-title){text-align:center !important;margin:8px 0 0 !important;font-size:var(--adp-text-lg) !important;font-weight:var(--adp-weight-bold) !important;color:var(--ad-ink) !important}
::slotted(.setup-text){text-align:center !important;margin:6px auto 0 !important;max-width:32ch !important;font-size:13.5px !important;line-height:1.55 !important;color:var(--ad-ink-soft) !important}
::slotted(.setup-cta){display:block !important;margin:15px auto 6px !important;padding:9px 18px !important;border:0 !important;border-radius:var(--adp-radius-control) !important;background:var(--ad-accent) !important;color:var(--ad-on-accent) !important;font:inherit !important;font-size:var(--adp-text-sm) !important;font-weight:var(--adp-weight-semi) !important;text-align:center !important;cursor:pointer !important}
::slotted(.setup-cta:hover){filter:brightness(1.06)}
::slotted(.setup-cta:focus-visible){outline:2px solid var(--ad-accent) !important;outline-offset:2px !important}
@keyframes spin{to{transform:rotate(360deg)}}
::slotted(.loadrow){display:flex;align-items:center;gap:9px;margin:4px 0 9px;color:var(--ad-ink-soft);font-size:14px}
::slotted(.loadrow)::before{content:"";display:block;width:15px;height:15px;flex:none;border:2px solid var(--ad-line);border-top-color:var(--ad-accent);border-radius:50%;animation:spin .77s linear infinite}
@media (prefers-reduced-motion:reduce){::slotted(.loadrow)::before{animation:none}}`;

// Inject @keyframes spin into the document once so Firefox/Safari (which follow CSS
// Scoping Level 1 strictly) can resolve the animation on the light-DOM .spinner node.
let _docKeyframesInjected = false;
function ensureDocKeyframes(): void {
  if (_docKeyframesInjected) return;
  _docKeyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.append(style);
}

/**
 * The "open the options page" button. It dispatches a composed `open-settings` event that the
 * platform shell catches (content script → service worker `openOptionsPage`; side panel calls
 * it directly). The UI layer stays platform-agnostic — it never touches chrome.* itself.
 */
function settingsCta(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'setup-cta';
  b.textContent = label;
  b.addEventListener('click', () =>
    b.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true })),
  );
  return b;
}

/**
 * First-run, no-key state. A keyless lookup can never succeed, so rather than a red failure we
 * render a warm setup nudge: the holly mark, a plain explainer that AI Dictionary runs on the
 * reader's own free Gemini key, and a single "Open Settings" action. Returned as top-level
 * light-DOM nodes so the card's `::slotted(...)` rules style them across the world boundary.
 */
function renderSetupInvite(): Node[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = BRAND_MARK_SVG; // decorative (aria-hidden in BRAND_MARK_SVG); text carries meaning
  const mark = tpl.content.firstElementChild as Element;
  const title = document.createElement('p');
  title.className = 'setup-title';
  title.textContent = 'Set up AI Dictionary';
  const text = document.createElement('p');
  text.className = 'setup-text';
  text.textContent =
    'AI Dictionary uses your own free Google Gemini key. Add it once to start looking up words.';
  return [mark, title, text, settingsCta('Open Settings')];
}

/**
 * Build the card's display content for a given state as LIGHT-DOM nodes.
 *
 * The nodes are placed in the card's light DOM (not its shadow) and projected
 * through a <slot>. This is what makes the card controllable across the Chrome
 * MV3 content-script world boundary: an isolated-world script can write shared-DOM
 * nodes, but cannot reach the JS `state` setter of a custom element whose class is
 * registered in the page's MAIN world (Chromium 390807). Same-world callers
 * (side panel) use the `state` setter, which funnels through this same helper.
 */
export function renderCardState(state: CardState): Node[] {
  if (state.kind === 'loading') {
    // The loading state must read as a populated, on-brand card, never an empty box. We show
    // the reader's own selected word as the headword the instant they click (it is known long
    // before the model replies), then a visible "Looking up the meaning…" caption with a small
    // amber spinner. The spinner is the caption's ::before pseudo-element (styled in CSS via
    // ::slotted(.loadrow)::before), so the rotating ring can never drag the text around with it
    // and we need no separate, rotation-prone ring element.
    // The caption is visible body text (not visually-hidden): the card's own aria-live="polite"
    // section announces it once. role="status" is intentionally omitted to avoid a nested live
    // region double-announcing in NVDA/JAWS.
    const nodes: Node[] = [];
    if (state.word) {
      const h = document.createElement('h2');
      h.textContent = state.word;
      nodes.push(h);
    }
    const cap = document.createElement('span');
    cap.className = 'loadrow';
    cap.textContent = 'Looking up the meaning…';
    nodes.push(cap);
    return nodes;
  }
  if (state.kind === 'error') {
    // First-run with no key isn't a failure, it's setup that hasn't happened yet — show a
    // warm onboarding nudge instead of a red error so the reader knows exactly what to do.
    if (state.error.code === 'NO_KEY') return renderSetupInvite();
    const h = document.createElement('h2');
    h.textContent = 'Lookup failed';
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = state.error.message;
    // A rejected key is the same dead-end as no key: hand the reader a way to fix it.
    if (state.error.code === 'INVALID_KEY') return [h, p, settingsCta('Open Settings')];
    return [h, p];
  }
  const h = document.createElement('h2');
  h.textContent = state.word;
  const body = document.createElement('div');
  body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
  return [h, body];
}

export class LookupCard extends HTMLElement {
  private _state: CardState = { kind: 'loading' };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    ensureDocKeyframes(); // inject document @keyframes for light-DOM spinner (Firefox/Safari)
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>AI Dictionary</span>`;
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      this.actionButton('settings', 'Settings', ICON_SETTINGS),
      this.actionButton('close', 'Close', ICON_CLOSE),
    );
    bar.append(brand, actions);

    const region = document.createElement('section');
    region.className = 'region';
    region.setAttribute('aria-live', 'polite');
    region.append(document.createElement('slot'));

    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`;

    // 3px spruce → clay accent strip; decorative (aria-hidden), clipped by the rounded host
    const accent = document.createElement('div');
    accent.className = 'accent';
    accent.setAttribute('aria-hidden', 'true');

    root.append(accent, bar, region, footer);
    // Seed the default loading content only when nothing was provided before connection.
    // The content-script renderer writes light DOM directly across the world boundary;
    // overwriting it here (the MAIN-world upgrade can run after that write) would clobber
    // an already-rendered result back to "Looking up…".
    if (this.childNodes.length === 0) this.renderState();
  }

  private actionButton(act: 'settings' | 'close', label: string, icon: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon; // decorative aria-hidden SVG; accessible name comes from aria-label
    // Settings carries a visible "Settings" word so it reads as a control, not a twin of the
    // bare X. aria-label still wins as the accessible name, so this never double-announces.
    if (act === 'settings') {
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = label;
      b.append(lbl);
    }
    // The settings action reuses the `open-settings` event name the shells already route to
    // the options page (content script → service worker; side panel directly) — see settingsCta.
    const event = act === 'settings' ? 'open-settings' : act;
    b.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true })),
    );
    return b;
  }

  set state(s: CardState) {
    this._state = s;
    this.renderState();
  }
  get state(): CardState {
    return this._state;
  }

  /** Render the current state into the card's LIGHT DOM (projected via <slot>). */
  private renderState(): void {
    this.replaceChildren(...renderCardState(this._state));
  }
}
