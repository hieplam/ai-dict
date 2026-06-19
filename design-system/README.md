# Frontend Design System — source of truth

**This folder is THE single source of truth for the AI Dictionary frontend design system.**
Everything about how the extension looks — the "Paperlight" identity, the token system, the
three themes, every surface (trigger, lookup card, bottom sheet, side panel, onboarding,
settings) — is defined here. Read this folder before changing any UI.

> New here (human or LLM)? Read in this order: **`DESIGN.md`** → **`PRODUCT.md`** →
> **`IMPLEMENTATION_GUIDE.md`**, and open **`AI Dictionary Design System.html`** in a browser to
> see it all rendered.

## What's in this folder

| File                                   | What it is                                                                                                                                                                                                               | Audience                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **`DESIGN.md`**                        | The **visual design system**: token architecture, the full Sepia/Dark/High-Contrast color tables, typography, spacing/motion, and every component/surface. Start here.                                                   | Humans + LLMs                     |
| **`PRODUCT.md`**                       | The **strategic / brand** doc: who it's for, product purpose, brand personality, design principles, accessibility commitments. The "why" behind the visuals.                                                             | Humans + LLMs                     |
| **`IMPLEMENTATION_GUIDE.md`**          | The build-ready **engineering spec** for "Paperlight" — the most detailed reference (theme mechanism, per-surface specs, the canonical icon set, an a11y checklist). Verbatim external hand-off; kept formatting-frozen. | Humans + LLMs                     |
| **`AI Dictionary Design System.html`** | The **living visual reference**: open it in a browser and flip the Sepia / Dark / High-Contrast toggle to see every surface re-theme. The visualization layer.                                                           | Humans (and LLMs via screenshots) |
| **`tokens.css`**                       | The **portable token export**: primitives (`--adp-*`) + per-theme semantic blocks (`--ad-*`). Mirrors the shipped `packages/app/src/ui/styles/tokens.ts`.                                                                | Humans + LLMs                     |

## Source-of-truth precedence

1. **Shipped runtime tokens** — `packages/app/src/ui/styles/tokens.ts` (in code) is what actually
   renders. `tokens.css` here is its portable mirror.
2. **This folder's docs** (`DESIGN.md`, `PRODUCT.md`, `IMPLEMENTATION_GUIDE.md`) describe and
   govern that implementation and must be kept in sync with it.

When a doc and the shipped code disagree, the **code + `IMPLEMENTATION_GUIDE.md` win** — fix the
doc. The root `README.md` and the C3 model (`c3-117 ui-components`, `ref-web-components-shadow-dom`)
point back here; they don't duplicate it.

## The one rule that never bends

Components read **only** `--ad-*` (semantic) and `--adp-*` (primitive) tokens — never a hard-coded
hex/oklch value, never a theme name, never a per-component `prefers-color-scheme` branch. Theme
switching is centralized via the `data-ad-theme` attribute. Adding a theme is **one token block**,
not a rebuild. No pure `#fff` / `#000`. The retired "Candlelit Margin" cozy-Christmas look (holly,
pine/cranberry, honey-amber glow, festive ribbon) must not return to the default themes.
