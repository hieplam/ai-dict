---
bundle: "03"
title: shared-ui
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["02"]
owns_files:
  - packages/shared-ui/package.json
  - packages/shared-ui/tsconfig.json
  - packages/shared-ui/vitest.config.ts
  - packages/shared-ui/src/lookup-trigger.ts
  - packages/shared-ui/src/lookup-card.ts
  - packages/shared-ui/src/bottom-sheet.ts
  - packages/shared-ui/src/settings-form.ts
  - packages/shared-ui/src/styles/**
  - packages/shared-ui/src/index.ts
  - packages/shared-ui/test/*.test.ts
---

# Bundle 03 — shared-ui/ (presentational Web Components)

**Purpose:** The four framework-free Web Components rendered in **open** Shadow DOM with Constructable Stylesheets (`adoptedStyleSheets`, no inline `<style>` — CSP `style-src 'self'`). Presentational only: emit events, hold no business logic, import core **types only**. Accessibility (§7.5) is first-class.

## Lock protocol
Verify prereq `02-core.md` is `DONE`. Flip YAML → LOCKED, commit `[03] lock`, rebase, abort on race. Execute.

## Inputs
- Bundle 02 DONE: domain types (`LookupResult`, `LookupError`, `PublicSettings`, `HistoryEntry`) imported **as types**.
- Spec §5.3 (component table + events + shadow-mode note), §7.5 (a11y), §7.3 S5 (CSP / adoptedStyleSheets).

## Outputs (frozen contracts — tags + events)
- `<lookup-trigger>` → emits `lookup-click`; `role="button"`, `aria-label`, keyboard-activatable, focus ring.
- `<lookup-card payload>` → emits `close`, `expand`; renders sanitized-Markdown result + loading + error states; semantic headings (H2/H3), `aria-live="polite"`. (Sanitization pipeline itself lives in 04; the card accepts already-safe content / a render hook.)
- `<bottom-sheet>` → emits `dismiss`; `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, ESC closes, restores focus, respects `prefers-reduced-motion`.
- `<settings-form>` → emits `save`, `clear-cache`, `clear-history`, `test-connection`, `export-history`; password input + reveal for key, target-lang picker, prompt textarea, history list, cache controls; labels + `aria-describedby`.
- All styles via `adoptedStyleSheets`; no inline `<style>` anywhere.

## Definition of Done
- D1: All four components register as custom elements and render in jsdom.
- D2: Each documented event fires with the correct `detail` shape and name (exact names from §5.3).
- D3: Open Shadow DOM used (testable by `@testing-library/dom` reaching `shadowRoot`); no closed roots.
- D4: `axe-core` reports zero violations for each component's rendered states (loading/result/error where applicable).
- D5: `<bottom-sheet>` focus trap + ESC-to-dismiss + focus restore verified; `prefers-reduced-motion` disables slide animation.
- D6: No inline `<style>` — styles attached via `adoptedStyleSheets` (asserted in test/build).
- D7: Imports from core are **type-only** (lint hex rule passes); no port impls imported.
- D8: Coverage ≥ 75% (spec §8.2).

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** TDD per component: failing render/event/a11y test → impl → pass → commit.

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/shared-ui test --coverage` (vitest + jsdom + @testing-library/dom + axe-core) → pass, ≥ 75%.

## Validate (sanity / no scope drift)
- `pnpm --filter @ai-dict/shared-ui typecheck` + `pnpm lint` clean (type-only core import).
- `git diff --stat` only `packages/shared-ui/**`.
- No business logic (no fetch, no storage, no workflow) inside components.
- No inline `<style>` blocks present.

## Self-audit (run BEFORE sign-off)
- [ ] D1–D8 met with evidence?
- [ ] Tag names + event names match §5.3 / README contracts exactly?
- [ ] Open Shadow DOM (not closed) confirmed?
- [ ] a11y (axe-core) clean across states?
- [ ] adoptedStyleSheets only — CSP-safe?
- [ ] core imported as types only?
- [ ] Only `packages/shared-ui/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `03`.
