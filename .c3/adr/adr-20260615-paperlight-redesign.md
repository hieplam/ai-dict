---
id: adr-20260615-paperlight-redesign
c3-seal: dac79adc15e6e109f7bf92e6b5e18feca5f452b523af243ec0dc7ea12d735071
title: paperlight-redesign
type: adr
goal: 'Replace the retired "Candlelit Margin" cozy-Christmas visual identity (holly mark, pine/cranberry/honey-amber festive palette, rainbow ribbon) with the "Paperlight" eye-comfort reading design system across every in-page and extension-page UI surface, and restructure the styling layer into a three-tier token architecture (`--adp-*` primitives, `--ad-*` semantic, `[data-ad-theme]` themes) so adding a theme is one CSS block and no component code changes. This is a visual + theming refactor only: product behavior, information architecture, the privacy model, the wire protocol, and the accessibility bar are unchanged.'
status: accepted
date: "2026-06-15"
---

## Goal

Replace the retired "Candlelit Margin" cozy-Christmas visual identity (holly mark, pine/cranberry/honey-amber festive palette, rainbow ribbon) with the "Paperlight" eye-comfort reading design system across every in-page and extension-page UI surface, and restructure the styling layer into a three-tier token architecture (`--adp-*` primitives, `--ad-*` semantic, `[data-ad-theme]` themes) so adding a theme is one CSS block and no component code changes. This is a visual + theming refactor only: product behavior, information architecture, the privacy model, the wire protocol, and the accessibility bar are unchanged.

## Context

The in-page UI is a set of framework-free custom elements in `packages/app/src/ui/` (c3-117), each adopting a single Constructable Stylesheet whose `:host` rule folds in shared token strings from `styles/tokens.ts`. Theme is already a real, persisted setting (`settings.theme`, currently `'light' | 'dark' | 'system'`): the service-worker DEFAULTS seed it, the storage-store reads it, the settings/options form edits it, and the composition roots (content script, side panel, options page) stamp it as a `theme` ATTRIBUTE on each host element — an attribute deliberately chosen because it crosses the MV3 MAIN/isolated-world boundary where a JS property write would not. The current `tokens.ts` exports flat `--ad-*` color strings (honey-amber/pine/cranberry) plus a `THEME_DARK_CSS` block keyed on `:host([theme="dark"])` and a `HOLLY_SVG` brand mark, all consumed by lookup-card, lookup-trigger, side-panel-view, settings-form, onboarding-view (bottom-sheet is a transparent container). The hand-off in `design-hand-off/` (IMPLEMENTATION_GUIDE.md + tokens.css) specifies the full Paperlight system, three themes, and a new geometric "Rule + accent" mark. Constraints: strict extension CSP forbids inline `<style>`; custom properties must survive `all: initial` on the trigger/card hosts; the single-adopted-stylesheet invariant is pinned by a regression test; sanitized-markdown rendering (S4) must not change.

## Decision

Adopt Paperlight by (1) rewriting `styles/tokens.ts` into the three-tier system exported as selector-less primitive + semantic strings plus a theme CSS block keyed on `[data-ad-theme="sepia|dark|contrast"]` and a `:host([data-ad-theme="system"])` + `prefers-color-scheme` fallback, all foldable into each component's existing single adopted sheet on `:host`; (2) REUSING the existing `settings.theme` persistence rather than adding a parallel `chrome.storage.local['ad:theme']` key — expand the `Theme` type to `'sepia' | 'dark' | 'contrast' | 'system'`, coerce any stored legacy `'light'` to `'sepia'` on read, and rename the stamped attribute from `theme` to `data-ad-theme`; (3) reskinning every reading surface (card, trigger, bottom-sheet scrim, side panel, onboarding) to the new tokens + "Rule + accent" mark; (4) per hand-off §5.8, making the Settings/options FORM deliberately neutral browser-chrome (drop the `--ad-*` palette) with one themed Theme control (Sepia / Dark / High Contrast / Match system); (5) regenerating the extension icon set from the new mark. Reusing `settings.theme` wins because it keeps one source of truth, already provides on-device persistence + live re-stamp through the relay store, and honors the hand-off's own "keep IA/behavior exactly" rule; a parallel store would duplicate state and risk drift.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | Every custom element + styles/tokens.ts is restyled; the brand mark and token architecture change | Comply with ref-web-components-shadow-dom (single adopted sheet, CSP-safe, open shadow) and rule-sanitize-model-output (render path untouched) |
| c3-101 | component | Theme union expands to sepia/dark/contrast/system | Confirm PublicSettings.theme stays JSON-serializable; no rule delta |
| c3-103 | component | The theme zod enum in wire.ts must accept the new values | Comply with ref-wire-protocol-validation (schema is the single authority) |
| c3-201 | component | storage-store DEFAULTS + legacy-light coercion; floating-trigger default theme + data-ad-theme stamp | Comply with rule-api-key-isolation (no key surface change) |
| c3-210 | component | sw.ts DEFAULTS theme value; icon set regenerated | No rule delta — DEFAULTS + static assets only |
| c3-212 | component | options.ts + side-panel.ts stamp data-ad-theme; settings form goes neutral | Comply with ref-wire-protocol-validation |
| c3-301 | component | storage-store DEFAULTS + coercion; floating-trigger default + stamp, mirroring Chrome | Comply with ref-core-dependency-rule (both shells track the shared core) |
| c3-310 | component | sw.ts DEFAULTS theme value | No rule delta |
| c3-312 | component | options.ts stamps data-ad-theme | No rule delta |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | The reskin must keep native open-shadow custom elements styled by a single Constructable Stylesheet, CSP-safe, surviving all: initial | comply |
| ref-wire-protocol-validation | The persisted+wired theme value changes its allowed set; the zod schema must remain the one authority both realms validate against | comply |
| ref-core-dependency-rule | Token + mark changes live in the portable core (packages/app) and both shells consume them identically; no platform code may fork the look | comply |
| ref-kv-storage-prefixes | Theme stays inside the existing settings record under the established KV prefix — no new storage key is introduced | comply |
| ref-dependency-injection | Cited by the service-worker roots (c3-210/c3-310) this ADR touches | N.A - only static DEFAULTS theme values change; no unit reaches for a new global or side effect |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-sanitize-model-output | The card/side-panel still render model markdown; the reskin must not introduce any new innerHTML/SafeHtml cast on the model-output path | comply |
| rule-api-key-isolation | settings-form + onboarding handle the API key; the neutral-restyle must not change how the key field is gated or transmitted | comply |
| rule-gate-runtime-messages | Reusing settings.theme (not a new broadcast message) means no new inbound message type is added that would need gating | comply |
| rule-typed-errors | Cited by c3-101/c3-210/c3-310 which this ADR touches | N.A - no error-handling path changes; only the Theme union and DEFAULTS values change |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Tokens | Rewrite packages/app/src/ui/styles/tokens.ts: ADP_PRIMITIVES, SEPIA_VARS, theme CSS for [data-ad-theme], BRAND_MARK_SVG (Rule + accent) | New file content + adoptedStyleSheets.length===1 test still green |
| Types | domain/types.ts Theme union; wire.ts zod enum; legacy-light→sepia coercion helper | bun run typecheck; wire-schema test |
| Defaults | chrome+safari sw.ts, options.ts, *-storage-store.ts seed 'sepia'; coerce on read | storage-store tests updated + green |
| Stamp | Rename setAttribute('theme', …)→setAttribute('data-ad-theme', …) in content.ts, side-panel.ts, options.ts (both shells) + both floating-trigger adapters + inline-bottom-sheet-renderer + settings-form live preview | floating-trigger test asserts data-ad-theme |
| Reskin | lookup-card, lookup-trigger, bottom-sheet, side-panel-view, onboarding-view → Paperlight tokens + mark | Component tests + browser screenshots both themes |
| Settings neutral | settings-form.ts dropped to neutral browser-chrome + Theme control (4 options) | settings-form test + screenshot |
| Icons | Regenerate extension-chrome/src/icons/* + icon.svg from the new mark | Built dist/ manifest icons render |
| Tests/e2e | Update unit tests + e2e/theme.spec.ts + helpers to new attribute/values/markup | bun run test + targeted e2e green |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| C3 CLI / validators / schema / hints / templates | N.A - this ADR changes product code and static assets only; no C3 CLI binary, validator, schema row, hint, or template is modified | c3 check passes unchanged before and after; only entity bodies (component docs) are updated via c3 write, not the underlay |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| packages/app/src/wire.ts zod theme enum | Rejects any theme value outside sepia/dark/contrast/system at the realm boundary | wire-schema.test.ts + wire-schema.snapshot.json |
| adoptedStyleSheets.length === 1 regression test | Fails if any component stops folding tokens into its single sheet | existing ui test (kept green) |
| bun run typecheck | Fails if any Theme consumer still references 'light' | CI typecheck |
| e2e/theme.spec.ts | Drives the real extension and asserts the themed surfaces render per stored setting | Playwright run |
| chrome-floating-trigger.test.ts / storage-store tests | Assert the default theme value and data-ad-theme stamp | bun run test |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add a parallel chrome.storage.local['ad:theme'] key + ad:theme-changed broadcast (literal hand-off §1.3) | Duplicates the existing settings.theme source of truth, splits persistence, requires a new gated inbound message (rule-gate-runtime-messages), and contradicts the hand-off's own "keep IA/behavior exactly" constraint |
| Keep the Settings/options form fully branded in Paperlight | User chose hand-off §5.8 — a config surface reads best as neutral native browser-chrome; only the Theme control is themed |
| Ship tokens to :root instead of :host (as the hand-off CSS literally shows) | Every surface here is a shadow-DOM custom element; :root props would not survive all: initial on the trigger/card hosts — tokens must live on :host (ref-web-components-shadow-dom) |
| Keep theme attribute name, only swap values | The whole token system keys themes off [data-ad-theme]; reusing the generic theme attr risks collision with host-page attributes and diverges from the documented token contract |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A stored legacy 'light' theme becomes invalid and breaks settings load | Coerce 'light'→'sepia' on read in both storage-stores; wire enum still parses because coercion happens before validation | storage-store test feeding a legacy 'light' record returns 'sepia' |
| A component stops folding tokens into its one adopted sheet (CSP / isolation regression) | Keep the selector-less-string + single-sheet pattern; do not add <style> tags | adoptedStyleSheets.length===1 test green |
| Color-only language distinction sneaks in during reskin (No-Color-Only Rule) | English/translation told apart by order+label+weight, never hue; verify in both themes | Browser screenshot review both themes |
| Contrast drops below AA on a themed surface | Use the hand-off's tuned OKLCH values verbatim; spot-check in-browser per theme | a11y checklist §6 reviewed in Sepia + Dark |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | No type errors; no remaining 'light' Theme references |
| bun run lint | Clean |
| bun run test | All unit tests green (updated expectations) |
| bun run build (chrome) | dist builds; manifest references regenerated icons |
| e2e/theme.spec.ts (+ smoke of card/trigger/options) | Green against the built extension |
| Browser screenshots Sepia + Dark of trigger, card, side panel, onboarding, neutral settings | Captured and attached to the PR as before/after evidence |
| c3 check | Passes; ADR Parent Delta recorded for c3-117 + touched components |
