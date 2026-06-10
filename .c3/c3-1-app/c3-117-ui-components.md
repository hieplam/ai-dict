---
id: c3-117
c3-seal: 70955b5d4002349658b5bec6591fb259290576268252d19d7bed218b9ca120bb
title: ui-components
type: component
category: feature
parent: c3-1
goal: Provide the complete set of framework-free custom elements and their supporting utilities that render the extension's in-page and options-page UI.
uses:
    - ref-web-components-shadow-dom
    - rule-api-key-isolation
    - rule-sanitize-model-output
---

## Goal

Provide the complete set of framework-free custom elements and their supporting utilities that render the extension's in-page and options-page UI.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | content script + extension page |
| Public surface | LookupCard, LookupTrigger, BottomSheet, SettingsForm, SafeHtml, CardState, SettingsFormValue, ENV_KEY_NOTICE, ICON_SETTINGS, renderCardState, registerContentElements, registerSettingsForm, adoptStyles |
| Registration | registerContentElements() defines lookup-trigger, lookup-card, bottom-sheet; registerSettingsForm() defines settings-form; both guards use customElements.get() for idempotency |
| Styling mechanism | Constructable stylesheets via adoptStyles(root, css) — one CSSStyleSheet per shadow root, applied via root.adoptedStyleSheets |
| Depends on | c3-116 markdown-sanitize (produces SafeHtml consumed by LookupCard and renderCardState) |

## Purpose

This component owns all user-visible elements used by the ai-dict extension. It exposes four custom elements: `<lookup-trigger>` renders a floating "Define" button in open shadow DOM with `z-index: 2147483647` (pinned explicitly because `all: initial` resets z-index to `auto`, causing the trigger to be occluded by page stacking contexts); `<lookup-card>` renders dictionary results in three states (loading, result, error) with content placed in the element's **light DOM** projected through a `<slot>` so that the content-script renderer can drive it across the Chrome MV3 isolated-world boundary (Chromium 390807); `<bottom-sheet>` provides an accessible modal overlay with ARIA `role="dialog"`, focus trapping (Tab / Shift+Tab), Escape dismiss, scrim-click dismiss, reduced-motion support, and focus restoration on disconnect; `<settings-form>` renders the full options form in a trusted extension page only, collecting API key, target language, prompt template, and cache/history toggles, and supporting an env-key lock mode when `GEMINI_API_KEY` is baked into the build. The `SafeHtml` branded type is exported from this component and is the type contract that forces all rendering code to obtain sanitized HTML through c3-116. This component does NOT perform any sanitization itself, does NOT communicate with the service worker, and does NOT own any business logic.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition — registration | registerContentElements() or registerSettingsForm() must be called before any custom element is created; guards prevent double-definition; see packages/app/src/ui/register.ts | ref-web-components-shadow-dom |
| Precondition — SafeHtml | LookupCard.state setter and renderCardState for the 'result' branch accept only SafeHtml (branded type); callers must obtain it from sanitizeMarkdown in c3-116; type defined in packages/app/src/ui/lookup-card.ts | c3-116 |
| Shadow DOM construction | All four elements use { mode: 'open' } shadow roots; LookupCard and BottomSheet defer construction to connectedCallback with a guard (if (this.shadowRoot) return) to survive reconnection; LookupTrigger constructs in the constructor; SettingsForm uses the same guard; see packages/app/src/ui/lookup-card.ts, packages/app/src/ui/bottom-sheet.ts, packages/app/src/ui/settings-form.ts | ref-web-components-shadow-dom |
| Shared styling utility | adoptStyles(root: ShadowRoot, css: string) creates a CSSStyleSheet, calls replaceSync(css), and sets root.adoptedStyleSheets; used by all four elements; see packages/app/src/ui/styles/adopt.ts | ref-web-components-shadow-dom |
| Hardened slotted setup CSS | The setup-invite ::slotted rules (.holly, .setup-title, .setup-text, .setup-cta) are declared !important: slotted nodes live in the host page's light DOM, where the outer tree's NORMAL declarations beat the shadow's normal ::slotted() ones (CSS Scoping tree-context order), so a host reset like button{margin:0} stripped the centering; inner-tree IMPORTANT declarations win that tiebreak regardless of outer specificity; see packages/app/src/ui/lookup-card.ts | ref-web-components-shadow-dom |
| Cross-world rendering path | renderCardState(state: CardState): Node[] is exported so that content-script code running in the isolated world can call it and write the returned nodes directly into the card's light DOM via replaceChildren, bypassing the .state JS setter which is unreachable across the world boundary; see packages/app/src/ui/lookup-card.ts | c3-115 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Trigger activation | User clicks the "Define" button inside <lookup-trigger>; the element dispatches CustomEvent('lookup-click', { bubbles: true, composed: true }) which crosses the shadow boundary to the composition root; see packages/app/src/ui/lookup-trigger.ts | ref-web-components-shadow-dom |
| Result display | InlineBottomSheetRenderer calls renderCardState({ kind: 'result', safeHtml, word, target }) and passes the returned nodes to card.replaceChildren(...); the <slot> in the card's shadow projects them into the visible region; see packages/app/src/ui/lookup-card.ts | c3-115 |
| Sheet dismissal | <bottom-sheet> emits CustomEvent('dismiss', { bubbles: true, composed: true }) on Escape keydown or scrim click; the renderer's registered listener calls close() which removes the sheet from the host; see packages/app/src/ui/bottom-sheet.ts | ref-web-components-shadow-dom |
| Settings action | The lookup-card header gear (left of Close) and the side-panel-view header gear dispatch CustomEvent('open-settings', { bubbles: true, composed: true }) — the same frozen event name as the setup CTA; content-script shells relay it as the validated open-options wire message, trusted pages call openOptionsPage directly; see packages/app/src/ui/lookup-card.ts — actionButton and packages/app/src/ui/side-panel-view.ts | ref-web-components-shadow-dom |
| Recent-entry delete | Each Recent row in <side-panel-view> pairs the select button with a sibling .recent-del icon button (a button must not nest a button) that dispatches CustomEvent('delete', { detail: { id }, bubbles: true, composed: true }); the trusted side-panel page relays it as the history.delete wire message so the SW removes the stored entry and its cached definition; see packages/app/src/ui/side-panel-view.ts — recentRow() | ref-web-components-shadow-dom |
| Settings save | <settings-form> intercepts form submit, collects SettingsFormValue via collect(), and emits CustomEvent<SettingsFormValue>('save', { detail, bubbles: true, composed: true }); the options-page composition root persists the value via the SettingsStore port; see packages/app/src/ui/settings-form.ts | rule-api-key-isolation |
| Env-key lock | When keyFromEnv = true, the API key <input> is set to readOnly, #reveal is hidden, and on focus the field shows ENV_KEY_NOTICE; collect() echoes back the stored key so locking never wipes it; see packages/app/src/ui/settings-form.ts — applyKeyLock() | rule-api-key-isolation |
| Failure — missing element in shadow | SettingsForm.q<T>(sel) throws 'settings-form: missing <sel>' if an expected shadow child is absent, preventing silent no-ops on a broken DOM; see packages/app/src/ui/settings-form.ts — private q<T>() | ref-web-components-shadow-dom |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-web-components-shadow-dom | ref | All four elements use open shadow DOM with constructable stylesheets; renderCardState bridges the MV3 world boundary via light DOM | primary | The shadow-root guard pattern (if (this.shadowRoot) return) is the idempotency contract |
| rule-sanitize-model-output | rule | LookupCard and renderCardState accept only SafeHtml for the 'result' state; body.innerHTML = state.safeHtml is guarded by the type brand | primary | Comment in source: "trusted: sanitized upstream by adapters-shared (S4)" |
| rule-api-key-isolation | rule | <settings-form> is registered separately (registerSettingsForm) and used only in the trusted options/extension page; it is never mounted in the content-script world | primary | registerSettingsForm() is called by c3-212 (chrome-ui-pages) and c3-312 (safari-options-page), not by the content-script composition root |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| SafeHtml (branded type) | OUT | string & { readonly __brand: 'SafeHtml' }; the brand prevents raw strings being passed where sanitized HTML is required | Defined here; the only legitimate producer is sanitizeMarkdown in c3-116 | packages/app/src/ui/lookup-card.ts — export type SafeHtml |
| renderCardState(state: CardState): Node[] | OUT | Pure function; returns light-DOM nodes for the given CardState; the 'result' branch writes state.safeHtml into body.innerHTML | No side effects; designed for cross-world invocation from the content-script isolated world | packages/app/src/ui/lookup-card.ts — export function renderCardState |
| registerContentElements(): void | OUT | Idempotently defines lookup-trigger, lookup-card, bottom-sheet in the custom-element registry | Called once at content-script startup; safe to call multiple times | packages/app/src/ui/register.ts — export function registerContentElements |
| registerSettingsForm(): void | OUT | Idempotently defines settings-form in the custom-element registry | Called only from trusted extension-page contexts | packages/app/src/ui/register.ts — export function registerSettingsForm |
| open-settings (composed CustomEvent) | OUT | Dispatched by the header Settings gear in lookup-card and side-panel-view, and by the setup CTA (settingsCta); bubbles + composed so it crosses shadow roots to the composition roots, which own the platform openOptionsPage call | The UI layer never touches chrome./browser. itself; frozen cross-bundle event name | packages/app/src/ui/lookup-card.ts — actionButton, settingsCta; packages/app/src/ui/side-panel-view.ts |
| SettingsForm.value setter | IN | Accepts SettingsFormValue (incl. theme); if the shadow root is not yet built, defers hydration to connectedCallback via _pendingValue | Only meaningful in an extension-page context; never called from the content script | packages/app/src/ui/settings-form.ts — set value(v: SettingsFormValue) |
| SettingsForm.keyFromEnv setter | IN | When true, locks the API key field to read-only and hides the reveal button | Prevents users from accidentally overwriting a build-time key | packages/app/src/ui/settings-form.ts — set keyFromEnv(on: boolean) |
| theme host attribute | IN | Every themed element (lookup-trigger, lookup-card, settings-form, onboarding-view, side-panel-view) is light by default; theme="dark" applies DARK_VARS unconditionally and theme="system" applies them only under prefers-color-scheme: dark (THEME_DARK_CSS in tokens.ts) | Stamped by composition roots from stored settings; an ATTRIBUTE (not a JS property) so it crosses the MV3 MAIN/isolated world boundary and survives the trigger's all:initial | packages/app/test/ui/lookup-trigger.test.ts — theme contract test |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Cross-world rendering regression | Switching renderCardState from returning light-DOM nodes to writing into shadow | Test 'renders content written straight to light DOM' and renderer tests fail | bun run --filter @ai-dict/app test packages/app/test/ui/lookup-card.test.ts |
| z-index occlusion regression on trigger | Removing or lowering :host { z-index: 2147483647 } from LookupTrigger CSS | Test ':host pins a high z-index' fails | bun run --filter @ai-dict/app test packages/app/test/ui/lookup-trigger.test.ts |
| Setup-invite centering regression on reset pages | Removing !important from the .setup-*/.holly slotted rules | Unit test 'setup-invite slotted rules are !important…' fails; e2e settings-nav.spec centering assertion fails on the hostile-reset fixture | bun run --filter @ai-dict/app test packages/app/test/ui/lookup-card.test.ts; bun run e2e:chrome |
| Settings-action contract break | Renaming the open-settings event or dropping the gear from either header | lookup-card and side-panel-view gear tests fail; e2e settings-nav.spec options-page assertions fail | bun run --filter @ai-dict/app test |
| SafeHtml brand bypass | Accepting string instead of SafeHtml in renderCardState result branch | TypeScript type error; downstream callers would no longer be forced through the sanitizer | bun run --filter @ai-dict/app typecheck |
| Settings-form in content-script | Calling registerSettingsForm() from the content-script entry point | Rule isolation violated; settings-form must only be registered in extension-page contexts | bun run --filter @ai-dict/app test packages/app/test/ui/settings-form.test.ts |
| Accessibility regression | Removing ARIA attributes, focus-trap logic, or composed: true from events | axe violations tests and composed-event boundary tests fail | bun run --filter @ai-dict/app test packages/app/test/ui/bottom-sheet.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit test suite — lookup-card | Contract | Tests cast literal strings as SafeHtml for fixtures only; production code must use sanitizeMarkdown | packages/app/test/ui/lookup-card.test.ts |
| Unit test suite — lookup-trigger | Contract | Tests inspect adoptedStyleSheets CSS rules directly to pin regression guards | packages/app/test/ui/lookup-trigger.test.ts |
| Unit test suite — bottom-sheet | Contract | Tests include axe accessibility assertions and composed-event boundary checks | packages/app/test/ui/bottom-sheet.test.ts |
| Unit test suite — settings-form | Contract | Tests cover the env-key lock path and deferred-hydration (_pendingValue) path | packages/app/test/ui/settings-form.test.ts |
| InlineBottomSheetRenderer (c3-115) | Contract | Renderer creates elements via document.createElement; it does not import the class constructors directly | packages/app/src/app/inline-bottom-sheet-renderer.ts |
