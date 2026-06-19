---
name: AI Dictionary
description: Paperlight — a calm sheet of paper-light in the margin of whatever you're reading, tuned for tired eyes on long reads. One quiet signature color, three swappable themes.
colors:
  surface: 'oklch(0.962 0.016 80)'
  surface-raised: 'oklch(0.935 0.020 78)'
  surface-sunken: 'oklch(0.978 0.011 82)'
  ink: 'oklch(0.345 0.022 60)'
  ink-soft: 'oklch(0.500 0.020 62)'
  ink-faint: 'oklch(0.610 0.018 65)'
  line: 'oklch(0.895 0.012 78)'
  line-strong: 'oklch(0.855 0.014 76)'
  accent: 'oklch(0.500 0.068 168)'
  accent-ink: 'oklch(0.430 0.072 168)'
  accent-soft: 'oklch(0.925 0.030 168)'
  on-accent: 'oklch(0.985 0.008 80)'
  warm: 'oklch(0.560 0.090 48)'
  warm-ink: 'oklch(0.500 0.092 46)'
  error: 'oklch(0.520 0.160 28)'
typography:
  headword:
    fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif'
    fontSize: '1.7rem'
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  sub-headword:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '17px'
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 'normal'
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: 'normal'
  brand-label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '12px'
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: '0.02em'
  trigger-label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '13px'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 'normal'
  footer-label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '11px'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  ipa:
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 'normal'
rounded:
  control: '9px'
  card: '18px'
  pill: '999px'
spacing:
  space-2: '2px'
  space-4: '4px'
  space-6: '6px'
  space-8: '8px'
  space-12: '12px'
  space-16: '16px'
  space-20: '20px'
  space-24: '24px'
  space-32: '32px'
sizing:
  card-width: '420px'
  panel-width: '360px'
  action-size: '30px'
  tap-min: '44px'
motion:
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)'
  dur-fast: '140ms'
  dur-base: '240ms'
  dur-slow: '320ms'
  dur-theme: '360ms'
components:
  trigger-pill:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    border: '1px solid {colors.line-strong}'
    rounded: '{rounded.pill}'
    padding: '7px 13px 7px 10px'
    typography: '{typography.trigger-label}'
  trigger-pill-hover:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
  lookup-card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.card}'
    width: '{sizing.card-width}'
    gutter: '22px'
  card-accent-strip:
    height: '3px'
    background: 'linear-gradient(90deg, {colors.accent}, {colors.warm} 92%)'
  card-brand:
    textColor: '{colors.accent-ink}'
    typography: '{typography.brand-label}'
  card-headword:
    textColor: '{colors.ink}'
    typography: '{typography.headword}'
    underline: '44px x 3px linear-gradient(90deg, {colors.accent}, {colors.warm})'
  card-action:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-faint}'
    rounded: '{rounded.control}'
    size: '{sizing.action-size}'
  card-action-hover:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
  card-footer:
    textColor: '{colors.ink-faint}'
    typography: '{typography.footer-label}'
  side-panel:
    backgroundColor: '{colors.surface}'
    width: '{sizing.panel-width}'
    gutter: '18px'
    framing: 'none (no radius, no shadow, no close button)'
  primary-button:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.control}'
  focus-ring:
    outline: '2px solid {colors.accent}'
    offset: '2px'
---

# Design System: AI Dictionary

> **Source of truth:** this file lives in `design-system/` — the single source of truth for the
> frontend design system (see `design-system/README.md` for the folder map). The build-ready spec is
> `design-system/IMPLEMENTATION_GUIDE.md` ("Paperlight"); the living visual reference is
> `design-system/AI Dictionary Design System.html`; the portable token export is
> `design-system/tokens.css`. The shipped implementation lives in
> `packages/app/src/ui/styles/tokens.ts` (primitives, per-theme semantic blocks, canonical icon set).
> This document mirrors them; when they disagree, the guide and `tokens.ts` win.

## 1. Overview

**Creative North Star: "Paperlight"**

AI Dictionary is a calm sheet of paper-light cast in the margin of whatever you happen to be reading. A
reader hits an unfamiliar English word mid-sentence; one selection brings up a small, self-owned card
that explains the word **in this sentence, in the reader's language**, then gets out of the way.

The whole system is tuned for one thing: **tired eyes on long reads.** That single goal drives every
value. No pure white and no pure black anywhere; every neutral is warm-shifted. Body text targets a
**comfortable ~8–11:1**, never the harsh 21:1 of black-on-white. Color is quiet — one low-chroma
spruce-teal signature that _signals_ (focus, brand, links, spinner) and never glares or fills a surface.

The card overlays arbitrary, unpredictable pages, so it is built as a fully opaque, fully self-contained
shadow-DOM surface that carries its own tokens and never leans on the host background. Every color is
OKLCH and tuned for WCAG AA against its _own_ surface, verified in-browser, because legibility has to
hold whether the page behind it is a white news site or a black code editor.

> **This retires the previous "Candlelit Margin" cozy-Christmas identity** — the holly mark, the
> pine/cranberry festive trim, the honey-amber glow, the rainbow ribbon. The festive look may return
> later as an _optional_ theme, but it is no longer the brand.

This system explicitly rejects the experiences that make looking a word up feel like work: the
ad-cluttered dictionary site with its pop-overs and "related searches"; the heavy SaaS dashboard with
persistent chrome and card grids; the data-harvesting AI app that feels like it phones home; and the
playful AI gimmick that substitutes mascots, emoji, and "✨AI✨" sparkle-glow for actual personality.
Distinct through craft, never through noise.

**Key Characteristics:**

- **Eye-comfort first.** No pure white, no pure black; comfortable not maximal contrast; quiet color.
  The aesthetic is designed for long, fatigue-free reading.
- **Theme-able to the core.** Components read _only_ semantic `--ad-*` tokens (plus raw `--adp-*`
  primitives). Three themes ship — **Sepia** (default, reading-warm), **Dark** (warm low-glare night),
  **High Contrast** (accessibility) — plus a **system** option. Adding a theme is one token block; no
  component changes.
- **Theme is a choice, not the page's.** The theme is picked in Settings and persisted per device; it
  is no longer auto-driven by the host page's `prefers-color-scheme` (except via the explicit "system"
  option).
- **Opaque and self-contained.** Own shadow root, own tokens, full opacity. The card never borrows the
  page's background or fights its content.
- **Bilingual clarity first.** The English headword and its translation are each unmistakable and
  scannable; meaning is never carried by color alone.
- **Privacy you can feel.** A shield-marked "Stays on your device" line is part of the surface itself,
  not buried fine print.

## 2. Theme architecture

Three token layers, and one law that makes re-theming free.

```
PRIMITIVES   --adp-*   raw, theme-agnostic: type scale, spacing, radii, motion. NEVER themed.
SEMANTIC     --ad-*    meaning-based: surface, ink, accent, line, shadow… Re-bound per theme.
                       Components read ONLY these.
THEMES                 [data-ad-theme="sepia"]    (default, reading-warm)
                       [data-ad-theme="dark"]     (warm low-glare night)
                       [data-ad-theme="contrast"] (accessibility, high-contrast)
```

**The law.** A component (`.ad-card`, `.ad-trigger`, …) may reference `--ad-*` and `--adp-*` tokens and
nothing else. It must never name a theme, never hard-code a hex/oklch value, and never branch on
`prefers-color-scheme`. Re-theming then touches zero component code. Adding a theme = appending one
`[data-ad-theme="…"]` block of semantic tokens and one entry in the Settings picker.

**Switching & persistence.** Theme is set in Settings (§5 Settings form) under `chrome.storage.local`
key `ad:theme` with values `sepia | dark | contrast | system`. The mechanism is a single attribute:
`data-ad-theme` on the theme root — the **shadow-root host** (`:host`) for the over-page card and side
panel, or `document.documentElement` for the options page. `system` follows the OS via `matchMedia` and
live-updates. A `ad:theme-changed` broadcast re-themes any open card/panel live, cross-fading over
`--adp-dur-theme` (360ms), and honoring `prefers-reduced-motion`.

**Shadow-DOM isolation.** The over-page card and trigger inject `:host { all: initial }` (custom
properties survive it) plus `z-index: 2147483647` so no page ancestor can occlude them. The token blocks
are scoped to **both** `:root` (options page) and `:host` (shadow roots) so the custom properties survive
`all: initial`.

## 3. Colors

All values are **OKLCH**, tuned for WCAG AA against the surface's _own_ background, verified in-browser
per theme. Sepia is the default and the canonical set; Dark and High Contrast re-bind the same semantic
names.

### 3.1 Sepia (default, reading-warm)

| Token            | Value                                                                                 | Role                                                          |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `surface`        | `oklch(0.962 0.016 80)`                                                               | Warm paper. Card / panel background.                          |
| `surface-raised` | `oklch(0.935 0.020 78)`                                                               | Hover fill, chips.                                            |
| `surface-sunken` | `oklch(0.978 0.011 82)`                                                               | Input wells, recent-row hover.                                |
| `ink`            | `oklch(0.345 0.022 60)`                                                               | Body & headword. ~9.5:1 — clear, not harsh.                   |
| `ink-soft`       | `oklch(0.500 0.020 62)`                                                               | Secondary text. ~5:1.                                         |
| `ink-faint`      | `oklch(0.610 0.018 65)`                                                               | Captions, rest-state icons. ~3.3:1 (UI).                      |
| `line`           | `oklch(0.895 0.012 78)`                                                               | Hairline dividers.                                            |
| `line-strong`    | `oklch(0.855 0.014 76)`                                                               | Input / trigger borders.                                      |
| `accent`         | `oklch(0.500 0.068 168)`                                                              | **Signature spruce-teal.** Focus ring, spinner, brand, links. |
| `accent-ink`     | `oklch(0.430 0.072 168)`                                                              | Accent used as _text_ on paper. ~5.5:1.                       |
| `accent-soft`    | `oklch(0.925 0.030 168)`                                                              | Accent tint: focus halo, selection, info note.                |
| `on-accent`      | `oklch(0.985 0.008 80)`                                                               | Text/icon on an accent fill (primary button).                 |
| `warm`           | `oklch(0.560 0.090 48)`                                                               | Clay. Trim only (underline 2nd half, accent-strip end).       |
| `warm-ink`       | `oklch(0.500 0.092 46)`                                                               | Clay as text, if ever needed.                                 |
| `error`          | `oklch(0.520 0.160 28)`                                                               | Failure only. The one high-chroma value.                      |
| `glow`           | `radial-gradient(120% 72% at 50% -12%, oklch(0.91 0.038 78 / 0.36), transparent 70%)` | Faint warm wash at the surface's top edge.                    |
| `scrim`          | `oklch(0.28 0.020 60 / 0.42)`                                                         | Warm dim behind the bottom sheet.                             |
| `selection`      | `oklch(0.80 0.06 168 / 0.45)`                                                         | Text selection inside the card.                               |

### 3.2 Dark (warm low-glare night)

Warm charcoal, **never** blue-black; off-white ink, **never** `#fff`. Same semantic names, re-bound.

| Token            | Value                                                                                 | Role                                |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| `surface`        | `oklch(0.255 0.013 70)`                                                               | Warm charcoal.                      |
| `surface-raised` | `oklch(0.305 0.015 68)`                                                               | Hover fill.                         |
| `surface-sunken` | `oklch(0.225 0.012 70)`                                                               | Wells.                              |
| `ink`            | `oklch(0.905 0.014 84)`                                                               | Warm off-white. ~11:1.              |
| `ink-soft`       | `oklch(0.740 0.016 80)`                                                               | Secondary. ~5.5:1.                  |
| `ink-faint`      | `oklch(0.605 0.016 76)`                                                               | Captions/icons. ~3.2:1 (UI).        |
| `line`           | `oklch(0.360 0.016 68)`                                                               | Hairlines.                          |
| `line-strong`    | `oklch(0.420 0.018 66)`                                                               | Input borders.                      |
| `accent`         | `oklch(0.785 0.070 168)`                                                              | Lifted spruce, AA on charcoal.      |
| `accent-ink`     | `oklch(0.810 0.072 168)`                                                              | Accent text.                        |
| `accent-soft`    | `oklch(0.385 0.040 168)`                                                              | Tint / halo.                        |
| `on-accent`      | `oklch(0.220 0.015 70)`                                                               | Dark ink on the lifted accent fill. |
| `warm`           | `oklch(0.760 0.085 50)`                                                               | Clay, lifted.                       |
| `error`          | `oklch(0.720 0.140 28)`                                                               | Failure only.                       |
| `glow`           | `radial-gradient(120% 72% at 50% -12%, oklch(0.50 0.050 72 / 0.30), transparent 70%)` | Glow pulled almost to nothing.      |
| `scrim`          | `oklch(0.10 0.010 60 / 0.58)`                                                         | —                                   |
| `selection`      | `oklch(0.55 0.06 168 / 0.50)`                                                         | —                                   |

### 3.3 High Contrast (accessibility)

The proof that "add a theme = one block." Stronger contrast, crisp defining edges (a 1px shadow ring
stands in for the soft shadow), and **no decorative glow**.

| Token            | Value                                                                               | Role                                |
| ---------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `surface`        | `oklch(0.985 0.006 85)`                                                             | Near-white, faintly warm.           |
| `surface-raised` | `oklch(0.930 0.010 82)`                                                             | Hover fill.                         |
| `surface-sunken` | `oklch(0.970 0.008 85)`                                                             | Wells.                              |
| `ink`            | `oklch(0.200 0.015 60)`                                                             | ~16:1 — maximum legibility.         |
| `ink-soft`       | `oklch(0.340 0.018 62)`                                                             | ~9:1.                               |
| `ink-faint`      | `oklch(0.430 0.018 64)`                                                             | ~6:1 — "faint" stays strong.        |
| `line`           | `oklch(0.720 0.012 78)`                                                             | Visible, not hairline.              |
| `line-strong`    | `oklch(0.560 0.014 76)`                                                             | —                                   |
| `accent`         | `oklch(0.400 0.100 168)`                                                            | Deeper spruce, AAA on white.        |
| `accent-ink`     | `oklch(0.360 0.100 168)`                                                            | —                                   |
| `accent-soft`    | `oklch(0.900 0.040 168)`                                                            | —                                   |
| `on-accent`      | `oklch(0.990 0.005 85)`                                                             | —                                   |
| `warm`           | `oklch(0.450 0.120 45)`                                                             | —                                   |
| `error`          | `oklch(0.450 0.180 28)`                                                             | —                                   |
| `glow`           | `linear-gradient(transparent, transparent)`                                         | No decorative glow.                 |
| `shadow-card`    | `0 0 0 1px oklch(0.560 0.014 76 / 0.9), 0 6px 18px -8px oklch(0.30 0.02 60 / 0.22)` | 1px ring = crisp edge + light lift. |

### Named color rules

- **Quiet-Accent Rule.** The spruce signature is the only color used for _meaning_ — focus ring,
  spinner, brand label, links. It never fills a surface or tints body text.
- **No-Color-Only Rule.** The English term vs. its translation is distinguished by order, label, and
  weight, never by hue. Primary users read in a second language; color is decoration, never the signal.
- **Comfort-Contrast Rule.** Body text aims for ~8–11:1, not maximal. Verify in-browser, per theme,
  against the card's _own_ surface.
- **Warm-Shadow Rule.** Shadows are tinted warm (45–60° hue), never neutral gray.

## 4. Typography

**Display Font:** Georgia (`"Iowan Old Style", "Times New Roman", serif`)
**Body Font:** system-ui (`-apple-system, "Segoe UI", Roboto, sans-serif`)
**Mono Font:** ui-monospace (`"SF Mono", "Cascadia Code", Menlo, monospace`) — IPA only.

| Role                        | Family          | Size     | Weight | Line / tracking          |
| --------------------------- | --------------- | -------- | ------ | ------------------------ |
| Headword                    | serif (Georgia) | `1.7rem` | 400    | `1.15` / `-0.01em`       |
| Sub-headword / panel header | sans            | `17px`   | 700    | `1.3`                    |
| Body (definition)           | sans            | `15px`   | 400    | `1.62`                   |
| Brand label                 | sans            | `12px`   | 700    | `0.02em`, `accent-ink`   |
| Trigger label / recent rows | sans            | `13px`   | 600    | —                        |
| Footer / caption            | sans            | `11px`   | 400    | `ink-soft` / `ink-faint` |
| IPA                         | mono            | `13px`   | 400    | —                        |

### Named rules

- **One Serif Rule.** Georgia appears exactly once per surface: the headword. A serif anywhere else
  breaks the editorial-vs-utility contrast.
- **Native Sans Rule.** Body is always the host `system-ui` stack, never a webfont — zero load cost,
  never blocks the lookup, feels native to the reader's machine.
- **Generous leading.** Body line-height is `1.62` for long-read comfort.
- The card caps at `420px` wide, keeping prose comfortably under the 65–75ch line-length ceiling.

## 5. Space, shape, elevation & motion

**Spacing** — 4px base: `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32` (`--adp-space-*`).

**Radii** — `control 9px` · `card 18px` · `pill 999px` (`--adp-radius-*`).

**Sizing** — card width `420px`; side panel `360px`; icon action `30px`; min touch target `44px`.

**Card gutter** — one consistent **22px** horizontal gutter on the bar, body region, and footer so the
brand mark, headword, body text, and footer line all share the same left edge. (Side panel: `18px`,
applied the same way across header, body, footer.)

### Elevation

- **One Surface Rule.** Exactly one surface is ever visible. The card owns background/radius/shadow;
  the bottom-sheet container is transparent; the side panel paints the surface itself and carries **no**
  card framing (no radius, no shadow, no close button). Never nest the card inside a second visible card.
- `shadow-card` — three warm-tinted layers (light) / near-black layers (dark).
- `shadow-trigger` — two lighter warm layers.
- `glow` — a faint warm radial wash behind the surface top edge: `background: var(--ad-glow), var(--ad-surface)`.

### Motion — one easing, four durations

| Token       | Value                            | Use                                 |
| ----------- | -------------------------------- | ----------------------------------- |
| `ease`      | `cubic-bezier(0.22, 1, 0.36, 1)` | Default ease-out, no bounce.        |
| `dur-fast`  | `140ms`                          | Hover, focus, button press.         |
| `dur-base`  | `240ms`                          | Card content fade-in.               |
| `dur-slow`  | `320ms`                          | Card enter, bottom-sheet slide-up.  |
| `dur-theme` | `360ms`                          | Surface cross-fade on theme change. |

- **Card enter:** `opacity 0→1`, `translateY(10px)→0`, `scale(.98)→1` over `dur-slow`.
- **Spinner:** a 15px arc — `border: 2px solid var(--ad-line)` with `border-top-color: var(--ad-accent)`,
  rotating `0.77s linear infinite`. The only spinning element.
- **Bottom sheet:** slide-up via `transform: translateY(100%)→0` on `dur-slow`.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, drop all transitions/animations (sheet
  appears with no slide; theme swaps instantly).

## 6. Components & surfaces

### 6.1 Floating trigger — the "Define" pill

Full pill: `background: surface`; `1px solid line-strong`; `shadow-trigger`; padding `7px 13px 7px 10px`
(tighter on the mark side). Brand mark (18px) + "Define" (`13px/600`, `ink`). Hover: `surface-raised`,
lift `translateY(-1px)`. Focus: `2px solid accent`, offset `2px`. Loading: replace the label with the
15px spruce-arc spinner, set `disabled`, keep a stable `aria-label="Look up selected text"` (no
`aria-busy` on a disabled button). Isolation: `all: initial` + `z-index: 2147483647` on the host.

### 6.2 Lookup card — shell

Top → bottom:

1. **`.ad-card__accent`** — a `3px` top strip, `linear-gradient(90deg, var(--ad-accent), var(--ad-warm) 92%)`.
   A single quiet spruce→clay sweep (replacing the retired festive rainbow ribbon), clipped by the `18px`
   radius. Decorative; `aria-hidden`.
2. **`.ad-card__bar`** — brand cluster (mark 21px + "AI Dictionary" in `accent-ink` `12px/700`) on the
   left; the action cluster on the right.
3. **`.ad-body-region`** — a `<section aria-live="polite">` so loading→result announces once.
4. **`.ad-footer`** — hairline-topped row, shield glyph + "Stays on your device" (`ink-faint`, `11px`).

Surface: `background: var(--ad-glow), var(--ad-surface)`; `shadow-card`; `overflow: hidden`; `width: 420px`.

### 6.3 Card action cluster — order & the side-panel button

The right cluster reads left→right by escalation:

```
[⇥ Open in side panel]  [⚙ Settings]  [✕ Close]
```

- **Open in side panel** is the **first** item — an _icon-only_ `.ad-action` (matching Close) carrying
  `aria-label`/`title="Open in side panel"`. Its glyph is a rounded rectangle (the browser viewport)
  with a vertical divider offset right (panel docked on the right edge): 24×24 viewBox, `fill="none"`,
  `stroke="currentColor"`, stroke-width `1.8`, rendered 15px in the 30px hit target. Clicking promotes
  the current lookup into the persistent side panel (`chrome.sidePanel.open({ tabId })`, called
  synchronously from the user gesture) and dismisses the floating card. It appears on **all desktop card
  states** (setup, loading, result, error) and is **omitted from the mobile bottom sheet** (no side panel
  there).
- **Settings** — text+icon button (sliders glyph) opening the options page.
- **Close** — icon-only `×`, kept at the far edge.

### 6.4 Lookup card — four states

- **Setup-invite:** centered mark + "Set up AI Dictionary" (`17px/700`) + one-line explainer + a primary
  **Open Settings** button.
- **Loading:** the selected word shown immediately as the serif headword, then a caption row
  `[spinner] Looking up the meaning…` (`ink-soft`, `13px`). Never an empty box.
- **Result:** serif headword + underline swatch; meta line `IPA · part-of-speech` (`ink-faint`, IPA in
  mono); then rows — **English** — definition, **Tiếng Việt** — translation (label bold in `ink`, body in
  `ink`); then an _Example:_ line in `ink-soft`.
- **Error:** headword "Lookup failed" + message in `error` + a ghost **Retry** button.

### 6.5 Headword + underline (signature)

`.ad-headword` — Georgia `1.7rem`, inline-block, with a `::after` underline swatch `44px × 3px`,
`linear-gradient(90deg, var(--ad-accent), var(--ad-warm))`, left-aligned. Reads like a dictionary entry's
rule.

### 6.6 Icon buttons (`.ad-action`)

`30px` square, `9px` radius, `display: grid; place-items: center`. Rest: transparent + `ink-faint`.
Hover: `surface-raised` + `ink`, `140ms` ease. Focus-visible: `2px solid accent`, offset `2px`. A `.text`
variant widens for "Settings". Never hard-code a color — the icon stroke is `currentColor`.

### 6.7 Bottom sheet (mobile)

Transparent centering container (no surface of its own). `scrim` backdrop, dismiss-on-click. Panel
`max-height: 88vh`, scrollable, respects `env(safe-area-inset-bottom)`. Slide-up via `transform` on
`dur-slow`. `role="dialog"`, `aria-modal="true"`, focus-trapped, ESC-to-close, focus restoration. A
`[reduced]` attribute drops the transition. **No side-panel button** here.

### 6.8 Side panel (persistent docked)

- Paints the surface itself: `background: var(--ad-glow), var(--ad-surface)`, **no** radius / shadow /
  close button. `360px` wide, full height; only the body scrolls.
- Structure: `.ad-panel__accent` (3px strip) → header (mark + brand + Settings icon) → scrolling body =
  **focus region** then **Recent** → hairline footer.
- **Focus region** (`aria-live="polite"`): the current lookup in the card's states, plus a panel-only
  **empty state** — centered mark, "Select a word on any page", one-line instruction.
- **Recent list:** newest-first; each row a full-width button (`word` + muted one-line context); hover
  reveals a delete affordance (trash glyph). Clicking re-shows that lookup. Hide the whole section
  (header included) when history is empty. Rows are sans (serif stays reserved for the focus headword).
- Re-sanitize stored markdown at the render boundary (S4); never trust history as pre-sanitized.

### 6.9 Settings / options form — FULLY THEMED

> ⚠️ **This supersedes any earlier "keep it native / neutral" guidance.** The options page wears the
> **full `--ad-*` palette** and re-themes with the picker, exactly like the card and side panel. There is
> **no native-chrome surface left** — no white `#fff` cards, no `#202124` text, no system-blue buttons,
> no blue checkboxes or focus rings. Any browser-default chrome that still shows is a bug.

A calm, restful single column (max-width ~600px, centered), never a dashboard. Each section is an
`.opt-card`. Sections, in order: **Header** (brand + serif "Settings" title) · **Connection** (provider
select, Gemini key field with locked-from-env state, accent-soft info note, Test connection) ·
**Translation** (target language, card-format textarea in a `surface-sunken` mono well, Restore default)
· **Appearance** (Theme control: `Sepia · Dark · High Contrast · Match system`, a segmented control whose
pressed segment is `accent` fill / `on-accent` text, wired to `setTheme`) · **Privacy & data** (Cache /
Save-history checkboxes with `accent-color: var(--ad-accent)`, Clear cache, Clear history, Export history
link) · **Save bar** (primary **Save settings** + a "Settings saved" toast in the accent-soft + 3px
accent left-border treatment).

Verify the form re-themes correctly in **all three** themes against its own surface (≥4.5:1 text,
≥3:1 UI).

### 6.10 Brand mark (signature)

The holly is retired (intrinsically festive). The mark is built from the system's own vocabulary — the
**headword rule + a diacritic accent dot** — so it reads as "a defined word" in any theme, the dot a
quiet nod to the diacritics of the reader's language. CSP-safe SVG, fills bound to tokens
(`--ad-warm` dot + `--ad-accent` rule), always `aria-hidden`; 18px in the trigger, 21px in the card
brand. Keep it geometric — no hand-drawn / `feTurbulence` textures.

### 6.11 Canonical UI icon set (do not substitute)

> ⚠️ **Use exactly these icons.** Earlier builds substituted ad-hoc glyphs because the set wasn't pinned.

All are **CSP-safe inline SVG, `stroke="currentColor"`** (inheriting `ink-faint` at rest, `ink` on
hover), geometric, `1.7–1.9` stroke, rounded caps/joins, `aria-hidden` (the button/row carries the real
label). Sizes: **15px** in card/panel action buttons, **14px** for close & trash, **13px** for the footer
shield.

| Icon                                  | Where                                         |
| ------------------------------------- | --------------------------------------------- |
| **Settings** (sliders)                | card bar "Settings" button; side-panel header |
| **Close** (×)                         | card bar close button                         |
| **Side panel** (rect + right divider) | card bar "Open in side panel" button          |
| **Shield** (privacy)                  | footer "Stays on your device"                 |
| **Trash** (delete)                    | side-panel Recent rows                        |

The settings sliders icon fills its two knobs with `var(--ad-surface)` so they read as sitting _on_ the
track and stay correct in every theme.

## 7. Do & Don't

**Do**

- Keep one quiet spruce accent for _meaning_; warm-shift every neutral; aim for comfortable (not maximal)
  contrast (~8–11:1 body).
- Render every color in OKLCH and verify ≥4.5:1 body / ≥3:1 UI in **all three** themes, against the
  card's own surface.
- Keep the card fully opaque and self-contained (own shadow root, own tokens, `z-index: 2147483647`,
  `all: initial`).
- Read **only** `--ad-*` / `--adp-*` tokens in components; add a token rather than hard-coding a value.
- Keep exactly one visible surface (the One Surface Rule): card owns bg/radius/shadow; bottom sheet is
  transparent; side panel has no card framing.
- Keep the headword the only serif and the body the native `system-ui` sans.
- Distinguish the two languages by order, label, and weight — never by color alone.
- Tint shadows warm (45–60°); degrade motion under `prefers-reduced-motion`.

**Don't**

- Reintroduce seasonal/festive trim (holly, pine/cranberry, rainbow ribbon, honey-amber glow) into the
  default themes.
- Use pure `#fff` or `#000` anywhere.
- Push the accent to high chroma or let it glow aggressively; fill a surface or tint body text with it.
- Nest the card inside a second visible card/frame.
- Hard-code a hex/oklch value in a component, name a theme in a component, or branch on
  `prefers-color-scheme` per-component (theme switching is centralized).
- Substitute a different settings/close/shield/trash/side-panel glyph for the canonical set.
- Apply native browser chrome to the settings form — it is fully themed now.
- Sprawl Settings into a dashboard — keep it a calm, restful single-column form even when themed.
- Use a webfont for body, a third font family, or the serif anywhere but the headword.
- Use neutral-gray shadows; they read cold against the warm surface.
