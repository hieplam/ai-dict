---
id: adr-20260615-paperlight-spec-compliance
c3-seal: 9aeb94ba4252dcff6351df13c3b2203931799c2b4d835f5e2277bd71f0faedae
title: paperlight-spec-compliance
type: adr
goal: 'Correct three places where the Paperlight implementation (#64) diverges from the design hand-off (`design-hand-off/IMPLEMENTATION_GUIDE.md` + `AI Dictionary Design System.html`), all in c3-117 ui-components: (1) re-skin the Settings/options `<settings-form>` to wear the FULL `--ad-*` Paperlight palette and re-theme live with the picker — replacing the "deliberately neutral browser-chrome" decision that adr-20260615-paperlight-redesign authorized on a misreading of §5.8; (2) replace the ad-hoc 16×16 settings/close/shield/trash glyphs with the canonical 24×24 icon set pinned in §5.10; (3) apply the single 22px horizontal gutter from §5.11 to the lookup card''s bar, body region, and footer. Visual + theming only — no product behavior, IA, key-isolation, sanitization, wire, or accessibility change.'
status: accepted
date: "2026-06-15"
---

## Goal

Correct three places where the Paperlight implementation (#64) diverges from the design hand-off (`design-hand-off/IMPLEMENTATION_GUIDE.md` + `AI Dictionary Design System.html`), all in c3-117 ui-components: (1) re-skin the Settings/options `<settings-form>` to wear the FULL `--ad-*` Paperlight palette and re-theme live with the picker — replacing the "deliberately neutral browser-chrome" decision that adr-20260615-paperlight-redesign authorized on a misreading of §5.8; (2) replace the ad-hoc 16×16 settings/close/shield/trash glyphs with the canonical 24×24 icon set pinned in §5.10; (3) apply the single 22px horizontal gutter from §5.11 to the lookup card's bar, body region, and footer. Visual + theming only — no product behavior, IA, key-isolation, sanitization, wire, or accessibility change.

## Context

adr-20260615-paperlight-redesign decision point (4) reads "per hand-off §5.8, making the Settings/options FORM deliberately neutral browser-chrome (drop the --ad-* palette)", and its Alternatives table rejects "Keep the Settings/options form fully branded in Paperlight" as "a config surface reads best as neutral native browser-chrome". This inverts the actual §5.8, which opens with a ⚠️ block: "This supersedes any earlier 'keep it native' guidance. The options page wears the full --ad-* palette and re-themes with the picker… There is no native-chrome surface left… If any control still shows browser-default chrome, it is a bug." The shipped `settings-form.ts` therefore styles every control with CSS system-color keywords (Canvas/CanvasText/Field/ButtonBorder/AccentColor/GrayText/ButtonFace/LinkText/Mark) and maps `data-ad-theme` only to `color-scheme`, never to the `--ad-*` layer. Two further §-flagged regressions ride along: §5.10 ("Use exactly these icons… Earlier builds substituted ad-hoc glyphs") is violated by ICON_SETTINGS/ICON_CLOSE/ICON_SHIELD (lookup-card.ts), ICON_TRASH/ICON_SHIELD (side-panel-view.ts), and ICON_SHIELD (settings-form.ts, onboarding-view.ts) all being 16×16 hand-cut paths; and §5.11's single 22px card gutter is violated by lookup-card.ts using 16px (bar asymmetric at 12px right). All affected files belong to c3-117; constraints from ref-web-components-shadow-dom (single adopted stylesheet, CSP-safe inline SVG, survive `all: initial`) and the sanitized-markdown render path (S4) must be preserved.

## Decision

(1) Rewrite `settings-form.ts` CSS + markup to the §5.8 token mapping: page `--ad-surface-sunken`; `.opt-card` = `--ad-surface` + `1px solid --ad-line`; labels/fields/help/buttons/links/checkboxes/dividers/notes all bound to `--ad-*`; serif "Settings" title in `--ad-ink`; brand cluster in `--ad-accent-ink`; the env-key hint becomes a `.opt-note` (accent-soft fill + 3px accent left border) and the save status a matching `.opt-toast`. Fold `THEME_CSS` into the form's adopted sheet and keep the live-preview stamping `data-ad-theme` so the whole page re-themes (not just `color-scheme`). Replace the `<select id="theme">` with a segmented control (`.seg`, `role=group`, `aria-pressed` buttons Sepia/Dark/High Contrast/Match system; pressed = `--ad-accent`/`--ad-on-accent`), matching the reference Settings mock. (2) Add the four canonical 24×24 icons (settings sliders, close, shield, trash) to `styles/tokens.ts` as a single exported source and consume them from lookup-card, side-panel-view, settings-form, onboarding so the set can never drift again; keep §5.10 sizes (15px actions, 14px close/trash, 13px shield). (3) Set the lookup card's bar/region/footer to a uniform 22px horizontal gutter. This wins over a narrower per-file patch because §5.10 explicitly blames "the set wasn't pinned" for prior drift — centralizing the icons in tokens.ts is the durable fix, not re-cutting glyphs in four files.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | settings-form re-skinned to the --ad-* palette + segmented theme control; canonical icons centralized in tokens.ts and consumed by lookup-card/side-panel-view/onboarding; lookup-card 22px gutter | Comply with ref-web-components-shadow-dom (single adopted sheet, CSP-safe inline SVG, survive all:initial); rule-sanitize-model-output + rule-api-key-isolation render/key paths untouched |
| adr-20260615-paperlight-redesign | N.A - prior ADR is terminal historical record | The earlier ADR's §5.8 reading is superseded by this ADR; its content stays frozen as history | N.A - terminal-state ADRs are content-frozen; this ADR documents the correction |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | The re-skinned settings-form and re-iconed components must stay framework-free open-shadow elements styled by ONE constructable stylesheet, CSP-safe (inline SVG presentation attributes only, no inline <style>), surviving all: initial | comply |
| ref-wire-protocol-validation | The Theme control still emits the same sepia/dark/contrast/system values through the existing save event into the unchanged settings record; the segmented control must not introduce a value outside the zod enum | comply |
| ref-core-dependency-rule | Tokens, icons, and the form live in the portable core (packages/app); both shells consume the identical look — no platform fork of the new icons or palette | comply |
| ref-kv-storage-prefixes | Governs the settings record this form edits; listed to confirm the re-skin touches no storage key | N.A - styling/markup only; no KV key or prefix added or moved |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | settings-form's re-skin must not change how the Gemini key field is gated, locked (keyFromEnv), or echoed back on save — only its CSS/markup change | comply |
| rule-sanitize-model-output | settings-form sets status text via textContent only and renders no model output; the re-skin keeps it that way (no new innerHTML on any model-influenced path) | comply |
| rule-gate-runtime-messages | Governs inbound runtime messages; listed to confirm the segmented theme control adds no new gated message | N.A - theme live-preview is a local attribute stamp; save reuses the existing event |
| rule-typed-errors | Cited by c3-117's governance set; listed to confirm no error-handling path is touched | N.A - only CSS, markup, and the theme-control widget change; no error path |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Icons | Add canonical ICON_SETTINGS/ICON_CLOSE/ICON_SHIELD/ICON_TRASH (24×24, stroke=currentColor) to styles/tokens.ts; export and import from lookup-card, side-panel-view, settings-form, onboarding | grep shows no remaining 16×16 ad-hoc glyph in those files |
| Settings re-skin | Rewrite settings-form.ts CSS to the §5.8 --ad-* token table + fold THEME_CSS; markup uses .opt-card/.opt-sec/.opt-lbl/.opt-field/.opt-help/.opt-btn/.opt-select/.opt-textarea/.opt-divider/.opt-note/.opt-check/.opt-primary/.opt-link/.opt-toast; serif title; accent-ink brand | settings-form.test.ts updated + green; screenshots in all three themes |
| Theme control | Replace <select id="theme"> with .seg segmented buttons (aria-pressed); collect()/value setter read/write the pressed pref; live preview stamps data-ad-theme | settings-form.test.ts theme-control assertions; e2e theme-live-preview/theme-setting green |
| Card gutter | lookup-card.ts bar/region/footer → uniform 22px horizontal gutter (bar 14px 22px 6px-style, region 6px 22px, footer 11px 22px) | lookup-card.test.ts (if it pins padding) + card screenshot |
| Comment cleanup | Remove stale festive prose in onboarding-view.ts ("ribbon, holly, candlelit glow") and the "DELIBERATELY NEUTRAL" rationale in settings-form.ts | grep shows no stale festive/native-chrome comment |
| Contract sync | Update c3-117 data-ad-theme contract row: settings-form now maps the attribute to the full --ad-* palette (not native color-scheme) | c3 read c3-117 shows corrected row; c3 check passes |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| C3 CLI / validators / schema / hints / templates | N.A - product code + component-doc body only; no C3 CLI binary, validator, schema row, hint, or template changes | c3 check passes unchanged before/after; only c3-117 body updated via c3 write |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| packages/app/test/ui/settings-form.test.ts | Asserts the form renders the segmented theme control and themed controls; env-key lock + deferred-hydration paths stay green | bun run --filter @ai-dict/app test settings-form |
| adoptedStyleSheets.length === 1 regression test | Fails if settings-form stops folding tokens+THEME_CSS into its single sheet | existing ui test kept green |
| e2e theme-live-preview.spec.ts / theme-setting.spec.ts | Drives the real options page; asserts the picker re-themes the page surface | bun run e2e:chrome (targeted) |
| bun run typecheck / lint | Fails on any broken icon import or Theme consumer | CI typecheck + lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep settings-form neutral browser-chrome (the shipped #64 decision) | Directly violates §5.8's ⚠️ "no native-chrome surface left… if any control still shows browser-default chrome, it is a bug"; this ADR exists specifically to correct that misreading |
| Re-cut the canonical icons inline in each of the four files | §5.10 blames prior drift on "the set wasn't pinned"; duplicating glyphs across files reproduces the exact failure mode — centralizing in tokens.ts is the durable fix |
| Use a themed <select> for the Theme control (allowed by §5.8) instead of a segmented control | The reference Settings mock (AI Dictionary Design System.html) renders a segmented .seg group; matching the living visual reference avoids a second round of "doesn't match the mock" |
| Set the card gutter to 22px on the left only, keep the asymmetric icon-side padding | §5.11 calls the asymmetric padding itself the defect ("that misalignment is what makes a card feel off-balance"); the spec wants an equal right margin |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Themed settings-form drops below AA contrast in dark/contrast themes | Use the hand-off's tuned --ad-* values verbatim; the form reads the same semantic tokens already AA-verified on the card | Browser screenshot review of settings in Sepia + Dark + High Contrast |
| Segmented control regresses the save/collect theme contract | Keep the same Theme values + save event payload; update settings-form.test.ts to drive the segmented control | bun run --filter @ai-dict/app test settings-form |
| A component stops folding tokens into its one adopted sheet (CSP/isolation regression) | Keep the selector-less-string + single-sheet pattern; no inline <style> added | adoptedStyleSheets.length===1 test green |
| Icon centralization breaks an import or changes an accessible name | Icons stay aria-hidden; each control keeps its own aria-label; typecheck catches a bad import | bun run typecheck; bun run --filter @ai-dict/app test |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | No type errors |
| bun run lint | Clean |
| bun run test | All unit tests green (updated settings-form expectations) |
| bun run build (chrome) | dist builds |
| e2e theme-live-preview + theme-setting + provider-selection (targeted) | Green against the built extension |
| Browser screenshots: settings in Sepia/Dark/High Contrast, card gutter, canonical icons | Captured and attached to the PR as before/after evidence |
| c3 check | Passes; ADR Parent Delta recorded for c3-117 |
