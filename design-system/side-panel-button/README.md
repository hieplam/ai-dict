# Handoff: "Open in side panel" button — AI Dictionary lookup card

## Overview
This handoff covers a single additive change to the **AI Dictionary** browser extension's
lookup card: a new **"Open in side panel"** action button in the card's top-right action
cluster. Pressing it promotes the current lookup into the persistent **side panel** docked
on the **right edge of the browser** (Chrome `chrome.sidePanel` / Firefox sidebar).

The button is purely a new affordance — nothing else about the card changes. This document
is self-contained: a developer who wasn't in the design session can implement it from here
alone.

## About the design files
The files in this bundle are **design references created in HTML** — a living style guide /
prototype showing the intended look and behavior. They are **not production code to copy
verbatim**. The task is to **recreate this affordance inside the extension's existing
codebase** (its real card component — Shadow DOM web component, React, etc.), reusing the
established `--ad-*` token system and the existing `.ad-action` button pattern. If the card
is currently built another way, follow that codebase's conventions; the HTML here only
defines the target look and behavior.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, icon geometry, and the three
themes (Sepia / Dark / High-Contrast) are all final and token-driven. Recreate pixel-faithfully
using the codebase's existing card chrome and tokens.

## Where the button goes (placement rationale)
The lookup card header (`.ad-card__bar`) has two zones:
- **Left:** brand mark + "AI Dictionary" label (`.ad-brand`).
- **Right:** the action cluster (`.ad-actions`) — utility chrome.

The side-panel button joins the **right cluster as the first item**, so the order reads
left→right by escalation:

```
[⇥ Open in side panel]  [⚙ Settings]  [✕ Close]
```

Rationale: opening the side panel is a *utility / promotion* action (move this lookup to a
persistent surface), not part of the definition content — so it belongs with Settings/Close,
not in the body. Placing it first in the cluster (leftmost of the three) keeps the
destructive **Close** at the far edge where users expect it, and groups the two
"go elsewhere" actions (panel, settings) together.

It is an **icon-only** button (matching Close), not a text+icon button (Settings), to keep
the bar compact. It carries `aria-label` and `title="Open in side panel"`.

This button appears on **all desktop lookup-card states** (setup invite, loading, result,
error) for consistency. It is **omitted from the mobile bottom sheet**, which has no side
panel.

## The icon
Drawn in the system's icon language: 24×24 viewBox, `fill="none"`, `stroke="currentColor"`,
stroke-width `1.8`, round caps/joins — identical conventions to the Settings and Close icons,
so it inherits `currentColor` and re-themes for free.

Glyph: a rounded rectangle (the browser viewport) with a vertical divider offset to the
**right**, denoting a panel docked on the right edge.

```html
<button class="ad-action" aria-label="Open in side panel" title="Open in side panel">
  <svg class="ico" viewBox="0 0 24 24" width="15" height="15" fill="none"
       stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="14" rx="2.5"/>
    <line x1="14" y1="5" x2="14" y2="19"/>
  </svg>
</button>
```

- Rendered at **15×15** inside a 30×30 hit target (`--adp-action-size`).
- Color: `currentColor`, which resolves to `--ad-ink-faint` at rest and `--ad-ink` on hover
  (inherited from `.ad-action` / `.ad-action:hover`). Do **not** hard-code a color.

## Component spec — `.ad-action` (the button)
Reuse the existing class. For reference, its full definition:

```css
.ad-action {
  width: var(--adp-action-size);   /* 30px */
  height: var(--adp-action-size);  /* 30px */
  display: grid; place-items: center;
  border-radius: var(--adp-radius-control);  /* 9px */
  background: transparent;
  color: var(--ad-ink-faint);
  border: 0; cursor: pointer; padding: 0;
  transition: background var(--adp-dur-fast) var(--adp-ease),
              color var(--adp-dur-fast) var(--adp-ease);
}
.ad-action:hover         { background: var(--ad-surface-raised); color: var(--ad-ink); }
.ad-action:focus-visible { outline: 2px solid var(--ad-accent); outline-offset: 2px; }
```

States:
- **Rest:** transparent bg, `--ad-ink-faint` stroke.
- **Hover:** `--ad-surface-raised` bg, `--ad-ink` stroke, `140ms` ease.
- **Focus-visible:** 2px `--ad-accent` outline, 2px offset.
- **Active/pressed:** no extra style needed; the panel opens on click.

## Interaction & behavior
- **Click / Enter / Space →** open the extension's side panel and load the *current* lookup
  (same word + sentence context the card is showing) into it, then it's reasonable to close
  the floating card (the panel now owns the lookup). Match existing card-dismiss behavior.
- In Chrome MV3 this is `chrome.sidePanel.open({ tabId })` — note it **must be called from a
  user gesture**, so the click handler should invoke it synchronously (don't await unrelated
  async first). Firefox: `browser.sidebarAction.open()`.
- The side-panel surface itself already exists in the design system (`.ad-panel`, "history"
  and "empty" states) — this button is just a new entry point into it.
- Keyboard: button is in normal tab order, after the brand, before Settings.
- Reduced motion: no animation on the button itself; respect existing card transitions.

## Side panel target (existing surface, for context)
The panel the button opens is already specced in the design system:
- `.ad-panel` — 360px wide, full viewport height, flex column.
- 3px accent top bar, header (brand + Settings gear), scrollable body, "Stays on your
  device" footer.
- States: current lookup + **Recent** history list, and an **empty** state.
- Recreate using the same tokens; this handoff does not change the panel.

## Design tokens used by this change
All already defined in `tokens.css` (bundled). The button introduces **no new tokens**.

| Token | Role here | Sepia value |
|---|---|---|
| `--adp-action-size` | button hit target | `30px` |
| `--adp-radius-control` | button corner | `9px` |
| `--ad-ink-faint` | icon at rest | `oklch(0.610 0.018 65)` |
| `--ad-ink` | icon on hover | `oklch(0.345 0.022 60)` |
| `--ad-surface-raised` | hover bg | `oklch(0.935 0.020 78)` |
| `--ad-accent` | focus ring | `oklch(0.500 0.068 168)` |
| `--adp-dur-fast` | hover transition | `140ms` |
| `--adp-ease` | easing | `cubic-bezier(0.22, 1, 0.36, 1)` |

Dark / High-Contrast values for the same semantic names live in `tokens.css` — the icon
re-themes automatically because it uses `currentColor` and the button reads only `--ad-*`.

## Assets
No new image assets. The icon is inline CSP-safe SVG (no external file). Existing extension
icons live in the project's `assets/` folder and are unaffected.

## Files in this bundle
- `AI Dictionary Design System.html` — the full living style guide; the new button is live in
  every lookup-card state (Surfaces section §07). Flip the Sepia/Dark/Contrast toggle to see
  it re-theme.
- `tokens.css` — the complete token source of truth (primitives `--adp-*` + semantic
  `--ad-*` per theme). Link or port these.
- `IMPLEMENTATION_GUIDE.md` — the existing full spec for the extension (reference for how the
  card and panel are built).
- `README.md` — this document.

## Definition of done
- [ ] Icon-only button added as the **first** child of `.ad-actions` on all desktop card
      states (setup, loading, result, error).
- [ ] Uses existing `.ad-action` styling; no hard-coded colors; icon stroke is `currentColor`.
- [ ] `aria-label="Open in side panel"` + `title`; keyboard-operable; focus ring visible.
- [ ] Click opens the right-docked side panel from a user gesture and loads the current lookup.
- [ ] Verified in Sepia, Dark, and High-Contrast themes.
- [ ] Not present on the mobile bottom sheet.
