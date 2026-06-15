// "Paperlight" design tokens for the in-page UI components.
//
// THREE LAYERS (see design-hand-off/IMPLEMENTATION_GUIDE.md §1):
//   1. PRIMITIVES  (--adp-*)  raw, theme-agnostic: type scale, spacing, radii, motion,
//                             z-index. NEVER themed.
//   2. SEMANTIC    (--ad-*)   meaning-based: surface, ink, accent, line, shadow…
//                             Re-bound per theme. Components read ONLY these (+ --adp-*).
//   3. THEMES                 [data-ad-theme="sepia"]    (default, reading-warm)
//                             [data-ad-theme="dark"]     (warm low-glare night)
//                             [data-ad-theme="contrast"] (accessibility, high-contrast)
//
// These are SELECTOR-LESS declaration strings so each component folds them into its own
// single adopted stylesheet (preserving adoptedStyleSheets.length === 1, pinned by a
// regression test). BASE_VARS goes on each component's :host rule (default = sepia);
// THEME_CSS re-binds the semantic layer when the host carries [data-ad-theme="dark"|
// "contrast"], or "system" on a dark OS — the reader's stored theme, stamped on the host
// by each composition root. Custom properties survive `all: initial` (the `all` shorthand
// does not reset `--*`), so the trigger can isolate its host and still read these.
//
// EYE-COMFORT LAWS encoded below: no pure white / no pure black, every neutral is
// warm-shifted, body contrast lands ~8–11:1 (comfortable, not the harsh 21:1 of #000-on-#fff),
// and the spruce accent is low-chroma — a quiet signal, never a glare source.

// ── 1. PRIMITIVES — never themed ──────────────────────────────────────────
export const ADP_PRIMITIVES = [
  // Type families
  '--adp-font-serif:Georgia,"Iowan Old Style","Times New Roman",serif',
  '--adp-font-sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  '--adp-font-mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace',
  // Type scale
  '--adp-text-headword:1.7rem',
  '--adp-text-lg:17px',
  '--adp-text-body:15px',
  '--adp-text-sm:13px',
  '--adp-text-xs:12px',
  '--adp-text-2xs:11px',
  '--adp-leading-tight:1.15',
  '--adp-leading-body:1.62',
  '--adp-tracking-head:-0.01em',
  '--adp-tracking-label:0.02em',
  '--adp-weight-reg:400',
  '--adp-weight-med:500',
  '--adp-weight-semi:600',
  '--adp-weight-bold:700',
  // Spacing (4px base)
  '--adp-space-2:2px',
  '--adp-space-4:4px',
  '--adp-space-6:6px',
  '--adp-space-8:8px',
  '--adp-space-12:12px',
  '--adp-space-16:16px',
  '--adp-space-20:20px',
  '--adp-space-24:24px',
  '--adp-space-32:32px',
  // Radii
  '--adp-radius-control:9px',
  '--adp-radius-card:18px',
  '--adp-radius-pill:999px',
  // Sizing
  '--adp-card-width:420px',
  '--adp-action-size:30px',
  '--adp-tap-min:44px',
  // Motion — gentle, no bounce
  '--adp-ease:cubic-bezier(0.22, 1, 0.36, 1)',
  '--adp-ease-inout:cubic-bezier(0.4, 0, 0.2, 1)',
  '--adp-dur-fast:140ms',
  '--adp-dur-base:240ms',
  '--adp-dur-slow:320ms',
  '--adp-dur-theme:360ms',
  // Stacking — must beat any host page
  '--adp-z-overlay:2147483647',
].join(';');

// ── 2. SEMANTIC — re-bound per theme. Components read ONLY these (+ --adp-*). ──

// SEPIA — default, reading-warm
export const SEPIA_VARS = [
  '--ad-surface:oklch(0.962 0.016 80)',
  '--ad-surface-raised:oklch(0.935 0.020 78)',
  '--ad-surface-sunken:oklch(0.978 0.011 82)',
  '--ad-ink:oklch(0.345 0.022 60)',
  '--ad-ink-soft:oklch(0.500 0.020 62)',
  '--ad-ink-faint:oklch(0.610 0.018 65)',
  '--ad-line:oklch(0.895 0.012 78)',
  '--ad-line-strong:oklch(0.855 0.014 76)',
  '--ad-accent:oklch(0.500 0.068 168)',
  '--ad-accent-ink:oklch(0.430 0.072 168)',
  '--ad-accent-soft:oklch(0.925 0.030 168)',
  '--ad-on-accent:oklch(0.985 0.008 80)',
  '--ad-warm:oklch(0.560 0.090 48)',
  '--ad-warm-ink:oklch(0.500 0.092 46)',
  '--ad-error:oklch(0.520 0.160 28)',
  '--ad-glow:radial-gradient(120% 72% at 50% -12%, oklch(0.91 0.038 78 / 0.36), transparent 70%)',
  '--ad-scrim:oklch(0.28 0.020 60 / 0.42)',
  '--ad-selection:oklch(0.80 0.06 168 / 0.45)',
  '--ad-shadow-card:0 1px 1px oklch(0.42 0.04 60 / 0.05),0 10px 24px -10px oklch(0.46 0.045 58 / 0.16),0 26px 52px -26px oklch(0.46 0.045 55 / 0.20)',
  '--ad-shadow-trigger:0 2px 5px oklch(0.40 0.045 50 / 0.14),0 10px 22px -10px oklch(0.40 0.05 45 / 0.34)',
].join(';');

// DARK — warm low-glare night
export const DARK_VARS = [
  '--ad-surface:oklch(0.255 0.013 70)',
  '--ad-surface-raised:oklch(0.305 0.015 68)',
  '--ad-surface-sunken:oklch(0.225 0.012 70)',
  '--ad-ink:oklch(0.905 0.014 84)',
  '--ad-ink-soft:oklch(0.740 0.016 80)',
  '--ad-ink-faint:oklch(0.605 0.016 76)',
  '--ad-line:oklch(0.360 0.016 68)',
  '--ad-line-strong:oklch(0.420 0.018 66)',
  '--ad-accent:oklch(0.785 0.070 168)',
  '--ad-accent-ink:oklch(0.810 0.072 168)',
  '--ad-accent-soft:oklch(0.385 0.040 168)',
  '--ad-on-accent:oklch(0.220 0.015 70)',
  '--ad-warm:oklch(0.760 0.085 50)',
  '--ad-warm-ink:oklch(0.785 0.085 52)',
  '--ad-error:oklch(0.720 0.140 28)',
  '--ad-glow:radial-gradient(120% 72% at 50% -12%, oklch(0.50 0.050 72 / 0.30), transparent 70%)',
  '--ad-scrim:oklch(0.10 0.010 60 / 0.58)',
  '--ad-selection:oklch(0.55 0.06 168 / 0.50)',
  '--ad-shadow-card:0 1px 1px oklch(0 0 0 / 0.20),0 9px 20px -14px oklch(0 0 0 / 0.34),0 22px 42px -32px oklch(0 0 0 / 0.38)',
  '--ad-shadow-trigger:0 2px 6px oklch(0 0 0 / 0.38),0 12px 24px -10px oklch(0 0 0 / 0.50)',
].join(';');

// HIGH CONTRAST — accessibility. Proof of the architecture: one extra block, no component
// code changes. Stronger contrast, a crisp 1px shadow ring, no decorative glow.
export const CONTRAST_VARS = [
  '--ad-surface:oklch(0.985 0.006 85)',
  '--ad-surface-raised:oklch(0.930 0.010 82)',
  '--ad-surface-sunken:oklch(0.970 0.008 85)',
  '--ad-ink:oklch(0.200 0.015 60)',
  '--ad-ink-soft:oklch(0.340 0.018 62)',
  '--ad-ink-faint:oklch(0.430 0.018 64)',
  '--ad-line:oklch(0.720 0.012 78)',
  '--ad-line-strong:oklch(0.560 0.014 76)',
  '--ad-accent:oklch(0.400 0.100 168)',
  '--ad-accent-ink:oklch(0.360 0.100 168)',
  '--ad-accent-soft:oklch(0.900 0.040 168)',
  '--ad-on-accent:oklch(0.990 0.005 85)',
  '--ad-warm:oklch(0.450 0.120 45)',
  '--ad-warm-ink:oklch(0.420 0.120 44)',
  '--ad-error:oklch(0.450 0.180 28)',
  '--ad-glow:linear-gradient(transparent, transparent)',
  '--ad-scrim:oklch(0.15 0.010 60 / 0.62)',
  '--ad-selection:oklch(0.78 0.080 168 / 0.50)',
  '--ad-shadow-card:0 0 0 1px oklch(0.560 0.014 76 / 0.9),0 6px 18px -8px oklch(0.30 0.02 60 / 0.22)',
  '--ad-shadow-trigger:0 0 0 1px oklch(0.560 0.014 76 / 0.9),0 4px 12px -6px oklch(0.30 0.02 60 / 0.24)',
].join(';');

// The base block every component folds into its :host rule: primitives + the default sepia
// semantic layer. No [data-ad-theme] attribute → sepia (warm reading paper).
export const BASE_VARS = `${ADP_PRIMITIVES};${SEPIA_VARS}`;

// The theme-override block every themed component appends to its single stylesheet.
// No attribute → sepia (BASE_VARS on :host). [data-ad-theme="sepia"] → also sepia (base).
// [data-ad-theme="dark"|"contrast"] → re-bind unconditionally. [data-ad-theme="system"] →
// dark only when the OS prefers it (sepia otherwise, from the base). `color-scheme` rides
// along so native widgets (scrollbars, selects) match the surface.
export const THEME_CSS = `:host([data-ad-theme="dark"]){${DARK_VARS};color-scheme:dark}
:host([data-ad-theme="contrast"]){${CONTRAST_VARS};color-scheme:light}
@media (prefers-color-scheme:dark){:host([data-ad-theme="system"]){${DARK_VARS};color-scheme:dark}}`;

// The Paperlight brand mark — the headword RULE plus a diacritic ACCENT DOT, built from the
// system's own vocabulary so it reads as "a defined word" in any theme. The dot is a quiet
// nod to the diacritics of the reader's language. CSP-safe presentation-attribute fills bound
// to the token palette (NOT a hand-drawn / feTurbulence sketch). aria-hidden: it is
// decorative; every place it is used carries its own accessible text label. Sized via the
// `.mark` class per context (18px in the trigger, 21px in the card brand).
export const BRAND_MARK_SVG =
  '<svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
  '<circle cx="6.5" cy="6.5" r="2.4" fill="var(--ad-warm)"/>' +
  '<rect x="3" y="14.5" width="18" height="3.2" rx="1.6" fill="var(--ad-accent)"/>' +
  '</svg>';
