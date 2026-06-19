# AI Dictionary — "Paperlight" Design System & Implementation Guide

> **For:** Claude Code (and any engineer) implementing the AI Dictionary browser
> extension.
> **What this is:** the complete, build-ready spec for the redesigned add-in and
> its theme-able token system. Pair it with `tokens.css` (the single source of
> truth) and `AI Dictionary Design System.html` (the living visual reference).
>
> **Two jobs this document does:**
> 1. **Theme architecture** — so a new theme is *one token block*, never a rebuild.
> 2. **The redesign** — every surface (trigger, card, bottom sheet, side panel,
>    onboarding), recomposed around eye-comfort reading.

---

## 0. North star — "Paperlight"

A calm sheet of paper-light in the margin of whatever the reader is reading. One
selection brings up a small, self-owned card that explains a word **in this
sentence, in the reader's language**, then gets out of the way.

The system is tuned for **tired eyes on long reads**. That single goal drives
every value:

| Principle | How it's encoded |
|---|---|
| **Eye-comfort first** | No pure white, no pure black. Every neutral is warm-shifted. |
| **Comfortable, not maximal, contrast** | Body text targets **~8–11:1**, never the harsh 21:1 of `#000` on `#fff`. |
| **Quiet color** | One low-chroma signature (spruce-teal). Color signals; it never glares. |
| **One opaque surface** | The card owns its background, radius and shadow. It never borrows the host page. |
| **Bilingual clarity** | English term vs. translation is told apart by order, label and weight — never color. |
| **Theme-able to the core** | Components read only semantic `--ad-*` tokens. A theme re-binds them. |

This **retires the previous "Candlelit Margin" cozy-Christmas identity** (holly
mark, pine/cranberry trim, honey-amber glow, festive ribbon). The festive look may
return later as an *optional* theme, but it is no longer the brand.

---

## 1. Theme architecture

### 1.1 Three token layers

```
PRIMITIVES   --adp-*   raw, theme-agnostic: type scale, spacing, radii, motion.
                       NEVER themed.
SEMANTIC     --ad-*    meaning-based: surface, ink, accent, line, shadow…
                       Re-bound per theme. Components read ONLY these.
THEMES                 [data-ad-theme="sepia"]    (default, reading-warm)
                       [data-ad-theme="dark"]     (warm low-glare night)
                       [data-ad-theme="contrast"] (accessibility, high-contrast)
```

**The law:** a component (`.ad-card`, `.ad-trigger`, …) may reference `--ad-*` and
`--adp-*` tokens and nothing else. It must never name a theme, never hard-code a
hex/oklch value, never branch on `prefers-color-scheme`. Re-theming then touches
zero component code.

### 1.2 Adding a theme = one block

To add (say) a high-contrast or sepia-night theme, append **one block** to
`tokens.css`:

```css
[data-ad-theme="my-theme"] {
  color-scheme: light; /* or dark */
  --ad-surface: …;
  --ad-ink: …;
  /* …re-bind every --ad-* semantic token… */
}
```

Then add it to the picker's option list (§6). No component changes. No rebuild of
the system.

### 1.3 Switching themes (user-facing picker + persistence)

Theme is chosen in **Settings** (see §5.7) and applies everywhere — the over-page
card, the side panel, the bottom sheet.

**Mechanism:** set `data-ad-theme` on the theme root. For the over-page card and
side panel that root is the **shadow-root host element** (`:host`); tokens defined
on `:host` cascade into the shadow tree. For the options page it's
`document.documentElement`.

```js
// theme.js — shared by content script, side panel, options page
const THEME_KEY = 'ad:theme';           // 'sepia' | 'dark' | 'contrast' | 'system'
const THEMES = ['sepia', 'dark', 'contrast'];

export async function getTheme() {
  const { [THEME_KEY]: t } = await chrome.storage.local.get(THEME_KEY);
  return t || 'system';
}

export function resolveTheme(pref) {
  if (pref === 'system') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'sepia';
  }
  return THEMES.includes(pref) ? pref : 'sepia';
}

/** root = shadow host element (card/panel) OR document.documentElement (options) */
export function applyTheme(root, pref) {
  root.setAttribute('data-ad-theme', resolveTheme(pref));
}

export async function setTheme(pref) {
  await chrome.storage.local.set({ [THEME_KEY]: pref });
  // broadcast so an open card / side panel re-theme live:
  chrome.runtime.sendMessage({ type: 'ad:theme-changed', pref });
}
```

- Persist with `chrome.storage.local` (syncs the privacy story: stays on device).
- `'system'` follows the OS and live-updates via a `matchMedia` `change` listener.
- On `ad:theme-changed`, every open surface calls `applyTheme(host, pref)`.
- The `360ms` cross-fade is already wired: `--ad-surface`, `--ad-ink`,
  `box-shadow` transition on `--adp-dur-theme`. Honour `prefers-reduced-motion`.

### 1.4 Shadow-DOM isolation (the over-page card & trigger)

The card and trigger inject over arbitrary host pages. The host element MUST:

```css
:host {
  all: initial;                 /* fend off arbitrary page CSS (custom props survive) */
  /* tokens.css :root + [data-ad-theme] values must also be scoped to :host —
     ship tokens.css twice: once for :root (options page) and once for :host
     (shadow roots). A simple approach: author tokens with a `&, :host` selector
     list, or inject the same custom-property block onto the host. */
}
```

- `z-index: 2147483647` on the positioned host so no page ancestor occludes it.
- The card is fully opaque (`--ad-surface`), so it reads identically over a white
  news site and a black editor.

---

## 2. Color tokens

All values are **OKLCH**. Tuned for WCAG AA *against the card's own surface*,
verified in-browser in both themes. Approximate contrast noted inline.

### 2.1 SEPIA (default, reading-warm)

| Token | Value | Role / notes |
|---|---|---|
| `--ad-surface` | `oklch(0.962 0.016 80)` | Warm paper. The card/panel background. |
| `--ad-surface-raised` | `oklch(0.935 0.020 78)` | Hover fill, chips. |
| `--ad-surface-sunken` | `oklch(0.978 0.011 82)` | Input wells, recent-row hover. |
| `--ad-ink` | `oklch(0.345 0.022 60)` | Body & headword. ~9.5:1 — clear, not harsh. |
| `--ad-ink-soft` | `oklch(0.500 0.020 62)` | Secondary text. ~5:1. |
| `--ad-ink-faint` | `oklch(0.610 0.018 65)` | Captions, rest-state icons. ~3.3:1 (UI). |
| `--ad-line` | `oklch(0.895 0.012 78)` | Hairline dividers. |
| `--ad-line-strong` | `oklch(0.855 0.014 76)` | Input / trigger borders. |
| `--ad-accent` | `oklch(0.500 0.068 168)` | **Signature spruce.** Focus ring, spinner, brand, links. |
| `--ad-accent-ink` | `oklch(0.430 0.072 168)` | Accent used as *text* on paper. ~5.5:1. |
| `--ad-accent-soft` | `oklch(0.925 0.030 168)` | Accent tint: focus halo, selection. |
| `--ad-on-accent` | `oklch(0.985 0.008 80)` | Text/icon on an accent fill (primary button). |
| `--ad-warm` | `oklch(0.560 0.090 48)` | Clay. Trim only (underline 2nd half, accent strip end). |
| `--ad-warm-ink` | `oklch(0.500 0.092 46)` | Clay as text, if ever needed. |
| `--ad-error` | `oklch(0.520 0.160 28)` | Failure only. The one high-chroma value. |
| `--ad-glow` | `radial-gradient(120% 72% at 50% -12%, oklch(0.91 0.038 78 / 0.36), transparent 70%)` | Faint warm wash at the card's top edge. |
| `--ad-scrim` | `oklch(0.28 0.020 60 / 0.42)` | Warm dim behind the bottom sheet. |
| `--ad-selection` | `oklch(0.80 0.06 168 / 0.45)` | Text selection within the card. |

### 2.2 DARK (warm low-glare night)

| Token | Value | Role / notes |
|---|---|---|
| `--ad-surface` | `oklch(0.255 0.013 70)` | Warm charcoal — **never** blue-black. |
| `--ad-surface-raised` | `oklch(0.305 0.015 68)` | Hover fill. |
| `--ad-surface-sunken` | `oklch(0.225 0.012 70)` | Wells. |
| `--ad-ink` | `oklch(0.905 0.014 84)` | Warm off-white — **never** `#fff`. ~11:1. |
| `--ad-ink-soft` | `oklch(0.740 0.016 80)` | Secondary. ~5.5:1. |
| `--ad-ink-faint` | `oklch(0.605 0.016 76)` | Captions/icons. ~3.2:1 (UI). |
| `--ad-line` | `oklch(0.360 0.016 68)` | Hairlines. |
| `--ad-line-strong` | `oklch(0.420 0.018 66)` | Input borders. |
| `--ad-accent` | `oklch(0.785 0.070 168)` | Lifted spruce, AA on charcoal. |
| `--ad-accent-ink` | `oklch(0.810 0.072 168)` | Accent text. |
| `--ad-accent-soft` | `oklch(0.385 0.040 168)` | Tint/halo. |
| `--ad-on-accent` | `oklch(0.220 0.015 70)` | Dark ink on the lifted accent fill. |
| `--ad-warm` | `oklch(0.760 0.085 50)` | Clay, lifted. |
| `--ad-warm-ink` | `oklch(0.785 0.085 52)` | — |
| `--ad-error` | `oklch(0.720 0.140 28)` | Failure only. |
| `--ad-glow` | `radial-gradient(120% 72% at 50% -12%, oklch(0.50 0.050 72 / 0.30), transparent 70%)` | Glow pulled almost to nothing. |
| `--ad-scrim` | `oklch(0.10 0.010 60 / 0.58)` | — |
| `--ad-selection` | `oklch(0.55 0.06 168 / 0.50)` | — |

### 2.2b HIGH CONTRAST (accessibility) — *the “add a theme = one block” proof*

This whole theme is **one extra block** in `tokens.css`. No component changed —
they already read only `--ad-*`. Stronger contrast, crisp defining edges (a 1px
shadow ring stands in for the missing soft shadow), and **no decorative glow**.

| Token | Value | Role / notes |
|---|---|---|
| `--ad-surface` | `oklch(0.985 0.006 85)` | Near-white, faintly warm. |
| `--ad-surface-raised` | `oklch(0.930 0.010 82)` | Hover fill. |
| `--ad-surface-sunken` | `oklch(0.970 0.008 85)` | Wells. |
| `--ad-ink` | `oklch(0.200 0.015 60)` | ~16:1 — maximum legibility. |
| `--ad-ink-soft` | `oklch(0.340 0.018 62)` | ~9:1. |
| `--ad-ink-faint` | `oklch(0.430 0.018 64)` | ~6:1 — “faint” stays strong. |
| `--ad-line` | `oklch(0.720 0.012 78)` | Visible, not hairline. |
| `--ad-line-strong` | `oklch(0.560 0.014 76)` | — |
| `--ad-accent` | `oklch(0.400 0.100 168)` | Deeper spruce, AAA on white. |
| `--ad-accent-ink` | `oklch(0.360 0.100 168)` | — |
| `--ad-accent-soft` | `oklch(0.900 0.040 168)` | — |
| `--ad-on-accent` | `oklch(0.990 0.005 85)` | — |
| `--ad-warm` | `oklch(0.450 0.120 45)` | — |
| `--ad-error` | `oklch(0.450 0.180 28)` | — |
| `--ad-glow` | `linear-gradient(transparent, transparent)` | No decorative glow. |
| `--ad-shadow-card` | `0 0 0 1px oklch(0.560 0.014 76 / 0.9), 0 6px 18px -8px oklch(0.30 0.02 60 / 0.22)` | 1px ring = crisp edge + a light lift. |

### 2.3 Named color rules

- **Quiet-Accent Rule** — the signature is the only color used for *meaning*
  (focus ring, spinner, brand label, links). It never fills a surface or tints
  body text.
- **No-Color-Only Rule** — English term vs. its translation is distinguished by
  order, label and weight, never by hue. Primary users read in a second language.
- **Comfort-Contrast Rule** — body text aims for ~8–11:1, not maximal. Verify
  in-browser, per theme, against the *card's own* surface.
- **Warm-Shadow Rule** — shadows are tinted warm (45–60° hue), never neutral grey.

---

## 3. Typography

| Role | Family | Size | Weight | Line / tracking |
|---|---|---|---|---|
| Headword | `--adp-font-serif` (Georgia) | `1.7rem` | 400 | `1.15` / `-0.01em` |
| Sub-headword / panel header | `--adp-font-sans` (system-ui) | `17px` | 700 | — |
| Body (definition) | `--adp-font-sans` | `15px` | 400 | `1.62` |
| Brand label | `--adp-font-sans` | `12px` | 700 | `0.02em`, `--ad-accent-ink` |
| Trigger label / recent rows | `--adp-font-sans` | `13px` | 600 | — |
| Footer / caption | `--adp-font-sans` | `11px` | 400 | `--ad-ink-soft` |
| IPA | `--adp-font-mono` | `13px` | 400 | — |

**Rules**
- **One Serif Rule** — Georgia appears exactly once per surface: the headword. A
  serif anywhere else breaks the editorial-vs-utility contrast.
- **Native Sans Rule** — body is always the host `system-ui` stack, never a
  webfont. Zero load cost, never blocks the lookup, feels native.
- **Generous leading** — body line-height is `1.62` for long-read comfort.
- The headword direction (serif vs. sans) is a **token flip**
  (`--adp-text-headword` + family) if a future theme wants the modern sans cut.
  Default and recommendation: **serif**.

---

## 4. Space, shape, elevation & motion

**Spacing** — 4px base: `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32`
(`--adp-space-*`).

**Radii** — `control 9px` · `card 18px` · `pill 999px` (`--adp-radius-*`).

**Sizing** — card width `420px`; icon action `30px`; min touch target `44px`.

**Elevation**
- **One Surface Rule** — exactly one cozy surface is ever visible. The card owns
  background/radius/shadow; the bottom sheet container is transparent. Never nest
  the card in a second visible card. The side panel paints the surface itself and
  carries *no* card framing (no radius, no shadow, no close button).
- `--ad-shadow-card` — three warm-tinted layers (light) / near-black layers (dark).
- `--ad-shadow-trigger` — two lighter warm layers.
- `--ad-glow` — a faint warm radial wash layered behind the surface top edge:
  `background: var(--ad-glow), var(--ad-surface);`

**Motion** — one easing, three durations:

| Token | Value | Use |
|---|---|---|
| `--adp-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | Default ease-out, no bounce. |
| `--adp-dur-fast` | `140ms` | Hover, focus, button press. |
| `--adp-dur-base` | `240ms` | Card content fade-in. |
| `--adp-dur-slow` | `320ms` | Card enter, bottom-sheet slide-up. |
| `--adp-dur-theme` | `360ms` | Surface cross-fade on theme change. |

- **Card enter:** `opacity 0→1`, `translateY(10px)→0`, `scale(.98)→1` over
  `--adp-dur-slow`.
- **Spinner:** a 15px arc — `border: 2px solid var(--ad-line)` with
  `border-top-color: var(--ad-accent)`, `rotate 0.77s linear infinite`. The only
  spinning element.
- **Bottom sheet:** slide-up via `transform: translateY(100%)→0` on
  `--adp-dur-slow`.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, drop all transitions
  and animations (sheet appears with no slide; theme swaps instantly).

---

## 5. Components & surfaces

Class names below are the contract; markup mirrors
`AI Dictionary Design System.html`. Every value resolves to a token.

### 5.1 Floating trigger — the "Define" pill
- **Shape:** full pill. `background: --ad-surface`; `1px solid --ad-line-strong`;
  `--ad-shadow-trigger`; padding `7px 13px 7px 10px` (tighter on the mark side).
- **Content:** brand mark (18px) + "Define" (`13px/600`, `--ad-ink`).
- **Hover:** `--ad-surface-raised`, lift `translateY(-1px)`.
- **Focus:** `2px solid --ad-accent`, offset `2px`.
- **Loading:** replace the label with the 15px amber→**spruce** arc spinner; set
  `disabled`; keep a stable `aria-label="Look up selected text"`.
- **Isolation:** `all: initial` + `z-index: 2147483647` on the host.

### 5.2 Lookup card — shell
Structure top→bottom:
1. `.ad-card__accent` — a **3px** top strip,
   `linear-gradient(90deg, var(--ad-accent), var(--ad-warm) 92%)`. This replaces
   the old festive rainbow ribbon: a single quiet spruce→clay sweep, clipped by
   the `18px` radius. (Decorative; `aria-hidden`.)
2. `.ad-card__bar` — brand cluster (mark 21px + "AI Dictionary" in
   `--ad-accent-ink` `12px/700`) on the left; actions (Settings text button +
   30px Close) on the right.
3. `.ad-body-region` — a `<section aria-live="polite">` so loading→result
   announces once.
4. `.ad-footer` — hairline-topped row, shield glyph + "Stays on your device"
   (`--ad-ink-faint`, `11px`).

`background: var(--ad-glow), var(--ad-surface);` · `--ad-shadow-card` ·
`overflow: hidden` · `width: 420px`.

### 5.3 Lookup card — four states
- **Setup-invite:** centered mark + "Set up AI Dictionary" (`17px/700`) + one-line
  explainer + primary **Open Settings** button (`.ad-btn`).
- **Loading:** the selected word shown immediately as the serif headword, then a
  caption row: `[spinner] Looking up the meaning…` (`--ad-ink-soft`, `13px`). Never
  an empty box.
- **Result:** serif headword + underline swatch; meta line
  `IPA · part-of-speech` (`--ad-ink-faint`, IPA in mono); then rows —
  **English** — definition, **Tiếng Việt** — translation (label bold in `--ad-ink`,
  body in `--ad-ink`); then *Example:* line in `--ad-ink-soft`.
- **Error:** headword "Lookup failed" + message in `--ad-error` + a ghost
  **Retry** button.

### 5.4 Headword + underline (signature)
`.ad-headword` — Georgia `1.7rem`, inline-block, with a `::after` underline swatch
`44px × 3px`, `linear-gradient(90deg, var(--ad-accent), var(--ad-warm))`,
left-aligned. Reads like a dictionary entry's rule.

### 5.5 Icon buttons (`.ad-action`)
`30px` square, `9px` radius, `display: grid; place-items: center`. Rest:
transparent + `--ad-ink-faint`. Hover: `--ad-surface-raised` + `--ad-ink`. Focus:
`2px solid --ad-accent`, offset `2px`. A `.text` variant widens for "Settings".

### 5.6 Bottom sheet (mobile)
Transparent centering container (no surface of its own). `--ad-scrim` backdrop,
dismiss-on-click. Panel `max-height: 88vh`, scrollable, respects
`env(safe-area-inset-bottom)`. Slide-up via `transform` on `--adp-dur-slow`.
`role="dialog"`, `aria-modal="true"`, focus-trapped, ESC-to-close, focus
restoration. A `[reduced]` attribute drops the transition.

### 5.7 Side panel (persistent docked)
- Paints the surface itself: `background: var(--ad-glow), var(--ad-surface)`, **no**
  radius / shadow / close button. Full height; only the body scrolls.
- Structure: `.ad-panel__accent` (3px strip) → header (mark + brand + Settings
  icon) → scrolling body = **focus region** then **Recent** → hairline footer.
- **Focus region** (`aria-live="polite"`): the current lookup in the card's states,
  plus a panel-only **empty state** — centered mark, "Select a word on any page",
  one-line instruction.
- **Recent list:** newest-first; each row a full-width button (`word` + muted
  one-line context); hover reveals a delete affordance. Clicking re-shows that
  lookup. Hide the whole section (header included) when history is empty. Rows are
  sans (serif stays reserved for the focus headword).
- Re-sanitize stored markdown at the render boundary; never trust history as
  pre-sanitized.

### 5.8 Settings / options form — FULLY THEMED (complete spec)

> ⚠️ **This supersedes any earlier "keep it native" guidance.** The options page
> wears the **full `--ad-*` palette** and re-themes with the picker, exactly like
> the card and side panel. There is **no native-chrome surface left** — no white
> `#fff` cards, no `#202124` text, no system-blue `#1a73e8` buttons, no blue
> checkboxes or focus rings. If any control still shows browser-default chrome,
> it is a bug.

Keep the form a **calm, restful single column** (max-width ~600px, centered),
never a dashboard. Every section is an `.opt-card`. **Implement these exact
sections, in this order** (they map 1:1 to the real form — see the Settings mock
in the reference HTML):

1. **Header** — brand mark (token-bound SVG) + "AI Dictionary" in
   `--ad-accent-ink`; page title "Settings" (serif, `--ad-ink`).
2. **Connection** — AI provider `<select>`; Gemini API key field (locked state:
   text "Loaded from GEMINI_API_KEY build env", `--ad-ink-faint`); help line
   "Locked — supplied by this build…"; an **info note** (`.opt-note`: `--ad-accent-soft`
   fill, 3px `--ad-accent` left border); dashed divider; **Test connection** button.
3. **Translation** — Target language `<select>`; **Card format** help text +
   `<textarea>` (mono, `--ad-surface-sunken` well); dashed divider; **Restore
   default** button.
4. **Appearance** — **Theme** control: `Sepia · Dark · High Contrast · Match
   system`. Use a segmented control (pressed segment = `--ad-accent` fill /
   `--ad-on-accent` text) or a themed `<select>`. Calls `setTheme(pref)` (§1.3).
   Help line: "Changes how the lookup card and side panel look. Saved on this
   device only."
5. **Privacy & data** — checkboxes "Cache lookups" and "Save history"
   (`accent-color: var(--ad-accent)`); dashed divider; **Clear cache**, **Clear
   history** buttons + **Export history** link (`--ad-accent-ink`, underlined).
6. **Save bar** (outside the cards) — primary **Save settings** button
   (`--ad-accent` / `--ad-on-accent`) + muted "Changes apply after saving"; a
   success **toast** "Settings saved" (`.opt-toast`, same accent-soft + left-border
   treatment as the info note).

**Token mapping for the form controls:**

| Element | Tokens |
|---|---|
| Page background | `--ad-surface-sunken` |
| Section card | `--ad-surface` bg · `1px solid --ad-line` |
| Section label (CONNECTION…) | `--ad-ink-faint`, 11px/700, uppercase, `0.08em` |
| Field label | `--ad-ink`, 13px/600 |
| `<select>` / field / `<textarea>` | `--ad-surface-sunken` bg · `--ad-line-strong` border · `--ad-ink` text |
| Help text | `--ad-ink-faint`, 12px |
| Secondary button | transparent · `--ad-line-strong` border · `--ad-ink`; hover `--ad-surface-raised` |
| Primary button (Save) | `--ad-accent` bg · `--ad-on-accent` text |
| Link (Export history) | `--ad-accent-ink`, underlined |
| Checkbox | `accent-color: var(--ad-accent)` |
| Info note / toast | `--ad-accent-soft` fill · 3px `--ad-accent` left border · `--ad-ink` text |
| Focus ring (all controls) | `2px solid var(--ad-accent)`, offset `2px` |
| Dashed divider | `1px dashed var(--ad-line-strong)` |

Verify the form re-themes correctly in **all three** themes against its own
surface (≥4.5:1 text, ≥3:1 UI).

### 5.9 Brand mark
The holly is retired (intrinsically festive). The new mark is built from the
system's own vocabulary — the **headword rule + a diacritic accent dot** — so it
reads as "a defined word" in any theme, with the accent dot a quiet nod to the
diacritics of the reader's language. **Recommended: "Rule + accent."**

```html
<!-- CSP-safe, fills bound to tokens. 18px in trigger, 21px in card brand. -->
<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true">
  <circle cx="6.5" cy="6.5" r="2.4" fill="var(--ad-warm)"/>
  <rect x="3" y="14.5" width="18" height="3.2" rx="1.6" fill="var(--ad-accent)"/>
</svg>
```
Always `aria-hidden`; every placement carries its own text label. Three alternates
(open aperture, definition bracket, margin tab) are shown in the reference HTML if
you want to pick differently — keep whichever you choose token-bound and geometric
(no hand-drawn / turbulence textures).

### 5.10 UI icon set — canonical (do not substitute)

> ⚠️ **Use exactly these icons.** Earlier builds substituted ad-hoc glyphs
> because the set wasn't pinned. These are the canonical icons; don't swap in a
> different settings/close/shield/trash glyph.

All are **CSP-safe inline SVG, `stroke="currentColor"`** (so they inherit the
token color of their context — `--ad-ink-faint` at rest, `--ad-ink` on hover),
geometric, `1.7–1.9` stroke, rounded caps/joins, and `aria-hidden` (the button or
row carries the real label). Sizes: **15px** in card/panel action buttons, **13px**
for the footer shield, **14px** for close & trash.

| Icon | Where | SVG |
|---|---|---|
| **Settings** (sliders) | card bar "Settings" button; side-panel header | `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15.5" x2="20" y2="15.5"/><circle cx="14.5" cy="9" r="2.4" fill="var(--ad-surface)"/><circle cx="9.5" cy="15.5" r="2.4" fill="var(--ad-surface)"/></svg>` |
| **Close** (×) | card bar close button | `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/></svg>` |
| **Shield** (privacy) | footer "Stays on your device" | `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l6.5 2.4v4.7c0 3.9-2.7 7.1-6.5 8-3.8-.9-6.5-4.1-6.5-8V5.6L12 3.2z"/></svg>` |
| **Trash** (delete) | side-panel Recent rows | `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h15M9 7V4.8h6V7M7 7l.9 12.2h8.2L17 7"/></svg>` |

The settings sliders icon uses two `circle`s filled with `var(--ad-surface)` so the
knobs read as sitting *on* the track — they inherit the surface, so they stay
correct in every theme.

### 5.11 Card gutters & alignment

The card uses **one consistent 22px horizontal gutter** on the bar, body region,
and footer, so the brand mark, headword, body text, and footer line all share the
same left edge (and an equal right margin). Do not let the bar/footer drift to a
different padding than the body — that misalignment is what makes a card feel
off-balance. (Side panel: 18px gutter, applied the same way across header, body,
and footer.)

---

## 6. Accessibility checklist

- [ ] Body text ≥ 4.5:1, UI/non-text ≥ 3:1 — verified in-browser, **per theme**,
      against the card's own surface.
- [ ] Card body region is `aria-live="polite"`; announces loading→result once.
- [ ] Bottom sheet: `role="dialog"`, `aria-modal="true"`, focus-trapped, ESC
      closes, focus restored on close.
- [ ] Every control has a visible `2px solid var(--ad-accent)` focus ring, offset
      `2px`.
- [ ] Trigger keeps a stable `aria-label` across rest/loading; no `aria-busy` on a
      `disabled` button.
- [ ] Recent rows: explicit `aria-label="Show definition of {word}"`; delete
      buttons separately labelled.
- [ ] Options form uses real `<label>`s and `aria-describedby` for help text.
- [ ] `prefers-reduced-motion: reduce` drops transitions/animations.
- [ ] Meaning never carried by color alone (the No-Color-Only Rule).
- [ ] Touch targets ≥ 44px on iOS.

---

## 7. Do & Don't

**Do**
- Keep one quiet accent for meaning; warm-shift every neutral; aim for comfortable
  (not maximal) contrast.
- Keep the card fully opaque and self-contained (own shadow root, own tokens).
- Read only `--ad-*` / `--adp-*` tokens in components.
- Distinguish the two languages by order, label and weight.
- Tint shadows warm; degrade motion under reduced-motion.

**Don't**
- Reintroduce seasonal/festive trim into the default themes.
- Use pure `#fff` or `#000` anywhere.
- Push the accent to high chroma or let it glow aggressively; fill a surface or
  tint body text with it.
- Nest the card inside a second visible card/frame.
- Hard-code a hex/oklch value in a component — add a token.
- Sprawl Settings into a dashboard — keep it a calm, restful form even when themed.

---

## 8. File map

| File | Role |
|---|---|
| `tokens.css` | **Source of truth.** Primitives + per-theme semantic tokens. Drop in as-is. |
| `AI Dictionary Design System.html` | Living visual reference: color wheel, type, motion, all surfaces, live Sepia/Dark toggle. |
| `IMPLEMENTATION_GUIDE.md` | This document. |

When shipping into a shadow root, scope the token blocks to `:host` as well as
`:root` (see §1.4) so custom properties survive `all: initial`.

---

## 9. Prompt for Claude Code

> Copy-paste the block below into Claude Code at the repo root
> (`github.com/hieplam/ai-dict`). Attach `tokens.css`,
> `AI Dictionary Design System.html`, and this guide.

```text
You are reskinning the AI Dictionary browser extension to the new "Paperlight"
design system. I've attached three files: tokens.css (the source of truth),
IMPLEMENTATION_GUIDE.md (the full spec), and AI Dictionary Design System.html
(the living visual reference). Read all three before writing code.

GOAL
Replace the retired "Candlelit Margin" cozy-Christmas look with Paperlight: an
eye-comfort reading aesthetic with two swappable themes (Sepia default, Dark),
switchable from a Theme control in Settings and persisted. Keep the product's
behavior, information architecture, privacy model, and accessibility bar exactly
as they are — this is a visual + theming refactor, not a feature change.

DO THIS, IN ORDER
1. Add tokens.css as the single styling source of truth. Establish the token
   architecture from §1: primitives (--adp-*), semantic tokens (--ad-*), and
   per-theme blocks keyed by [data-ad-theme]. Components must reference ONLY
   --ad-*/--adp-* tokens — no hard-coded colors, no per-component
   prefers-color-scheme branching. Scope the token blocks to BOTH :root and :host
   so they survive `all: initial` inside the shadow roots (§1.4).
2. Implement theme switching per §1.3: a shared theme module (getTheme /
   resolveTheme / applyTheme / setTheme) backed by chrome.storage.local under key
   "ad:theme" with values 'sepia' | 'dark' | 'contrast' | 'system'. 'system' follows
   the OS via matchMedia and live-updates. Broadcast 'ad:theme-changed' so any open
   card or side panel re-themes live with the 360ms cross-fade.
3. Reskin every surface to match §5 and the reference HTML, preserving current
   DOM/ARIA: floating trigger pill, lookup card shell + four states
   (setup-invite, loading, result, error), headword + underline, icon buttons,
   bottom sheet, and the docked side panel (focus region + empty state + Recent
   list). Replace the old festive rainbow ribbon with the 3px spruce→clay
   .ad-card__accent strip.
4. Replace the holly mark with the recommended "Rule + accent" SVG from §5.9
   (CSP-safe, fills bound to --ad-accent / --ad-warm, aria-hidden, 18px in the
   trigger / 21px in the card brand). Regenerate the extension icon set from the
   same mark on a paper-tone background. Use the canonical UI icon set in §5.10
   exactly (settings/close/shield/trash) — do not substitute other glyphs — and
   keep the card's single 22px horizontal gutter from §5.11 so the brand, headword,
   body, and footer all align.
5. Reskin the Settings / options page to be FULLY THEMED per §5.8 — the entire
   page wears the --ad-* palette and re-themes with the picker. Remove ALL native
   chrome: no #fff cards, no #202124 text, no system-blue (#1a73e8) buttons, no
   blue checkboxes or focus rings. Implement every section (Connection,
   Translation, Appearance, Privacy & data, Save bar) exactly as §5.8 + the
   reference HTML's Settings mock show, including the locked API-key state, the
   accent-soft info note, themed selects/textarea/checkboxes, the primary Save
   button, and the "Settings saved" toast. The Theme control (Sepia / Dark /
   High Contrast / Match system) is wired to setTheme.
6. Motion per §4: one easing (cubic-bezier(0.22,1,0.36,1)), durations
   140/240/320/360ms, spinner = spruce arc on a hairline track. Everything
   degrades under prefers-reduced-motion: reduce.

CONSTRAINTS / GUARDRAILS
- No pure #fff or #000 anywhere. Keep body contrast ~8–11:1 (comfortable, not
  maximal); verify ≥4.5:1 text / ≥3:1 UI in BOTH themes against the card's own
  surface.
- The card stays fully opaque and self-contained (own shadow root, own tokens,
  z-index 2147483647, all: initial isolation).
- One visible surface at a time (the One Surface Rule): card owns
  bg/radius/shadow; bottom sheet is transparent; side panel has no card framing.
- Distinguish the two languages by order/label/weight, never color.
- No new features. No telemetry. No accounts. No analytics.

DELIVERABLES
- tokens.css wired in; a shared theme.js module; every surface reskinned; the new
  mark + regenerated icons; the Settings Theme control.
- A short migration note listing every place a hard-coded color or the old holly
  was removed.
- Confirm the a11y checklist in §6 passes in both themes.

Work surface by surface. After each, show me the diff and a screenshot in both
Sepia and Dark before moving on.
```
