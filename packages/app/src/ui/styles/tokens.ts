// Shared "cozy Christmas" design tokens for the in-page UI components.
//
// These are SELECTOR-LESS declaration strings so each component can fold them into its
// own single adopted stylesheet (preserving adoptedStyleSheets.length === 1, which a
// regression test pins). They are applied on each component's :host rule for light, and
// re-applied inside a nested `@media (prefers-color-scheme: dark)` block for dark — the
// card and trigger therefore adapt to the host page / OS theme. Custom properties survive
// `all: initial` (the `all` shorthand does not reset `--*`), so the trigger can isolate
// its host and still read these.
//
// Palette intent: a warm, candlelit reading surface. Honey-amber is the signature; pine
// green + mulled-wine cranberry are the small festive accents. All colours are OKLCH and
// tuned for WCAG AA against their own surface (verified in-browser).

export const LIGHT_VARS = [
  '--ad-surface:oklch(0.985 0.009 80)',
  '--ad-surface-soft:oklch(0.962 0.017 72)',
  '--ad-ink:oklch(0.31 0.025 50)',
  '--ad-ink-soft:oklch(0.45 0.022 55)',
  '--ad-amber:oklch(0.61 0.13 64)',
  '--ad-cranberry:oklch(0.52 0.16 25)',
  '--ad-pine:oklch(0.46 0.075 155)',
  '--ad-line:oklch(0.9 0.014 74)',
  '--ad-err:oklch(0.5 0.17 25)',
  '--ad-glow:radial-gradient(125% 80% at 50% -14%, oklch(0.85 0.12 78 / 0.72), transparent 72%)',
  '--ad-shadow:0 1px 1px oklch(0.4 0.05 50 / 0.05),0 12px 26px -8px oklch(0.42 0.06 45 / 0.26),0 30px 60px -24px oklch(0.4 0.06 45 / 0.3)',
].join(';');

export const DARK_VARS = [
  '--ad-surface:oklch(0.265 0.022 52)',
  '--ad-surface-soft:oklch(0.31 0.026 50)',
  '--ad-ink:oklch(0.93 0.016 82)',
  '--ad-ink-soft:oklch(0.75 0.022 72)',
  '--ad-amber:oklch(0.82 0.13 72)',
  '--ad-cranberry:oklch(0.67 0.155 28)',
  '--ad-pine:oklch(0.67 0.085 155)',
  '--ad-line:oklch(0.37 0.022 55)',
  '--ad-err:oklch(0.72 0.15 25)',
  '--ad-glow:radial-gradient(125% 80% at 50% -14%, oklch(0.72 0.14 72 / 0.46), transparent 72%)',
  '--ad-shadow:0 1px 1px oklch(0 0 0 / 0.3),0 16px 32px -10px oklch(0 0 0 / 0.55),0 40px 70px -28px oklch(0 0 0 / 0.6)',
].join(';');

// A clean, geometric holly sprig (two pine leaves + a cranberry berry cluster). CSP-safe
// markup with presentation-attribute fills bound to the token palette — deliberately NOT
// a hand-drawn / feTurbulence sketch. aria-hidden: it is decorative; every place it is
// used carries its own accessible label.
export const HOLLY_SVG =
  '<svg class="holly" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<g fill="var(--ad-pine)">' +
  '<ellipse cx="8.2" cy="9.2" rx="5.1" ry="2.4" transform="rotate(-34 8.2 9.2)"/>' +
  '<ellipse cx="15.8" cy="9.2" rx="5.1" ry="2.4" transform="rotate(34 15.8 9.2)"/>' +
  '<ellipse cx="12" cy="6.4" rx="4.6" ry="2.2" transform="rotate(90 12 6.4)"/>' +
  '</g>' +
  '<g fill="var(--ad-cranberry)">' +
  '<circle cx="10.7" cy="13.4" r="1.7"/>' +
  '<circle cx="13.5" cy="13.9" r="1.7"/>' +
  '<circle cx="12.1" cy="15.6" r="1.7"/>' +
  '</g></svg>';
