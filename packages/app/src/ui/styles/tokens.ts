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
// Palette intent: a bright, "winter-morning" reading surface. The cozy candlelit warmth is
// kept, but lifted toward clean morning light: a cooler, near-white surface with less amber
// tint, lighter hairlines, and a brighter (but whiter) top wash, so the card reads like a
// cabin at 8am rather than 8pm. Honey-amber is still the signature; pine green + mulled-wine
// cranberry are the small festive accents. Shadows stay WARM-hued per the Warm Shadow Rule,
// only lightened. All colours are OKLCH and tuned for WCAG AA against their own surface
// (verified in-browser).

export const LIGHT_VARS = [
  '--ad-surface:oklch(0.992 0.005 95)',
  '--ad-surface-soft:oklch(0.968 0.012 90)',
  '--ad-ink:oklch(0.33 0.02 60)',
  '--ad-ink-soft:oklch(0.48 0.018 65)',
  '--ad-amber:oklch(0.64 0.14 70)',
  '--ad-cranberry:oklch(0.54 0.165 26)',
  '--ad-pine:oklch(0.48 0.09 154)',
  '--ad-line:oklch(0.93 0.008 90)',
  '--ad-err:oklch(0.5 0.17 25)',
  '--ad-glow:radial-gradient(130% 85% at 50% -14%, oklch(0.95 0.075 88 / 0.78), transparent 72%)',
  '--ad-shadow:0 1px 1px oklch(0.45 0.05 60 / 0.05),0 12px 26px -10px oklch(0.5 0.05 60 / 0.18),0 28px 56px -24px oklch(0.5 0.05 55 / 0.22)',
].join(';');

export const DARK_VARS = [
  '--ad-surface:oklch(0.285 0.02 55)',
  '--ad-surface-soft:oklch(0.33 0.024 52)',
  '--ad-ink:oklch(0.94 0.014 85)',
  '--ad-ink-soft:oklch(0.77 0.02 75)',
  '--ad-amber:oklch(0.84 0.13 75)',
  '--ad-cranberry:oklch(0.69 0.155 28)',
  '--ad-pine:oklch(0.7 0.09 154)',
  '--ad-line:oklch(0.39 0.022 55)',
  '--ad-err:oklch(0.72 0.15 25)',
  '--ad-glow:radial-gradient(130% 85% at 50% -14%, oklch(0.78 0.13 78 / 0.5), transparent 72%)',
  '--ad-shadow:0 1px 1px oklch(0 0 0 / 0.3),0 16px 32px -10px oklch(0 0 0 / 0.52),0 40px 70px -28px oklch(0 0 0 / 0.58)',
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
