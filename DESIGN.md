---
name: AI Dictionary
description: A warm, candlelit bilingual lookup card that appears in the margin of whatever you're reading.
colors:
  candlelit-cream: 'oklch(0.985 0.009 80)'
  cream-soft: 'oklch(0.962 0.017 72)'
  ink: 'oklch(0.31 0.025 50)'
  ink-soft: 'oklch(0.45 0.022 55)'
  honey-amber: 'oklch(0.61 0.13 64)'
  mulled-cranberry: 'oklch(0.52 0.16 25)'
  pine: 'oklch(0.46 0.075 155)'
  line: 'oklch(0.9 0.014 74)'
  error: 'oklch(0.5 0.17 25)'
typography:
  headword:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: '1.7rem'
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  brand-label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '12px'
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: '0.01em'
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
rounded:
  control: '8px'
  card: '16px'
  pill: '999px'
spacing:
  xs: '2px'
  sm: '8px'
  md: '12px'
  lg: '16px'
components:
  trigger-pill:
    backgroundColor: '{colors.candlelit-cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.pill}'
    padding: '7px 12px 7px 9px'
    typography: '{typography.trigger-label}'
  trigger-pill-hover:
    backgroundColor: '{colors.cream-soft}'
    textColor: '{colors.ink}'
  lookup-card:
    backgroundColor: '{colors.candlelit-cream}'
    textColor: '{colors.ink}'
    rounded: '{rounded.card}'
    width: '420px'
  card-headword:
    textColor: '{colors.ink}'
    typography: '{typography.headword}'
  card-brand:
    textColor: '{colors.pine}'
    typography: '{typography.brand-label}'
  card-action:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-soft}'
    rounded: '{rounded.control}'
    size: '28px'
  card-action-hover:
    backgroundColor: '{colors.cream-soft}'
    textColor: '{colors.ink}'
  card-footer:
    textColor: '{colors.ink-soft}'
    typography: '{typography.footer-label}'
---

# Design System: AI Dictionary

## 1. Overview

**Creative North Star: "The Candlelit Margin"**

AI Dictionary is a warm pool of light cast in the margin of whatever you happen to be reading. A reader hits an unfamiliar English word mid-sentence; one selection brings up a small, self-owned card that explains the word in this sentence, in their language, then gets out of the way. The whole system is built to feel like a candle set down beside the page: honey-amber glow at the top of the surface, a serif headword that reads like a printed dictionary entry, and just enough festive trim (a holly mark, a thin ribbon) to make the card unmistakably _ours_ the instant it appears over any website.

The card overlays arbitrary, unpredictable pages, so it is built as a fully opaque, fully self-contained shadow-DOM surface that carries its own tokens and never leans on the host background. Every color is OKLCH and tuned for WCAG AA against its own surface, verified in-browser, because legibility has to hold whether the page behind it is a white news site or a black code editor. The warmth is the felt emotion the product designs for: the relief of understanding without friction, the calm of a tool that respects you. The cozy-Christmas identity is the carrier of that warmth, not a costume on top of it.

This system explicitly rejects the experiences that make looking a word up feel like work: the ad-cluttered dictionary site with its pop-overs and "related searches"; the heavy SaaS dashboard with persistent chrome and card grids; the data-harvesting AI app that feels like it phones home; and the playful AI gimmick that substitutes mascots, emoji, and "✨AI✨" sparkle-glow for actual personality. Distinct through craft, never through noise. The festive language is restrained on purpose: it lives at the trim of the card, not all over it.

**Key Characteristics:**

- **In-page, not in-app.** The cozy identity belongs to the reading surfaces: the lookup card that floats over the host page and the docked side panel that mirrors it. The settings/options form — a configuration surface, not a reading one — stays deliberately neutral.
- **Candlelit warmth.** A honey-amber radial glow tops the card surface; the palette sits in warm OKLCH hues (45–80°) with festive accents at pine green and cranberry red.
- **Opaque and self-contained.** Own shadow root, own tokens, full opacity. The card never borrows the page's background or fights its content.
- **Bilingual clarity first.** The English headword and its translation are each unmistakable and scannable; meaning is never carried by color alone.
- **Adapts to the page.** Light and dark token sets switch on `prefers-color-scheme`, so the card matches the host page's mood.
- **Privacy you can feel.** A shield-marked "Stays on your device" line is part of the card itself, not buried fine print.

## 2. Colors

A warm, candlelit reading surface: honey-amber is the signature, with pine green and mulled-wine cranberry as the small festive accents. Every value is OKLCH, tuned for WCAG AA against its own surface. Each token carries a light value (below) and a paired dark value applied inside `@media (prefers-color-scheme: dark)`.

### Primary

- **Honey-Amber** (`oklch(0.61 0.13 64)`; dark `oklch(0.82 0.13 72)`): The signature. It is the candle. Used for the warm radial glow at the top of the card, the focus-ring outline on every control, the spinner's leading arc, and the warm midpoint of the festive ribbon. It is the color the card is remembered by.

### Secondary

- **Pine Green** (`oklch(0.46 0.075 155)`; dark `oklch(0.67 0.085 155)`): The festive evergreen. Carries the brand label ("AI Dictionary"), the holly leaves, the left end of the ribbon, and the left half of the headword underline. A calm, low-chroma green that reads as botanical, not neon.
- **Mulled-Wine Cranberry** (`oklch(0.52 0.16 25)`; dark `oklch(0.67 0.155 28)`): The berry accent. The holly berries, the right end of the ribbon, and the right half of the headword underline. Warm red, deliberately muted toward wine rather than candy.

### Neutral

- **Candlelit Cream** (`oklch(0.985 0.009 80)`; dark `oklch(0.265 0.022 52)`): The card surface itself. A warm near-white in light mode, a deep warm brown-charcoal in dark. Fully opaque; this is what isolates the card from the host page.
- **Cream Soft** (`oklch(0.962 0.017 72)`; dark `oklch(0.31 0.026 50)`): The one-step-warmer hover fill for icon buttons and the trigger pill.
- **Ink** (`oklch(0.31 0.025 50)`; dark `oklch(0.93 0.016 82)`): Primary text. The headword, body copy, and active control labels. Carries the ≥4.5:1 body contrast against cream.
- **Ink Soft** (`oklch(0.45 0.022 55)`; dark `oklch(0.75 0.022 72)`): Secondary text. Icon-button rest color and the footer line.
- **Line** (`oklch(0.9 0.014 74)`; dark `oklch(0.37 0.022 55)`): Hairline borders and dividers (footer rule, trigger-pill border, spinner track).

### Tertiary

- **Error** (`oklch(0.5 0.17 25)`; dark `oklch(0.72 0.15 25)`): Failure messaging only. A cousin of cranberry pushed to higher chroma so an error never reads as decorative festive red.

### Named Rules

**The Trim Rule.** The festive accents (pine, cranberry) live only at the _trim_ of the card: the 4px ribbon, the holly mark, the brand label, the headword underline. They never fill a surface or tint body text. Strip the trim away and the card is still a calm, legible reading surface. That restraint is what keeps "Christmas" from tipping into gimmick.

**The Candle Rule.** Honey-amber is the only color that _glows_. It is the radial wash at the top of the card and the focus ring; it is never used for plain text or borders. Its job is light, not labeling.

**The No-Color-Only Rule.** The English term and its translation must be distinguishable without color (order, label, and weight carry the distinction). Primary users read in a second language; color is decoration, never the signal.

## 3. Typography

**Display Font:** Georgia (with `"Times New Roman", serif`)
**Body Font:** system-ui (with `-apple-system, "Segoe UI", sans-serif`)

**Character:** A printed-dictionary serif for the headword sets the one moment of editorial authority, then the native system sans carries everything else with zero load cost and perfect host-page familiarity. The contrast is on a real axis (serif headword vs. sans everything-else), so the two never compete. No third family, no display face for labels.

### Hierarchy

- **Headword** (Georgia serif, `1.7rem`, line-height `1.15`, letter-spacing `-0.01em`): The looked-up word. The single serif element in the system, rendered as an inline-block with a short pine→cranberry gradient underline swatch (44px × 3px) sitting under its left edge. Reads like the head of a dictionary entry.
- **Brand label** (system-ui, `700`, `12px`, letter-spacing `0.01em`, pine): "AI Dictionary" in the card bar, paired with the holly mark.
- **Body** (system-ui, `15px`, line-height `1.6`, ink): The definition content (IPA, part of speech, learner definition, translation, example) projected into the card. The card caps at 420px wide, keeping prose comfortably under the 65–75ch line-length ceiling.
- **Trigger label** (system-ui, `600`, `13px`, line-height `1`, ink): The word "Define" inside the floating trigger pill.
- **Footer label** (system-ui, `11px`, ink-soft): The "Stays on your device" privacy line beside the shield.

### Named Rules

**The One Serif Rule.** Georgia appears exactly once per card: the headword. Everything else is the system sans. A serif in a button or label would break the editorial-vs-utility contrast that makes the headword feel authoritative.

**The Native Sans Rule.** The body face is always the host system's UI font (`system-ui` stack), never a webfont. It costs nothing to load, never blocks the lookup, and makes the card feel like it belongs on the reader's own machine.

## 4. Elevation

The card is a single lifted surface floating above an arbitrary page; depth is conveyed by one warm, layered drop shadow plus the candlelit glow, not by stacked cards. There is exactly one visible surface at a time: when the card is presented inside the bottom sheet, the sheet panel is transparent and the card alone carries the bg, radius, and shadow, so the card is never framed in a second card. Surfaces are flat internally; the only "elevation" is the whole card lifting off the page.

### Shadow Vocabulary

- **Card lift (light)** (`box-shadow: 0 1px 1px oklch(0.4 0.05 50 / 0.05), 0 12px 26px -8px oklch(0.42 0.06 45 / 0.26), 0 30px 60px -24px oklch(0.4 0.06 45 / 0.3)`): The lookup card's resting shadow. Three warm-tinted layers (the shadow is keyed to warm hues, not neutral gray) for a soft, candle-warm lift off the host page.
- **Card lift (dark)** (`box-shadow: 0 1px 1px oklch(0 0 0 / 0.3), 0 16px 32px -10px oklch(0 0 0 / 0.55), 0 40px 70px -28px oklch(0 0 0 / 0.6)`): Deeper, near-black layers so the card still separates from a dark host page.
- **Trigger lift** (`box-shadow: 0 2px 5px oklch(0.4 0.05 50 / 0.16), 0 10px 22px -10px oklch(0.4 0.06 45 / 0.4)`): The floating pill's two-layer warm shadow, lighter than the card.
- **Glow** (`radial-gradient(125% 80% at 50% -14%, oklch(0.85 0.12 78 / 0.72), transparent 72%)`; dark uses `oklch(0.72 0.14 72 / 0.46)`): Not a shadow but the candlelight: a honey-amber radial wash layered behind the card surface at its top edge.
- **Scrim** (`oklch(0.18 0.02 50 / 0.46)`): The warm dim behind the bottom sheet on mobile. A warm-tinted dark, never neutral black.

### Named Rules

**The One Surface Rule.** Only one cozy surface is ever visible. The card owns the bg/radius/shadow; any container around it (the bottom sheet) is transparent. Never nest the card inside a second visible card.

**The Warm Shadow Rule.** Shadows are tinted toward warm hue (45–52°), never neutral gray. A gray shadow under a candlelit card reads cold and breaks the warmth.

## 5. Components

### Floating Trigger (the "Define" pill)

- **Character:** A small, confident pill that appears next to the reader's selection. The shortest possible affordance from "I don't know this word" to "now I do."
- **Shape:** Full pill (`border-radius: 999px`).
- **Style:** Cream surface, `1px solid` line border, holly mark + "Define" label (system-ui 600/13px, ink), asymmetric padding `7px 12px 7px 9px` (tighter on the holly side). Carries the two-layer trigger-lift shadow.
- **Hover:** Background shifts to cream-soft.
- **Focus:** `2px solid honey-amber` outline, `2px` offset.
- **Loading:** On click the label is removed and replaced by a 13px amber-arc spinner; the button is `disabled` (no `aria-busy` — AT removes disabled buttons from the tree). The accessible name stays stable via `aria-label="Look up selected text"`.
- **Isolation:** The host uses `all: initial` to fend off arbitrary page CSS (custom properties survive it) and `z-index: 2147483647` so no positioned page ancestor can occlude it.

### Lookup Card

- **Character:** The candlelit margin itself. The product's whole identity in one 420px-wide surface.
- **Corner Style:** `16px` radius. Festive trim is clipped by `overflow: hidden`.
- **Background:** Candlelit-cream with the honey-amber glow layered on top (`background: var(--ad-glow), var(--ad-surface)`).
- **Shadow:** The three-layer warm card-lift (see Elevation).
- **Ribbon:** A `4px` top strip, `linear-gradient(90deg, pine, amber 52%, cranberry)`. The single most festive element; decorative, clipped by the rounded corners.
- **Bar:** Brand cluster (holly mark + "AI Dictionary" in pine 700/12px) on the left, a `28px` close button on the right.
- **Content region:** A `<section aria-live="polite">` projecting light-DOM content through a `<slot>`, so loading→result transitions announce once.
- **Footer:** A hairline-topped row with a shield icon and "Stays on your device" (ink-soft, 11px) — privacy made visible.
- **States:** _Loading_ (the reader's selected word shown immediately as the serif headword, with a visible "Looking up the meaning…" caption led by a small amber spinner — the spinner is the caption's `::before`, so the card reads as populated and on-brand the instant Define is clicked, never as an empty box); _Result_ (serif headword + sanitized definition body); _Error_ ("Lookup failed" headword + cranberry-leaning error text).

### Icon Buttons (card actions)

- **Shape:** `28px` square, `8px` radius, `display: grid; place-items: center`.
- **Rest:** Transparent background, ink-soft icon (15px, stroked with `currentColor`).
- **Hover:** Cream-soft background, ink icon.
- **Focus:** `2px solid honey-amber` outline, `2px` offset.

### Bottom Sheet (mobile presentation)

- **Character:** A transparent, centering container that slides the card up from the bottom on small screens. It carries no surface of its own.
- **Scrim:** Warm dim (`oklch(0.18 0.02 50 / 0.46)`), dismiss-on-click.
- **Panel:** `max-height: 88vh`, scrollable, respects `env(safe-area-inset-bottom)`.
- **Motion:** Slide-up via `transform` on `transition: 0.28s cubic-bezier(0.22, 1, 0.36, 1)` (ease-out, no bounce).
- **Accessibility:** `role="dialog"`, `aria-modal="true"`, focus-trapped, ESC-to-close, focus restoration on close. `[reduced]` attribute (set from `prefers-reduced-motion`) drops the transition entirely.

### Side Panel (persistent docked surface)

- **Character:** The candlelit margin made persistent. When the reader opens the panel from the toolbar, it docks full-height beside the page and keeps a running record of their reading. Unlike the floating card it is _the_ surface, not a surface floating over one.
- **The One Surface Rule, applied:** the panel paints the cozy surface itself — candlelit-cream with the honey-amber glow at the top edge — and carries **no** card framing: no `border-radius`, no drop shadow, no Close button. Re-framing a docked panel as a floating card would double the surface. Depth comes from the host browser chrome.
- **Structure (top → bottom):** the festive `4px` ribbon; a brand header (holly + "AI Dictionary" in pine); a scrolling body holding the **focus region** then the **Recent** list; a hairline-topped privacy footer ("Stays on your device"). Header and footer are flush; only the body scrolls.
- **Focus region** (`<section aria-live="polite">`): the current lookup, in the card's own three states (loading headword + spinner caption, serif headword + sanitized body, error). It opens on a fourth, panel-only **empty state** — a centered holly mark with "Select a word on any page" and a one-line instruction — so a freshly opened panel teaches the interface instead of showing a wordless spinner.
- **Recent list:** the reader's history (`history.list` over the wire), newest-first, each row a full-width button (`word` + a muted one-line context snippet). Clicking re-shows that lookup in the focus region. The whole section is hidden when history is empty — never an empty "Recent" header. Per the One Serif Rule the rows are the system sans; Georgia stays reserved for the focus headword.
- **Markdown safety:** stored and mirrored markdown is re-sanitized at the render boundary (S4); the panel never trusts history as pre-sanitized.
- **Accessibility:** the focus region announces loading→result once via `aria-live="polite"`; recent rows carry an explicit "Show definition of {word}" label; honey-amber focus rings on every control; verified against the panel's own surface in light and dark.

### Holly Mark (signature)

- **Character:** The brand mark. A clean, geometric holly sprig: two pine ellipse-leaves angled apart, one upright, with a three-berry cranberry cluster below. CSP-safe SVG with presentation-attribute fills bound to `--ad-pine` and `--ad-cranberry`.
- **Sizes:** `18px` in the trigger, `21px` in the card brand cluster.
- **Always `aria-hidden`:** Decorative. Every place it appears carries its own accessible label.

### Headword Underline (signature)

- A short gradient swatch (`linear-gradient(90deg, pine, cranberry)`, `44px × 3px`, left-aligned, no-repeat) sitting under the serif headword. A festive flourish that reads as a dictionary entry's rule, not decoration.

### Settings Form (deliberately outside the cozy system)

The extension options form is plain neutral browser chrome (`#202124` on `#f1f3f4` controls), not the `--ad-*` palette. This is intentional, not drift: the cozy-Christmas identity belongs to the in-page card that floats over the reader's page. The settings form lives on a browser-owned surface where the right move is restraint and native familiarity, not festive trim. Keep it neutral.

## 6. Do's and Don'ts

### Do:

- **Do** keep the festive accents (pine, cranberry) at the _trim_ only — ribbon, holly, brand label, headword underline. Strip the trim and the card must still be a calm, legible reading surface.
- **Do** use honey-amber as the one glowing color: the radial card glow, the focus ring, the spinner arc. Nothing else glows.
- **Do** render every color in OKLCH and verify ≥4.5:1 body / ≥3:1 UI contrast in-browser, against the card's _own_ surface, in both light and dark.
- **Do** keep the card fully opaque and self-contained (own shadow root, own tokens). It must read identically over a white news site and a black editor.
- **Do** isolate any over-page host with `all: initial` plus the cozy `--ad-*` tokens (custom properties survive `all`) and lift it with `z-index: 2147483647`.
- **Do** keep exactly one visible cozy surface: the card carries bg/radius/shadow; the bottom sheet stays transparent.
- **Do** keep the headword the only serif and the body the native `system-ui` sans.
- **Do** distinguish the two languages by order, label, and weight — never by color alone.
- **Do** tint shadows and the scrim toward warm hue (45–52°), never neutral gray.

### Don't:

- **Don't** let the design feel like an **ad-cluttered dictionary site** — no pop-overs, no "related searches," no SEO sludge. Escaping that is the entire reason this exists.
- **Don't** grow it into a **heavy SaaS dashboard** — no persistent sidebars, no card grids everywhere, no settings sprawl. This is a focused overlay, not an app shell.
- **Don't** make it **feel like it phones home** — no telemetry chrome, no account walls, no "engagement" surfaces. It must look as private as it is.
- **Don't** reach for **playful AI gimmicks** — no mascots, no emoji-soaked copy, no gradient-glow "✨AI✨" novelty, no sparkles standing in for personality. Distinct, not cute.
- **Don't** fill a surface or tint body text with pine or cranberry. They are trim, not paint.
- **Don't** nest the card inside a second visible card or frame.
- **Don't** introduce a third font family or use the serif anywhere but the headword.
- **Don't** use a webfont for body — the native system sans is the rule.
- **Don't** apply the cozy `--ad-*` palette to the settings/options form; browser-chrome surfaces stay deliberately neutral.
- **Don't** use a hand-drawn / `feTurbulence` "sketchy" holly — the mark is clean geometric SVG with token-bound fills, on purpose.
- **Don't** use neutral-gray shadows under the warm card; they read cold and break the candlelight.
