import type { LookupError, Provider, SavedWordStatus, RefineKind } from '../index';
import { adoptStyles } from './styles/adopt';
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
  ICON_SPEAKER,
  ICON_BACK,
  ICON_MUTE,
  ICON_PIN,
} from './styles/tokens';

// Re-exported so existing consumers (side-panel-view) and the c3-117 public surface keep
// importing ICON_SETTINGS from here; the canonical glyph now lives in tokens.ts (§5.10).
export { ICON_SETTINGS };

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
  | {
      kind: 'result';
      safeHtml: SafeHtml;
      word: string;
      target: string;
      provider?: Provider;
      fallbackFrom?: Provider;
      /** Providers the reader may switch to; when ≥2, the card shows a one-shot picker. */
      providers?: Provider[];
      /** A8: the idiom/literal unit actually defined; renders a label + "Show literal word"
       * button when `isIdiom` is true. */
      definedAs?: { term: string; isIdiom: boolean };
      /** B1: whether this word is currently starred/saved — drives the save row's fill state. */
      saved?: boolean;
      /** B5: current status of a saved word ('learning' default | 'known' manual) — only
       * meaningful when `saved === true`; absent/undefined hides the status toggle (matches B1's
       * own no-round-trip precedent: a fresh render never knows a persisted status until the star
       * is (re-)tapped and the saved.save reply's entry.status seeds it — see content.ts/side-panel.ts). */
      status?: SavedWordStatus;
      /** B7: whether to show the repeat-offender nudge banner — stamped once, ever, per word by
       * the router the moment its within-30-day history count first crosses the threshold. */
      nudge?: boolean;
      /** A9: true when this result was served from the local cache (zero tokens, no network
       * call) — see domain/cache-policy.ts's cacheGet. Renders a leading "Cached" badge in the
       * meta-row. Always explicit true/false when the composition root threads a real
       * LookupResult (LookupResult.fromCache is a required field); absent only for hand-built
       * test/legacy CardState literals that predate this field. */
      fromCache?: boolean;
      /** A3: true only for the in-page card — InlineBottomSheetRenderer always sets it; the
       * side panel never does, so the row is absent there by construction (design spec §2.6). */
      refineChips?: boolean;
      /** A3: which refine (if any) produced this rendered result; undefined = the original.
       * Only meaningful when refineChips is true. */
      refine?: RefineKind;
      /** A2: true when this result has a parent frame to return to (a Back button renders).
       * Only ever set by the in-page card's own recursive-lookup workflow — the side panel
       * deliberately omits it (see side-panel.ts's resultToFocus), mirroring how A8's
       * onForceLiteral / the one-shot provider picker are also in-page-card-only. */
      canGoBack?: boolean;
      /** A7: whether this rendering surface supports pinning at all — undefined means "not
       * applicable" (e.g. the side panel, which is already persistent and never sets this — see
       * side-panel-view.ts, unchanged by this card); when defined, true means capacity remains
       * (fewer than 3 pinned) and false means the cap is reached. */
      canPin?: boolean;
      /** A7: whether this specific card instance has already been detached into a pinned floating
       * card. Only meaningful when canPin !== undefined. Renders the pin control as an inert
       * "Pinned" badge and strips the word-level controls entirely (see renderCardState). */
      pinned?: boolean;
    }
  | {
      kind: 'streaming';
      word: string;
      safeHtml: SafeHtml;
      /** A8: shown as soon as the header resolves; same shape as the 'result' variant's field. */
      definedAs?: { term: string; isIdiom: boolean };
    }
  | { kind: 'error'; error: LookupError };

/** Display names for each provider — the ONLY user-facing provider wording on the card. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'ChatGPT',
  anthropic: 'Claude',
};

function providerLabel(p: Provider): string {
  return PROVIDER_LABELS[p] ?? p;
}

export interface RefineChip {
  id: RefineKind;
  label: string;
}

/** A3: the fixed v1 refine chip row (roadmap scope fence: "Fixed 4 chips in v1, not
 * configurable"). B13 (wave 2) appends a 5th 'related' entry — see the A3 design spec §2.8. */
export const REFINE_CHIPS: RefineChip[] = [
  { id: 'simpler', label: 'Simpler' },
  { id: 'examples', label: 'More examples' },
  { id: 'etymology', label: 'Etymology' },
  { id: 'usage', label: 'Use it' },
  { id: 'related', label: 'Related words' },
];

// Icons (ICON_CLOSE, ICON_SHIELD, ICON_SETTINGS) are the canonical §5.10 set, imported from
// tokens.ts above. Stroked with currentColor so they inherit the token colour of their button;
// aria-hidden because each control carries its own aria-label.

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
/* One consistent 22px horizontal gutter on bar, body region and footer (§5.11) so the brand
   mark, headword, body text and footer line all share the same left edge and an equal right
   margin — mirrors the reference .ad-card__bar/.ad-body-region/.ad-footer padding. */
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 22px 6px}
.brand{display:inline-flex;align-items:center;gap:7px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-bold);letter-spacing:var(--adp-tracking-label);color:var(--ad-accent-ink)}
.mark{width:21px;height:21px;flex:none}
.actions{display:inline-flex;align-items:center;gap:4px}
button[data-act]{display:inline-grid;place-items:center;height:var(--adp-action-size);width:var(--adp-action-size);border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;font:inherit;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
button[data-act]:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
button[data-act]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
button[data-act] svg{pointer-events:none;flex:none}
/* Close stays a bare icon — its X is universally understood and keeps the right-most spot. */
button[data-act="close"] svg{width:14px;height:14px}
button[data-act="side-panel"] svg{width:15px;height:15px}
/* Settings is the labeled .text variant: gear + the word "Settings", widened, hover-fill like
   the other icon buttons. The visible word removes the icon ambiguity with Close. */
button[data-act="settings"]{display:inline-flex;align-items:center;gap:5px;width:auto;padding:0 11px 0 9px;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);letter-spacing:.01em}
button[data-act="settings"] svg{width:15px;height:15px}
button[data-act="settings"] .lbl{line-height:1}
@media (prefers-reduced-motion:reduce){button[data-act]{transition:none}}
.region{padding:2px 22px 2px}
.footer{display:flex;align-items:center;gap:6px;margin:8px 22px 0;padding:10px 0 13px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
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
@media (prefers-reduced-motion:reduce){::slotted(.loadrow)::before{animation:none}}
::slotted(.errlog-consent){margin:10px 16px 0;padding-top:10px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
/* The result metadata row (provider badge + fallback note + one-shot picker). Only the row is a
   direct slotted child, so ::slotted sets its layout + the color/font its children inherit; the
   children's own box decorations live in CARD_DOC_CSS (::slotted cannot reach a slotted node's
   descendants). */
::slotted(.meta-row){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:9px 0 0;font-size:var(--adp-text-2xs);color:var(--ad-ink-faint)}
::slotted(.defined-as){display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 8px;font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
::slotted(.back-row){display:flex;margin:2px 0 8px}
::slotted(.save-row){display:flex;margin:6px 0 10px}
::slotted(.pin-row){display:flex;justify-content:flex-end;margin:0 0 6px}
::slotted(.refine-row){display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0 2px}
::slotted(.speak-btn){display:inline-flex;vertical-align:middle;margin:0 0 .35em 8px}
::slotted(.nudge-row){display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:7px 10px;border:1px solid var(--ad-accent);border-radius:var(--adp-radius-control);background:var(--ad-surface-raised)}`;

// Descendants of the slotted .meta-row cannot be reached by ::slotted() (it only matches the
// top-level assigned node), so their box decorations are injected ONCE into the document, scoped
// under `lookup-card` so nothing leaks. The --ad-*/--adp-* tokens are declared on the card :host
// and inherit into its light-DOM children, so these page-level rules resolve the themed values.
const CARD_DOC_CSS = `@keyframes spin{to{transform:rotate(360deg)}}
lookup-card .prov-badge{border:1px solid var(--ad-line);border-radius:var(--adp-radius-control);padding:1px 8px;color:var(--ad-ink-soft)}
lookup-card .cache-badge{border:1px solid var(--ad-accent);border-radius:var(--adp-radius-control);padding:1px 8px;color:var(--ad-accent-ink);background:var(--ad-accent-soft)}
lookup-card .fallback-note{font-style:italic;color:var(--ad-ink-faint)}
lookup-card .prov-switch{margin-left:auto;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .prov-switch:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .prov-switch:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .prov-menu{display:flex;flex-wrap:wrap;gap:5px;width:100%;margin-top:2px}
lookup-card .prov-menu[hidden]{display:none}
lookup-card .prov-menu [role=option]{border:1px solid var(--ad-line);background:var(--ad-surface);color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .prov-menu [role=option]:hover:not([disabled]){background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .prov-menu [role=option]:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .prov-menu [role=option][disabled]{opacity:.55;cursor:default}
lookup-card .defined-as__label{font-style:italic}
lookup-card .defined-as__literal-btn{border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:2px 10px;font:inherit;font-size:var(--adp-text-2xs);cursor:pointer}
lookup-card .defined-as__literal-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .defined-as__literal-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .back-btn{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 10px 5px 6px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .back-btn svg{width:15px;height:15px;pointer-events:none}
lookup-card .back-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .back-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){lookup-card .back-btn{transition:none}}
lookup-card .save-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .save-btn svg{width:15px;height:15px;pointer-events:none;fill:none;stroke:currentColor}
lookup-card .save-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .save-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .save-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
lookup-card .save-btn[aria-pressed="true"] svg{fill:var(--ad-accent);stroke:var(--ad-accent)}
@media (prefers-reduced-motion:reduce){lookup-card .save-btn{transition:none}}
lookup-card .status-btn{display:inline-flex;align-items:center;margin-left:8px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:5px 12px;font:inherit;font-size:var(--adp-text-xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .status-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .status-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .status-btn[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
@media (prefers-reduced-motion:reduce){lookup-card .status-btn{transition:none}}
lookup-card .refine-chip{border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:4px 11px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .refine-chip:hover:not(:disabled){background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .refine-chip:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .refine-chip[aria-pressed="true"]{border-color:var(--ad-accent);color:var(--ad-accent-ink);cursor:default}
lookup-card .refine-chip:disabled{opacity:.85}
@media (prefers-reduced-motion:reduce){lookup-card .refine-chip{transition:none}}
lookup-card .refine-back-btn{border:1px solid var(--ad-accent);background:transparent;color:var(--ad-accent-ink);border-radius:var(--adp-radius-control);padding:4px 11px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer}
lookup-card .refine-back-btn:hover{background:var(--ad-surface-raised)}
lookup-card .refine-back-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .speak-btn{display:inline-grid;place-items:center;width:26px;height:26px;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .speak-btn svg{width:16px;height:16px;pointer-events:none}
lookup-card .speak-btn:hover{background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .speak-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){lookup-card .speak-btn{transition:none}}
lookup-card .nudge-row__text{flex:1 1 auto;min-width:0;font-size:var(--adp-text-2xs);color:var(--ad-ink)}
lookup-card .nudge-row__save-btn{flex:none;border:1px solid var(--ad-accent);background:var(--ad-accent);color:var(--ad-on-accent);border-radius:var(--adp-radius-control);padding:3px 11px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer}
lookup-card .nudge-row__save-btn:hover{filter:brightness(1.06)}
lookup-card .nudge-row__save-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .nudge-row__dismiss-btn{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border:0;background:transparent;color:var(--ad-ink-faint);border-radius:var(--adp-radius-control);cursor:pointer}
lookup-card .nudge-row__dismiss-btn svg{width:12px;height:12px;pointer-events:none}
lookup-card .nudge-row__dismiss-btn:hover{background:var(--ad-surface);color:var(--ad-ink)}
lookup-card .nudge-row__dismiss-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .pin-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ad-line);background:transparent;color:var(--ad-ink-soft);border-radius:var(--adp-radius-control);padding:4px 10px;font:inherit;font-size:var(--adp-text-2xs);font-weight:var(--adp-weight-semi);cursor:pointer;transition:background var(--adp-dur-fast) var(--adp-ease),color var(--adp-dur-fast) var(--adp-ease),border-color var(--adp-dur-fast) var(--adp-ease)}
lookup-card .pin-btn svg{width:15px;height:15px;pointer-events:none}
lookup-card .pin-btn:hover:not(:disabled){background:var(--ad-surface-raised);color:var(--ad-ink)}
lookup-card .pin-btn:focus-visible{outline:2px solid var(--ad-accent);outline-offset:2px}
lookup-card .pin-btn[aria-pressed='true']{border-color:var(--ad-accent);color:var(--ad-accent-ink)}
lookup-card .pin-btn:disabled{opacity:.55;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){lookup-card .pin-btn{transition:none}}`;

// Inject the document-scoped card styles once: the @keyframes spin (so Firefox/Safari, which
// follow CSS Scoping Level 1 strictly, can resolve the animation on the light-DOM spinner) and
// the .meta-row descendant decorations that ::slotted() cannot reach.
let _docStylesInjected = false;
function ensureCardDocStyles(): void {
  if (_docStylesInjected) return;
  _docStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = CARD_DOC_CSS;
  document.head.append(style);
}

/**
 * The "open the options page" button. It dispatches a composed `open-settings` event that the
 * platform shell catches (content script → service worker `openOptionsPage`; side panel calls
 * it directly). The UI layer stays platform-agnostic — it never touches chrome.* itself.
 */
function settingsCta(label: string, opts?: { fixKey?: boolean }): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'setup-cta';
  b.textContent = label;
  b.addEventListener('click', () =>
    b.dispatchEvent(
      new CustomEvent('open-settings', {
        detail: opts?.fixKey ? { fixKey: true } : undefined,
        bubbles: true,
        composed: true,
      }),
    ),
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
  tpl.innerHTML = BRAND_MARK_SVG; // s4: static-template — decorative (aria-hidden in BRAND_MARK_SVG); text carries meaning
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
  // A10: at most one utterance in flight, tied to whatever is currently shown — every state
  // transition (loading, result, error) interrupts any speech left over from the prior word.
  globalThis.speechSynthesis?.cancel();
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
    if (state.error.code === 'INVALID_KEY')
      return [h, p, settingsCta('Fix key in Settings', { fixKey: true })];
    return [h, p];
  }
  if (state.kind === 'streaming') {
    const h = document.createElement('h2');
    h.textContent = state.word;
    const body = document.createElement('div');
    body.innerHTML = state.safeHtml; // trusted: sanitized upstream (S4)
    const nodes: Node[] = [h];
    // A8: label only, no "Show literal word" button — a re-run mid-stream would start a second,
    // overlapping fetch (design spec §4.8).
    const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs, false) : null;
    if (definedAsRow) nodes.push(definedAsRow);
    nodes.push(body);
    return nodes;
  }
  const h = document.createElement('h2');
  h.textContent = state.word;
  const body = document.createElement('div');
  // A2: marks the definition body so DomSelectionSource can tell a selection inside it apart
  // from an ordinary page selection (see dom-selection-source.ts's defaultReader).
  body.className = 'lookup-answer';
  body.innerHTML = state.safeHtml; // trusted: sanitized upstream by adapters-shared (S4)
  // A7: a pinned card is a read-only reference copy — every word-level / one-shot control
  // (save/status/nudge, "Show literal word", the refine chips, the recursive-lookup Back
  // button, and the speak button) acts through the renderer's SINGLETON "current lookup"
  // state, which no longer describes this card once it is pinned and detached (design spec
  // §2.2). They are omitted entirely rather than left inert; a pinned card shows the headword,
  // body, and static provider badge only.
  const interactive = state.pinned !== true;
  const nodes: Node[] = [];
  if (interactive && state.canGoBack === true) nodes.push(renderBackRow());
  nodes.push(h);
  if (interactive) {
    const speakBtn = renderSpeakButton(state.word);
    if (speakBtn) nodes.push(speakBtn);
    nodes.push(renderSaveRow(state));
    if (state.nudge === true) nodes.push(renderNudgeRow(state));
  }
  const definedAsRow = interactive && state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
  if (definedAsRow) nodes.push(definedAsRow);
  nodes.push(body);
  if (interactive && state.refineChips === true) nodes.push(renderRefineRow(state));
  const meta = renderMetaRow(state);
  if (meta) nodes.push(meta);
  const pinRow = renderPinRow(state);
  if (pinRow) nodes.unshift(pinRow);
  return nodes;
}

/**
 * A2: the Back button — rendered only when `state.canGoBack` is true (a recursive lookup has a
 * parent frame to return to). Dispatches a composed, payload-free `lookup-back` event (mirrors
 * `close`'s parameterless composed-event pattern); the workflow's own `onBack` closure (installed
 * via `ResultRenderContext`, see `domain/workflow.ts`) does the actual pop + re-render — this
 * function is pure UI, no stack awareness.
 */
function renderBackRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'back-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-btn';
  btn.setAttribute('aria-label', 'Back to previous definition');
  btn.innerHTML = `${ICON_BACK}<span>Back</span>`; // s4: static-template — decorative aria-hidden SVG + literal "Back" copy; accessible name via aria-label
  btn.addEventListener('click', () =>
    btn.dispatchEvent(new CustomEvent('lookup-back', { bubbles: true, composed: true })),
  );
  row.append(btn);
  return row;
}

/**
 * A8: the idiom label + "Show literal word" override button, shown only when the model
 * reported the selection as part of an idiom/phrasal verb. A literal result needs no extra
 * label (the headword already says the word), so this returns null for `isIdiom: false` —
 * avoiding noise for the overwhelmingly common non-idiom case.
 */
function renderDefinedAsRow(
  definedAs: { term: string; isIdiom: boolean },
  interactive = true,
): HTMLElement | null {
  if (!definedAs.isIdiom) return null;
  const row = document.createElement('div');
  row.className = 'defined-as';
  const label = document.createElement('span');
  label.className = 'defined-as__label';
  label.textContent = `Defined as "${definedAs.term}" (idiom)`;
  row.append(label);
  if (interactive) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'defined-as__literal-btn';
    btn.textContent = 'Show literal word';
    btn.addEventListener('click', () =>
      btn.dispatchEvent(new CustomEvent('force-literal', { bubbles: true, composed: true })),
    );
    row.append(btn);
  }
  return row;
}

/**
 * A3: the fixed 4-chip refine row plus, when a refinement is currently showing, a "Back to
 * original" pill. The active chip (state.refine) is aria-pressed + disabled — no wasted
 * duplicate network call for the same refinement already shown (mirrors renderMetaRow's
 * disable-the-current-provider pattern below).
 */
function renderRefineRow(state: { refine?: RefineKind }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'refine-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Refine this definition');
  if (state.refine !== undefined) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'refine-back-btn';
    backBtn.textContent = 'Back to original';
    backBtn.setAttribute('aria-label', 'Restore the original definition');
    backBtn.addEventListener('click', () =>
      backBtn.dispatchEvent(new CustomEvent('refine-back', { bubbles: true, composed: true })),
    );
    row.append(backBtn);
  }
  for (const chip of REFINE_CHIPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'refine-chip';
    btn.textContent = chip.label;
    const isActive = state.refine === chip.id;
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () =>
        btn.dispatchEvent(
          new CustomEvent('refine', {
            detail: { refine: chip.id },
            bubbles: true,
            composed: true,
          }),
        ),
      );
    }
    row.append(btn);
  }
  return row;
}

/**
 * A10: pick the voice to speak `word` with. Filters to `localService === true` first — the
 * mechanism that holds the roadmap's "100% local" / "No cloud TTS" fence (design spec §2.2):
 * some browsers' bundled voices synthesize speech by calling out to a remote server, and a
 * voice like that must never be silently chosen just because its language tag matches. Prefers
 * an exact 'en-US' match, falling back to any other local English-tagged voice. Returns
 * undefined if no local English voice exists at all — callers treat that identically to "no
 * voices installed."
 */
function pickLocalEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  return local.find((v) => v.lang === 'en-US') ?? local[0];
}

/**
 * A10: the pronunciation control — a top-level light-DOM SIBLING of the headword `<h2>` (not a
 * wrapper — mirrors renderSaveRow's own documented reason just above: ::slotted() only matches
 * TOP-LEVEL assigned nodes, so wrapping h2 would silently drop its underline-swatch styling,
 * `::slotted(h2)` at the top of this file's CSS). The caller (renderCardState) places this node
 * immediately after `<h2>` so it flows onto the same visual line (both are inline-level slotted
 * nodes) — as close to "next to the pronunciation info" as the card's DOM model supports; see
 * the design spec §2.1 for why parsing into the sanitized markdown body was rejected instead.
 *
 * Returns null (button omitted, not disabled) when SpeechSynthesis doesn't exist at all — a
 * control that can never work has no reason to occupy space. When it exists, the button renders
 * `hidden` until at least one local English voice is confirmed installed (checked synchronously,
 * then once more on a one-shot `voiceschanged` — browsers commonly return an empty voice list on
 * the very first call and populate it asynchronously). The same voice check runs AGAIN at click
 * time, since the list can change between render and click.
 */
function renderSpeakButton(word: string): HTMLButtonElement | null {
  const synth = globalThis.speechSynthesis;
  if (!synth) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'speak-btn';
  btn.hidden = true;
  btn.setAttribute('aria-label', `Say "${word}" aloud`);
  btn.innerHTML = ICON_SPEAKER; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
  const reveal = (): void => {
    if (pickLocalEnglishVoice(synth.getVoices()) !== undefined) btn.hidden = false;
  };
  reveal();
  if (btn.hidden) synth.addEventListener('voiceschanged', reveal, { once: true });
  btn.addEventListener('click', () => {
    const voice = pickLocalEnglishVoice(synth.getVoices());
    if (!voice) return; // degraded further between render and click — do nothing, never guess
    synth.cancel(); // at most one utterance in flight — a rapid re-click restarts, never queues
    const utter = new SpeechSynthesisUtterance(word); // word only (A10 fence) — never the body
    utter.voice = voice;
    utter.lang = voice.lang;
    synth.speak(utter);
  });
  return btn;
}

/**
 * A7: the pin control — keeps this card open as an independent, draggable floating copy that
 * survives Esc, scrolling, and clicking elsewhere on the page (up to 3 at once). Returns null
 * when `state.canPin` is undefined: this rendering surface does not support pinning at all
 * (e.g. the side panel — already persistent, see side-panel-view.ts, unchanged by this card).
 * Dispatches a composed `pin` event; the in-page renderer (not a platform shell) performs the
 * actual detach (inline-bottom-sheet-renderer.ts's pinCurrent) — this function is pure UI, the
 * same separation every other card action already has.
 */
function renderPinRow(state: { canPin?: boolean; pinned?: boolean }): HTMLElement | null {
  if (state.canPin === undefined) return null;
  const row = document.createElement('div');
  row.className = 'pin-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pin-btn';
  const isPinned = state.pinned === true;
  if (isPinned) {
    btn.disabled = true;
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', 'Pinned — use Close to remove it');
  } else {
    const atCap = state.canPin === false;
    btn.disabled = atCap;
    btn.setAttribute('aria-pressed', 'false');
    const label = atCap
      ? 'Unpin another card to pin this one (max 3)'
      : 'Pin this card so it stays open';
    btn.setAttribute('aria-label', label);
    if (atCap) btn.title = label; // native tooltip, mirrors the side-panel action's own `title`
    btn.addEventListener('click', () =>
      btn.dispatchEvent(new CustomEvent('pin', { bubbles: true, composed: true })),
    );
  }
  btn.innerHTML = ICON_PIN; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
  const lbl = document.createElement('span');
  lbl.className = 'pin-lbl';
  lbl.textContent = isPinned ? 'Pinned' : 'Pin';
  btn.append(lbl);
  row.append(btn);
  return row;
}

/**
 * B1: the star affordance for saving a word. Always rendered for a 'result' state (a top-level
 * slotted SIBLING of the headword — NOT a wrapper around it, so the existing ::slotted(h2) rule
 * stays untouched). Dispatches a composed `toggle-save` event carrying only the word; the
 * composition root already holds the full save payload (word/definition/sentence/url/title) in
 * closure from `ResultRenderContext` (see ports.ts) and performs the actual persistence — this
 * function is pure UI, no chrome.* awareness, same separation every other card action already has.
 */
function renderSaveRow(state: {
  word: string;
  saved?: boolean;
  status?: SavedWordStatus;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'save-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'save-btn';
  const isSaved = state.saved === true;
  btn.setAttribute('aria-pressed', String(isSaved));
  btn.setAttribute(
    'aria-label',
    isSaved ? `Remove ${state.word} from saved words` : `Save ${state.word} to your word list`,
  );
  btn.innerHTML = ICON_STAR; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
  const lbl = document.createElement('span');
  lbl.className = 'save-lbl';
  lbl.textContent = isSaved ? 'Saved' : 'Save';
  btn.append(lbl);
  btn.addEventListener('click', () =>
    btn.dispatchEvent(
      new CustomEvent('toggle-save', {
        detail: { word: state.word },
        bubbles: true,
        composed: true,
      }),
    ),
  );
  row.append(btn);
  if (isSaved && state.status !== undefined) {
    row.append(renderStatusBtn(state.word, state.status));
  }
  return row;
}

/**
 * B5: the manual learning/known status toggle — rendered only once a word is saved AND its
 * current status is known (see renderSaveRow's guard). Exactly 2 states, manual only (roadmap B5
 * scope fence): clicking dispatches a composed `toggle-status` event carrying only the word (the
 * composition root computes the flip direction from its own tracked last-known status, mirroring
 * `toggle-save`'s own design) — this function is pure UI, no persistence.
 */
function renderStatusBtn(word: string, status: SavedWordStatus): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'status-btn';
  const isKnown = status === 'known';
  btn.setAttribute('aria-pressed', String(isKnown));
  btn.setAttribute('aria-label', isKnown ? `Mark ${word} as learning` : `Mark ${word} as known`);
  btn.textContent = isKnown ? 'Known' : 'Learning';
  btn.addEventListener('click', () =>
    btn.dispatchEvent(
      new CustomEvent('toggle-status', { detail: { word }, bubbles: true, composed: true }),
    ),
  );
  return btn;
}

/**
 * B7: the repeat-offender nudge banner — shown once per word, ever, when `state.nudge === true`
 * (stamped by the router the moment a word's within-30-day lookup count first crosses the
 * threshold; see domain/nudge-policy.ts). "Save" dispatches the exact same `toggle-save` event
 * the star button dispatches — not a second save path. "Dismiss" is a pure client-side action:
 * the backend has already permanently marked this word as nudged before this reply was ever
 * sent, so there is nothing left for a dismiss round-trip to tell it.
 */
function renderNudgeRow(state: { word: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'nudge-row';
  row.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'nudge-row__text';
  text.textContent = '3rd time meeting this word — save it?';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'nudge-row__save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () =>
    saveBtn.dispatchEvent(
      new CustomEvent('toggle-save', {
        detail: { word: state.word },
        bubbles: true,
        composed: true,
      }),
    ),
  );
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'nudge-row__dismiss-btn';
  dismissBtn.setAttribute('aria-label', 'Dismiss nudge');
  dismissBtn.innerHTML = ICON_CLOSE; // s4: static-template — decorative aria-hidden SVG; name comes from aria-label
  dismissBtn.addEventListener('click', () =>
    dismissBtn.dispatchEvent(new CustomEvent('dismiss-nudge', { bubbles: true, composed: true })),
  );
  row.append(text, saveBtn, dismissBtn);
  return row;
}

/**
 * The metadata row shown beneath a result: a leading Cached badge on a cache hit
 * (A9), a provider badge naming the answering provider, an optional fallback note
 * when a non-primary answered, and a one-shot provider picker when ≥2 providers
 * are configured. Returns null only when there is nothing to show at all — no
 * provider known (e.g. entries cached before this feature) AND not a cache hit.
 *
 * Descendants of this row are styled by the document-scoped rules in
 * `CARD_DOC_CSS` (::slotted cannot reach a slotted node's own descendants).
 */
function renderMetaRow(state: {
  provider?: Provider;
  fallbackFrom?: Provider;
  providers?: Provider[];
  fromCache?: boolean;
}): HTMLElement | null {
  if (!state.provider && state.fromCache !== true) return null;
  const row = document.createElement('div');
  row.className = 'meta-row';

  // A9: leads the row — the card's own payoff is "you can see it was free", so this is the
  // first thing the eye should land on for a repeat lookup, ahead of which provider answered.
  if (state.fromCache === true) {
    const cacheBadge = document.createElement('span');
    cacheBadge.className = 'cache-badge';
    cacheBadge.textContent = 'Cached';
    cacheBadge.title = 'Served from your local cache — no tokens used';
    row.append(cacheBadge);
  }

  if (state.provider) {
    const badge = document.createElement('span');
    badge.className = 'prov-badge';
    badge.textContent = providerLabel(state.provider);
    row.append(badge);

    if (state.fallbackFrom) {
      const note = document.createElement('span');
      note.className = 'fallback-note';
      note.textContent = `${providerLabel(state.fallbackFrom)} unavailable — answered by ${providerLabel(state.provider)}`;
      row.append(note);
    }

    if (state.providers && state.providers.length >= 2) {
      const current = state.provider;
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'prov-switch';
      switchBtn.setAttribute('aria-haspopup', 'listbox');
      switchBtn.setAttribute('aria-expanded', 'false');
      switchBtn.textContent = 'Switch';

      const menu = document.createElement('span');
      menu.className = 'prov-menu';
      menu.setAttribute('role', 'listbox');
      menu.hidden = true;

      for (const p of state.providers) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.setAttribute('role', 'option');
        opt.dataset['provider'] = p;
        opt.textContent = providerLabel(p);
        const isCurrent = p === current;
        opt.setAttribute('aria-selected', String(isCurrent));
        if (isCurrent) {
          opt.disabled = true;
        } else {
          opt.addEventListener('click', () => {
            menu.hidden = true;
            switchBtn.setAttribute('aria-expanded', 'false');
            // Ask the shell to re-run this lookup once against the picked provider.
            opt.dispatchEvent(
              new CustomEvent('switch-provider', {
                detail: { provider: p },
                bubbles: true,
                composed: true,
              }),
            );
          });
        }
        menu.append(opt);
      }

      switchBtn.addEventListener('click', () => {
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        switchBtn.setAttribute('aria-expanded', String(willOpen));
      });

      row.append(switchBtn, menu);
    }
  }

  return row;
}

export class LookupCard extends HTMLElement {
  private _state: CardState = { kind: 'loading' };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    ensureCardDocStyles(); // inject document @keyframes + meta-row rules for light-DOM content
    const root = this.attachShadow({ mode: 'open' });
    adoptStyles(root, CSS);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>AI Dictionary</span>`; // s4: static-template — fixed brand mark + literal label, no model content
    const actions = document.createElement('span');
    actions.className = 'actions';
    if (this.hasAttribute('side-panel')) {
      actions.append(this.actionButton('side-panel', 'Open in side panel', ICON_SIDE_PANEL));
    }
    actions.append(
      this.actionButton('mute-site', 'Mute this site', ICON_MUTE),
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
    footer.innerHTML = `${ICON_SHIELD}<span>Stays on your device</span>`; // s4: static-template — fixed shield icon + literal copy, no model content

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

  static get observedAttributes(): string[] {
    return ['data-streaming'];
  }

  /**
   * A1: while streaming, the light-DOM content inside the shadow region's aria-live="polite"
   * wrapper mutates far too often (throttled to ~80ms, inline-bottom-sheet-renderer.ts) for a
   * screen reader to usefully announce every change — flip the live region to aria-live="off" for
   * the duration and back to "polite" the instant a terminal state renders. data-streaming is a
   * shared-DOM ATTRIBUTE (crosses the MV3 MAIN/isolated-world boundary, unlike a JS property —
   * same fact data-ad-theme already relies on, see inline-bottom-sheet-renderer.ts's theme setter).
   */
  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (name !== 'data-streaming' || !this.shadowRoot) return;
    this.shadowRoot
      .querySelector('.region')
      ?.setAttribute('aria-live', next !== null ? 'off' : 'polite');
  }

  private actionButton(
    act: 'settings' | 'close' | 'side-panel' | 'mute-site',
    label: string,
    icon: string,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    // A native tooltip on the icon-only side-panel control (Settings carries a visible word; the
    // bare panel/close glyphs benefit from a hover title — and the handoff specifies title here).
    if (act === 'side-panel') b.title = label;
    b.innerHTML = icon; // s4: static-template — icon param comes from a fixed internal set; decorative aria-hidden SVG, accessible name comes from aria-label
    // Settings carries a visible "Settings" word so it reads as a control, not a twin of the
    // bare X. aria-label still wins as the accessible name, so this never double-announces.
    if (act === 'settings') {
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = label;
      b.append(lbl);
    }
    // Each action maps to the composed event name the shell already routes:
    //  settings → open-settings; close → close; side-panel → open-side-panel;
    //  mute-site → mute-site (A13).
    const event =
      act === 'settings'
        ? 'open-settings'
        : act === 'side-panel'
          ? 'open-side-panel'
          : act === 'mute-site'
            ? 'mute-site'
            : 'close';
    b.addEventListener('click', () => {
      // A13: optimistic, local-only feedback — quietSiteAdd (domain/quiet-site-policy.ts) is
      // idempotent, so the button never needs to know if this site is already muted; it just
      // disables itself so a double-click can't fire two wire messages.
      if (act === 'mute-site') {
        b.disabled = true;
        b.setAttribute('aria-label', 'Site muted — manage in Settings');
      }
      this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
    });
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
