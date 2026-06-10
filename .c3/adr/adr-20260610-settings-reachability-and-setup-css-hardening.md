---
id: adr-20260610-settings-reachability-and-setup-css-hardening
c3-seal: 59f26308e2bfc46c2824c59e5ac8a26276fd95b3d851449882f6066d1d6d19ea
title: settings-reachability-and-setup-css-hardening
type: adr
goal: 'Make the extension''s settings reachable and its setup invite render correctly on any host page. Two concrete deltas: (1) the no-key / invalid-key "Open Settings" setup invite inside `<lookup-card>` must stay visually centered on every host page, including pages whose CSS resets (`button{margin:0;padding:0;...}`, `p{margin:0}`) currently strip the slotted layout styles and push the CTA to the left edge; (2) the reader gets an always-available, discoverable path to the options page — a Settings gear action in the lookup-card header bar and in the side-panel header — replacing today''s only post-setup path (browser extension menu → Options). The Safari shell additionally gets the missing `open-settings` → `open-options` plumbing so the same buttons work there instead of being dead controls.'
status: implemented
date: "2026-06-10"
---

## Goal

Make the extension's settings reachable and its setup invite render correctly on any host page. Two concrete deltas: (1) the no-key / invalid-key "Open Settings" setup invite inside `<lookup-card>` must stay visually centered on every host page, including pages whose CSS resets (`button{margin:0;padding:0;...}`, `p{margin:0}`) currently strip the slotted layout styles and push the CTA to the left edge; (2) the reader gets an always-available, discoverable path to the options page — a Settings gear action in the lookup-card header bar and in the side-panel header — replacing today's only post-setup path (browser extension menu → Options). The Safari shell additionally gets the missing `open-settings` → `open-options` plumbing so the same buttons work there instead of being dead controls.

## Context

The setup invite (`renderSetupInvite` in `packages/app/src/ui/lookup-card.ts`) returns light-DOM nodes styled from the card's shadow stylesheet via `::slotted(.holly|.setup-title|.setup-text|.setup-cta)`. Per CSS Scoping cascade order, *normal* declarations from the outer tree (the host page) defeat *normal* `::slotted()` declarations from the inner shadow tree. Any page shipping a common reset (normalize.css `button{margin:0}`, Reboot, `p{margin:0}`) therefore strips `margin:15px auto 6px` from the CTA and the button lands flush left (user evidence: e1.png). This violates ref-web-components-shadow-dom's stated goal that the in-page UI "survive arbitrary host-page CSS". The repo's e2e fixture page has no CSS reset, which is why the bug never showed in e2e evidence.

For navigation: after initial setup, settings are reachable only via the browser's extension menu → Options. The in-page card header (`.bar .actions`) has a single Close button; the side-panel header has none. The full plumbing for opening options from untrusted contexts already exists and is validated: composed `open-settings` DOM event → Chrome content script's document listener → payload-free `open-options` wire message (already in `WireMessageSchema`) → router's injected `openOptions` dep → `chrome.runtime.openOptionsPage()`. The side panel (trusted page) listens for `open-settings` on the view and calls `openOptionsPage()` directly. The Safari shell however wires neither: `packages/extension-safari/src/content.ts` has no `open-settings` listener and its `buildRouter` call passes no `openOptions`, so Safari's existing setup-invite CTA is already a silent no-op (pre-existing bug this ADR fixes in passing).

Affected topology: c3-117 (ui-components: lookup-card, side-panel-view), c3-311 (safari-content-script), c3-310 (safari-service-worker). Chrome shell components need no code change (listener and router dep already present).

## Decision

Two-part change, no new architecture:

1. **CSS hardening, scoped to the setup invite.** In `lookup-card.ts`, mark every declaration of the four setup-invite `::slotted()` rules (`.holly`, `.setup-title`, `.setup-text`, `.setup-cta`) `!important`. CSS Scoping resolves *important* declarations in favor of the **inner** (shadow) tree, so the card wins against any outer-page author CSS — reset or not — regardless of specificity. This is the only mechanism that (a) keeps styles in the constructable stylesheet (CSP-safe, themable via the same `--ad-*` custom properties), and (b) keeps the invite nodes top-level slotted children, which is required because `::slotted()` cannot reach a wrapper's descendants and the MV3 isolated world cannot reach shadow internals (Chromium 390807). Scope is strictly the `.setup-*`/`.holly` slotted rules — result-content rules (`h2`, `.err`, definition body) intentionally keep blending with this page-CSS exposure unchanged (separate concern, not regressed here).
2. **Settings gear, reusing the existing `open-settings` event end-to-end.** `LookupCard.actionButton` is generalized to also build a `settings` action (gear icon, `aria-label="Settings"`) that dispatches the **existing** composed, bubbling `open-settings` CustomEvent — the exact event the shells already handle for the setup CTA, so the Chrome shell needs zero changes. `SidePanelView` gets the same gear in its header dispatching the same event, caught by the existing `view.addEventListener('open-settings', …)` in `side-panel.ts`. The Safari shell gets the two missing pieces that mirror Chrome verbatim: a document-level `open-settings` listener in `content.ts` sending `{type:'open-options'}` and an `openOptions: () => browser.runtime.openOptionsPage()` dep in `sw.ts`'s `buildRouter`. No wire-schema change: `open-options` is already a validated, payload-free member of `WireMessageSchema`.

This wins because it is purely additive along proven seams: the UI layer stays platform-free (dispatches DOM events only — ref-core-dependency-rule), platform calls stay in composition roots (ref-dependency-injection), and the message surface does not grow (rule-gate-runtime-messages keeps gating the same set).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | lookup-card.ts: .setup-* slotted rules hardened with !important; header grows a settings gear action; side-panel-view.ts: header grows the same gear; both dispatch the existing composed open-settings event | ref-web-components-shadow-dom (survive-host-CSS goal; constructable stylesheets only); rule-sanitize-model-output (no new HTML sinks); component doc Contract/Business Flow rows updated |
| c3-311 | component | gains the document-level open-settings listener that relays {type:'open-options'} over the wire (mirrors the c3-211 Chrome content script) | ref-core-dependency-rule + ref-dependency-injection (platform call stays in shell); ref-wire-protocol-validation (sends an already-schema'd message) |
| c3-310 | component | buildRouter gains openOptions: () => browser.runtime.openOptionsPage() so the routed open-options message acts instead of no-oping | rule-gate-runtime-messages (message still passes classifyInbound; no gate change); ref-dependency-injection (dep injected at composition root) |
| N.A - <c3-211 chrome-content-script: no code change — its document listener for open-settings already exists and now also serves the gear> | N.A - <reason: unchanged> | N.A - <reason: unchanged> | N.A - <reason: unchanged> |
| N.A - <containers c3-1 and c3-3: no goal/boundary/membership change; component-internal deltas only — Parent Delta: none> | N.A - <reason: parent contracts unchanged> | N.A - <reason: parent contracts unchanged> | N.A - <reason: parent contracts unchanged> |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | Governs all four elements; the bug is a direct violation of its "survive arbitrary host-page CSS" goal; fix must stay inside constructable stylesheets + open shadow DOM (CSP S5) | comply |
| ref-wire-protocol-validation | Safari content script starts sending open-options; must be an existing validated WireMessageSchema member, not an ad-hoc shape | comply (no schema change) |
| ref-dependency-injection | openOptions is a router dep injected by the composition root; Safari sw must inject it the same way Chrome does, never import platform APIs into the core | comply |
| ref-core-dependency-rule | The gear lives in packages/app UI and must not touch chrome./browser.; it only dispatches a composed DOM event the shells interpret | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-gate-runtime-messages | Safari sw routes the (existing) open-options type; inbound classification via classifyInbound must remain the single gate — no listener bypass | comply |
| rule-sanitize-model-output | Gear icon is a static, hand-authored SVG injected via innerHTML in shadow DOM; no model-influenced content flows through it; SafeHtml contract untouched | comply (review: no new sink) |
| rule-api-key-isolation | Opening the options page must not move the key; open-options stays payload-free and replies nothing | comply |
| rule-domain-purity | No new imports into domain/; change is UI + shells only | comply |
| N.A - <rule-typed-errors: no new error path — openOptions failure follows the router's existing catch → typed error mapping, unchanged> | N.A - <reason: unchanged error surface> | N.A - <reason: unchanged error surface> |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| packages/app/src/ui/lookup-card.ts | !important on all declarations of ::slotted(.holly/.setup-title/.setup-text/.setup-cta) rules; add ICON_GEAR; generalize actionButton to ('settings' | 'close') with the settings action dispatching open-settings; append gear before Close in .actions |
| packages/app/src/ui/side-panel-view.ts | header gains the same gear button dispatching composed open-settings; button styled with existing token palette | diff + unit tests |
| packages/app/test/ui/lookup-card.test.ts | pin regression guards: setup-invite slotted rules carry !important on centering declarations; header settings button exists and clicking it emits composed open-settings | test run |
| packages/app/test/ui/side-panel-view.test.ts | gear emits composed open-settings from the panel header | test run |
| packages/extension-safari/src/content.ts | add document.addEventListener('open-settings', () => void browser.runtime.sendMessage({type:'open-options'})) mirroring Chrome | diff |
| packages/extension-safari/src/sw.ts | add openOptions: () => browser.runtime.openOptionsPage() to buildRouter deps | diff |
| packages/extension-chrome/e2e (fixture + evidence) | add a reset-CSS fixture page (normalize-style button/p resets) and evidence captures of the no-key card on it + gear in card/panel headers | e2e-evidence/*.png used as PR Before/After |
| C3 docs | c3-117: Contract row for the gear action + hardened-slotted-CSS note; c3-311/c3-310: open-settings plumbing rows; Parent Delta: none (containers unchanged) | c3 check green |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - <no C3 CLI, validator, schema, template, or help surface is touched; this ADR changes product code + entity docs only> | N.A - <reason: not an underlay change> | N.A - <reason: not an underlay change> |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| packages/app/test/ui/lookup-card.test.ts | fails if setup-invite slotted rules lose !important centering declarations, if the gear disappears from the header, or if its click stops emitting composed open-settings | bun run --filter @ai-dict/app test |
| packages/app/test/ui/side-panel-view.test.ts | fails if the panel header gear stops emitting open-settings | bun run --filter @ai-dict/app test |
| Wire schema + classifyInbound (existing) | rejects any malformed open-options message; compile-time AssertEqual keeps wire/domain in sync | bun run typecheck; packages/app/test/wire-schema.test.ts |
| Chrome e2e evidence spec on reset-CSS fixture | renders the real extension on a hostile-reset page; screenshot diff exposes centering regressions | bun run e2e:chrome (evidence project) |
| c3 check | docs/code drift gate for c3-117, c3-310, c3-311 code maps and contracts | c3 check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Wrap the setup invite in one container div and style descendants from the shadow sheet | ::slotted() accepts only a compound selector for the top-level slotted node — a wrapper's children are unreachable from the card's shadow stylesheet, and the MV3 isolated world writes light DOM only (Chromium 390807), so the invite would lose all card styling |
| Inline style="" attributes on the generated invite nodes | splits the card's styling across two mechanisms, bypasses the constructable-stylesheet pattern required by ref-web-components-shadow-dom, and still loses to page !important rules — strictly weaker than inner-tree !important |
| Render the setup invite into the card's shadow root instead of light DOM | the content-script renderer cannot reach shadow internals across the MV3 world boundary (the documented reason renderCardState returns light-DOM nodes) |
| Toolbar popup with an Options link for navigation | the toolbar click is already bound to the side panel (openPanelOnActionClick: true, §6.5); a popup would steal that gesture and demote the panel |
| New wire message type (e.g. settings.open) for the gear | open-options already exists, is validated, and is handled by the router; a second type duplicates the surface rule-gate-runtime-messages must defend |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| !important creep makes future theming overrides harder | hardening is scoped to exactly the four setup-invite slotted rules; theme still flows through --ad-* custom properties, which !important declarations still read | unit test pins scope; code review of CSS diff |
| Hostile page synthesizes open-settings to pop the options page (nuisance) | pre-existing exposure (Chrome listener shipped with the setup CTA); message stays payload-free, opens trusted UI only, returns nothing; no data crosses | wire-schema tests; rule-gate-runtime-messages unchanged |
| Gear crowds the card header on narrow viewports | gear reuses the existing 28px .actions button metrics next to Close; header is flex with gap | evidence screenshots incl. dark/narrow |
| browser.runtime.openOptionsPage unavailable on some Safari versions | call sits behind the router's existing catch → typed-error reply; CTA remains (Safari today: dead button, so strictly an improvement) | safari typecheck; manual note in PR |
| Dark-theme regression on hardened rules | !important applied to the same declarations, values unchanged; THEME_DARK_CSS vars unaffected | evidence dark screenshots |

## Verification

| Check | Result |
| --- | --- |
| bun run test | PASS — 305/305 across all packages, incl. the 3 new guards (gear event in card + panel, !important pin) |
| bun run typecheck | PASS — @ai-dict/app, extension-chrome, extension-safari all clean |
| bun run lint && bun run format:check | PASS — eslint clean; "All matched files use Prettier code style!" |
| bun run build:chrome | PASS — bundle built from the changed sources |
| Playwright evidence + settings-nav.spec | PASS locally — all 3 new behavioural tests green (centering on hostile-reset fixture, card gear → options page, panel gear → options page); evidence PNGs captured under e2e-evidence/settings-nav. NOTE: 10 pre-existing options-page e2e failures reproduce identically on clean master locally (blank options.html under local headless Chromium) and are green in CI — environmental, untouched by this change |
| c3 check | PASS — run after doc updates (c3-117, c3-310, c3-311), see PR |
