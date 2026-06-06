---
id: adr-20260606-remove-dead-expand-button
c3-seal: c267dfa8c6e9c70f53688f0d3f81687b2f5c6a49b47df9c8f6dbd988900ae949
title: remove-dead-expand-button
type: adr
goal: Remove the non-functional "Expand" action button from the `<lookup-card>` custom element (c3-117 ui-components). The button currently renders in both the in-page bottom sheet and the Chrome side panel, dispatches a `composed`/`bubbling` `expand` CustomEvent on click, and has no listener anywhere in production code — so clicking it does nothing. This ADR authorizes deleting the button, narrowing the `actionButton` action union to `'close'` only, and pruning the two `expand` test cases, leaving `Close` as the card's sole action.
status: implemented
date: "2026-06-06"
---

## Goal

Remove the non-functional "Expand" action button from the `<lookup-card>` custom element (c3-117 ui-components). The button currently renders in both the in-page bottom sheet and the Chrome side panel, dispatches a `composed`/`bubbling` `expand` CustomEvent on click, and has no listener anywhere in production code — so clicking it does nothing. This ADR authorizes deleting the button, narrowing the `actionButton` action union to `'close'` only, and pruning the two `expand` test cases, leaving `Close` as the card's sole action.

## Context

`<lookup-card>` builds an action bar with two buttons — `Expand` and `Close` (`packages/app/src/ui/lookup-card.ts:101`). Each button dispatches `CustomEvent(act, { bubbles: true, composed: true })`. `Close` is wired: `InlineBottomSheetRenderer` listens `card.addEventListener('close', ...)` (c3-115, `inline-bottom-sheet-renderer.ts:20`). `expand` has zero listeners across the repo — a grep of `packages/` finds it only in the card's own emit site, its unit tests, and built `dist/` bundles. The side panel (`extension-chrome/src/side-panel.ts`) attaches no listeners to the card at all.

Result: the Expand button is dead UI — it fires an event into the void, matching the user-reported symptom "click on that nothing shows up." The feature (promoting the inline sheet into the side panel) was never implemented. The c3-117 contract documents the card's real events (`lookup-click`, `dismiss`, `save`) but never mentions `expand`, so the button is undocumented as well as unwired. Affected topology is confined to c3-117; c3-115 already does not depend on `expand`.

## Decision

Delete the dead button outright rather than implement the missing handler. The user explicitly classified Expand as a dead feature to remove; there is no product requirement driving a side-panel-promotion flow today, so building one would be speculative scope. Removal is the minimal, reversible change: drop the `expand` button from the bar, narrow `actionButton(act: 'close')` so the type system forbids re-introducing an unhandled action by accident, and delete the two `expand` test cases. The `composed: true` event-boundary guarantee remains tested via the surviving `close` boundary test, so the cross-shadow contract stays covered.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | Owns <lookup-card>; the button, its actionButton signature, and its tests live here | Confirm Business Flow / Contract sections need no edit — expand is undocumented, so no contract row changes |
| c3-115 | component | Hosts InlineBottomSheetRenderer, the card's consumer | Verify renderer needs no change — it never listened for expand; close/dismiss wiring untouched |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-web-components-shadow-dom | Governs the card's open-shadow + composed: true event-crossing pattern; removing a button must not weaken the surviving event's shadow-boundary contract | comply — keep close button emitting composed: true; retain the close boundary test |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-sanitize-model-output | Governs c3-117's SafeHtml/renderCardState result path | N.A - change touches only the action bar buttons, not the result-rendering or sanitization path |
| rule-api-key-isolation | Governs c3-117's settings-form key handling | N.A - change is confined to <lookup-card>, never touches <settings-form> |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Code | Remove expand button from the bar; narrow actionButton(act: 'close', ...) and its union type | packages/app/src/ui/lookup-card.ts:101,116 |
| Test | Replace emits "close" and "expand" with a close-only assertion; delete "expand" event crosses shadow boundary test | packages/app/test/ui/lookup-card.test.ts:68-87,124-141 |
| Docs | None — c3-117 contract does not reference expand; no code-map pattern change | c3 read c3-117 --full shows no expand mention |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/help surface is touched | N.A - this is a product-code + test change only; no .c3/ underlay edits | c3 check passes unchanged after the code edit |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run --filter @ai-dict/app test packages/app/test/ui/lookup-card.test.ts | Card test suite passes with only the close action asserted; no orphaned expand assertions | green run |
| bun run --filter @ai-dict/app typecheck | actionButton union narrowed to 'close'; any future un-handled action re-introduction is a type error | clean typecheck |
| c3 check | C3 docs remain consistent with code (no contract referenced expand) | PASS |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Implement the expand handler (promote inline sheet → Chrome side panel) | No product requirement exists today; user explicitly called it a dead feature. Speculative cross-context messaging work, larger blast radius. |
| Hide the button via CSS but keep the code | Leaves dead emit code and dead tests; the expand event and its type union survive as latent confusion. Does not address root cause. |
| Keep button, just add a no-op listener | Still does nothing visible to the user; ships a button that lies about having an action. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Removing a button breaks the action-bar layout/styling | .bar is a flexbox that already handles a single child (justify-content:flex-end); only the Close button remains, right-aligned | Visual before/after evidence on PR; bun run --filter @ai-dict/app test (axe a11y tests stay green) |
| Hidden consumer of the expand event exists | Repo-wide grep confirmed only emit-site + tests + dist reference expand; no production listener | grep -rn expand packages/ --exclude-dir=dist --exclude-dir=node_modules shows only card + tests |
| Shadow-boundary composed contract lost when deleting expand boundary test | The close boundary test still asserts composed: true crossing the shadow root | lookup-card.test.ts "close" event crosses shadow boundary test stays green |

## Verification

| Check | Result |
| --- | --- |
| bun run --filter @ai-dict/app test packages/app/test/ui/lookup-card.test.ts | All card tests pass; no expand references remain |
| bun run --filter @ai-dict/app typecheck | Clean; actionButton union is 'close' only |
| grep -rn "expand" packages/app/src packages/app/test packages/extension-chrome/src packages/extension-safari/src | No matches (dead code fully removed) |
| c3 check | PASS |
| Before/After UI evidence | Screenshot attached to PR showing card with Expand+Close, then Close only |
