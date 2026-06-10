---
id: adr-20260610-theme-setting
c3-seal: 97c28baacf3f75657313f943b58583fd67d2842d2478e4fc242400049c8d055a
title: theme-setting
type: adr
goal: 'Add a user-controlled colour theme setting to ai-dict: a `theme` field (`''light'' | ''dark'' | ''system''`) on `PublicSettings`, surfaced as a select in the options-page settings form, applied to every shipped UI surface (settings form, onboarding view, in-page lookup trigger + lookup card, Chrome side panel) via a `theme` host attribute, with **light** as the default. Today the UI follows the OS (`prefers-color-scheme`) with no user control; after this change the OS is only followed when the user explicitly picks `system`.'
status: implemented
date: "2026-06-10"
---

## Goal

Add a user-controlled colour theme setting to ai-dict: a `theme` field (`'light' | 'dark' | 'system'`) on `PublicSettings`, surfaced as a select in the options-page settings form, applied to every shipped UI surface (settings form, onboarding view, in-page lookup trigger + lookup card, Chrome side panel) via a `theme` host attribute, with **light** as the default. Today the UI follows the OS (`prefers-color-scheme`) with no user control; after this change the OS is only followed when the user explicitly picks `system`.

## Context

All five themed web components (`lookup-trigger`, `lookup-card`, `settings-form`, `onboarding-view`, `side-panel-view` in `packages/app/src/ui/`) fold `LIGHT_VARS` into `:host` and re-apply `DARK_VARS` inside `@media (prefers-color-scheme: dark)` (tokens in `packages/app/src/ui/styles/tokens.ts`). There is no stored preference, no UI control, and no way to pin light or dark. The user wants a manual switch with light as default. Constraints: each component keeps exactly one adopted stylesheet (a regression test pins `adoptedStyleSheets.length === 1`); the in-page card class lives in the page MAIN world while the content script runs in the isolated world, so only shared-DOM mutations (attributes) cross the boundary — JS property writes do not (Chromium 390807); content scripts must never read `chrome.storage` settings directly because the stored blob contains the secret API key (rule-api-key-isolation) — they get `PublicSettings` over the validated wire (`settings.get`); the wire `PublicSettingsSchema` is `z.strictObject`, so a new field must be added to the schema or replies fail validation. Affected topology: c3-1/app (domain types, wire, ui-components, content adapters), c3-2/extension-chrome and c3-3/extension-safari (storage stores, options pages, composition roots, side panel).

## Decision

Model theme as part of `PublicSettings` (`theme: 'light' | 'dark' | 'system'`, default `'light'`) — it is non-secret reader preference data that the content script legitimately needs, and `settings.get` over the wire is the already-governed channel for exactly that. Theming is applied as a `theme` attribute on each component host: component CSS becomes `:host { LIGHT_VARS }` (light is the no-attribute default), `:host([theme="dark"]) { DARK_VARS }`, and `@media (prefers-color-scheme: dark) { :host([theme="system"]) { DARK_VARS } }` — a shared `THEME_DARK_CSS` block exported from tokens.ts keeps this in one place. The four component-specific dark overrides (all the same `color-mix` primary-button surface) collapse into a new `--ad-cta` token defined in both var sets, so no per-component dark block remains. Attribute (not JS property) is chosen because it crosses the MAIN/isolated world boundary for the in-page card and survives the trigger's `all: initial`. Composition roots stamp the attribute: options pages set it on mount and after save from stored settings; `content.ts` fetches `settings.get` once at startup and hands the value to the floating-trigger adapter and inline renderer (theme changes reach in-page UI on next page load — same freshness as targetLang); the Chrome side panel sets it during its existing `settings.get` probe. Defaulting stored-settings reads with `?? 'light'` migrates existing users without a storage migration.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-101 | component | PublicSettings gains theme; new Theme union type | rule-domain-purity — types stay dependency-free |
| c3-103 | component | PublicSettingsSchema gains theme enum; drift guard re-checks | ref-wire-protocol-validation — strictObject + compile-time drift guard |
| c3-117 | component | tokens.ts gains --ad-cta + THEME_DARK_CSS; all five themed components switch to attribute-driven dark; settings-form gains Appearance select | ref-web-components-shadow-dom — single adopted sheet per root preserved |
| c3-115 | component | InlineBottomSheetRenderer gains a theme field stamped as an attribute on the card it creates | ref-dependency-injection — theme injected by composition root, no storage access |
| c3-201 | component | ChromeStorageStore defaults/returns theme; ChromeFloatingTrigger stamps attribute | rule-api-key-isolation — get() keeps stripping apiKey |
| c3-210 | component | readFullSettings fallback object gains theme | rule-gate-runtime-messages — unchanged gating |
| c3-211 | component | startup settings.get to seed trigger/renderer theme | rule-api-key-isolation — wire relay only, never chrome.storage |
| c3-212 | component | options.ts DEFAULTS + attribute stamping on mount/save; side-panel.ts stamps view attribute | ref-dependency-injection — composition-root wiring |
| c3-301 | component | SafariStorageStore + SafariFloatingTrigger mirror the Chrome changes | rule-api-key-isolation — same stripping contract |
| c3-310 | component | settings fallback gains theme | rule-gate-runtime-messages — unchanged gating |
| c3-311 | component | startup settings.get to seed trigger/renderer theme | rule-api-key-isolation — wire relay only |
| c3-312 | component | DEFAULTS + attribute stamping mirror Chrome options | ref-dependency-injection — composition-root wiring |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-wire-protocol-validation | theme crosses the wire inside the settings reply; strictObject means schema and domain type must move together | comply |
| ref-web-components-shadow-dom | New CSS blocks must stay inside each component's single adopted stylesheet; attribute theming must survive host-page CSS and all:initial | comply |
| ref-dependency-injection | Theme reaches in-page adapters via composition-root injection, never via direct platform reads inside the core | comply |
| ref-core-dependency-rule | Domain/ui changes stay platform-free; only shells touch chrome/safari APIs | comply |
| ref-kv-storage-prefixes | Theme lives inside the existing settings blob, not a new KV prefix | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | The settings blob holds the secret key; content scripts must learn theme via settings.get wire reply (PublicSettings strips the key), never chrome.storage | comply |
| rule-domain-purity | New Theme type lives in domain/types.ts with zero imports added | comply |
| rule-gate-runtime-messages | No new message types; settings.get stays gated by classifyInbound | comply |
| rule-sanitize-model-output | Theme is a closed enum from a select, never model output; no new HTML sinks | review |
| rule-typed-errors | No new failure paths; settings reads keep defaulting on absence | review |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| domain | types.ts: add Theme union + theme on PublicSettings | tsc drift guard in wire.ts forces matching schema |
| wire | wire.ts: PublicSettingsSchema += theme: z.enum([...]) | wire tests: settings reply with/without theme |
| tokens | tokens.ts: add --ad-cta to both var sets; export THEME_DARK_CSS | component CSS contains [theme="dark"] blocks |
| ui components | lookup-trigger.ts, lookup-card.ts, settings-form.ts, onboarding-view.ts, side-panel-view.ts: replace per-component media blocks with THEME_DARK_CSS; use --ad-cta | grep: no @media (prefers-color-scheme outside tokens.ts |
| settings form | Appearance section with #theme select; SettingsFormValue.theme; collect/value roundtrip | settings-form tests |
| chrome shell | chrome-storage-store.ts, sw.ts, options.ts, content.ts, side-panel.ts, chrome-floating-trigger.ts | store tests + manual screenshots |
| safari shell | safari-storage-store.ts, sw.ts, options.ts, content.ts, safari-floating-trigger.ts | store tests mirror Chrome |
| content adapter | inline-bottom-sheet-renderer.ts: theme field stamped on created card | renderer test asserts attribute |
| C3 docs | update c3-117/c3-101/c3-103 component docs for the new token + field | c3 check passes |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema surface changes | N.A - this ADR changes product code and component docs only | N.A - c3 check output is the only gate |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| wire.ts compile-time drift guard | AssertEqual<z.infer<PublicSettingsSchema>, PublicSettings> fails the build if schema and type diverge | pnpm typecheck / build |
| vitest suites | store defaults (theme: 'light'), form roundtrip, wire schema accept/reject, renderer attribute stamping | pnpm test |
| strictObject wire validation | a reply missing/garbling theme fails WireReplySchema at runtime | existing classifyInbound/router tests |
| adoptedStyleSheets pin test | single-sheet contract survives the new CSS blocks | existing regression test |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Store theme outside settings (own KV key, e.g. ui:theme) | Content scripts may not read chrome.storage (key isolation) so it would still need a wire message; settings.get already carries reader preferences like targetLang — a second channel duplicates governance for no gain |
| JS property (card.theme = …) instead of host attribute | Property writes do not cross the MAIN/isolated world boundary for the in-page card (Chromium 390807, documented in inline-bottom-sheet-renderer.ts) — the card would never receive it |
| Keep system as default | The request is explicit: light is the default. system remains available to restore today's behavior |
| Per-component second stylesheet for theme overrides | Violates the pinned adoptedStyleSheets.length === 1 contract that ref-web-components-shadow-dom documents |
| Live theme push to open tabs (storage.onChanged broadcast) | onChanged on the settings key would deliver the apiKey into content-script scope (S1 violation); a dedicated broadcast message is scope creep for a preference that, like targetLang, applies on next page load |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Existing users on dark OS see the UI flip to light after update | Intentional product decision (light default); system restores old behavior and is one select away | Before/after screenshots in PR state the behavior change |
| :host([theme="system"]) media block regresses pages that never set the attribute | Light is the no-attribute default by design; every composition root stamps the attribute on mount | Component tests assert default-light + attribute-driven dark CSS present |
| Wire strictObject rejects replies from a stale SW serving an old PublicSettings shape during update overlap | Store-level ?? 'light' default means new SW code always emits theme; extension SW and content script ship atomically in one extension version | wire tests; manual smoke after build |
| Safari shell drifts from Chrome | Mirror changes land in the same PR with mirrored tests | pnpm test covers both adapter suites |

## Verification

| Check | Result |
| --- | --- |
| bun run test (workspace vitest incl. new theme tests) | PASS — 33 files, 294 tests |
| bun run typecheck (drift guard compiles across all 3 packages) | PASS — exit 0 in app, extension-chrome, extension-safari |
| bun run lint + bun run format:check | PASS |
| grep -rn "prefers-color-scheme" packages/*/src outside tokens.ts | PASS — only a doc comment in domain/types.ts and the reduced-motion query remain |
| c3 check after doc updates (c3-101, c3-117 Contract sections) | PASS — 39 entities, no issues |
| bunx playwright test (full Chrome e2e, bundled Chromium, real extension) | PASS — 42 tests incl. new theme-setting.spec.ts: light default on dark OS, dark after save, system follows OS, attribute reaches bubble + card |
| Manual evidence screenshots for PR (before: OS-forced dark, no control; after: light default, Appearance select, dark card) | CAPTURED — e2e-evidence/theme/ and e2e-evidence/theme-before/ |
