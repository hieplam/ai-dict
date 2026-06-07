---
id: adr-20260607-options-button-feedback-and-export
c3-seal: cfb4199a4c13e932722d710ed4ae47e33e0ee18b15480bcf781848eba375fc23
title: options-button-feedback-and-export
type: adr
goal: 'Make all five options-page action buttons produce an observable result. Today the shared `<settings-form>` web component emits five events (`save`, `test-connection`, `clear-cache`, `clear-history`, `export-history`), but the per-shell composition roots (`options.ts`) either fire-and-forget the runtime message and discard the reply (save/test/clear×2) or have no listener at all (`export-history`). The decision: add an inline status line to the shared component and have both shells surface every action''s result through it, and implement `export-history` as a client-side JSON download that reuses the existing `history.list` wire message — without adding any new wire-protocol surface.'
status: accepted
date: "2026-06-07"
---

## Goal

Make all five options-page action buttons produce an observable result. Today the shared `<settings-form>` web component emits five events (`save`, `test-connection`, `clear-cache`, `clear-history`, `export-history`), but the per-shell composition roots (`options.ts`) either fire-and-forget the runtime message and discard the reply (save/test/clear×2) or have no listener at all (`export-history`). The decision: add an inline status line to the shared component and have both shells surface every action's result through it, and implement `export-history` as a client-side JSON download that reuses the existing `history.list` wire message — without adding any new wire-protocol surface.

## Context

The buttons "do nothing" from the user's point of view. `packages/extension-chrome/src/options.ts` and `packages/extension-safari/src/options.ts` call `chrome.runtime.sendMessage(...)` with a leading `void`, never awaiting or reading the reply, so the service worker's ack/error (the router already returns them in `router.ts`) is thrown away. `export-history` has no listener in either shell, no `history.export` message in `wire.ts`, and no router handler — it is a dead button. Constraint: the in-page/options UI is a framework-free shadow-DOM component shared by both extensions (ref-web-components-shadow-dom) and must stay CSP-safe; the API key must never appear in any surfaced text or exported payload (rule-api-key-isolation); model-influenced content must never reach the DOM as unsanitized HTML (rule-sanitize-model-output). Affected topology: c3-117 (shared component), c3-212 (Chrome options page), c3-312 (Safari options page).

## Decision

Add a `#status` element (`role="status"`, `aria-live="polite"`) plus a public `setStatus(text, tone?)` method to `settings-form.ts`; status text is written via `textContent` only. Both `options.ts` shells become async-aware: they await each runtime reply and call `form.setStatus(...)` with a success/error message, and `save` reports after the storage write resolves. For `export-history`, the shell sends the existing `history.list` message with no `limit` (which `historyList` already treats as "return all", `history-policy.ts:39`), receives the existing `history` reply, builds the file via a new pure app helper `buildHistoryExport(entries)`, and triggers a Blob download. This wins over adding a `history.export` wire message because the existing list message already returns the full set, so a new message would duplicate wire surface against the repo's lean dependency rule.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-117 | component | Adds the status element + setStatus API to the shared <settings-form> | ref-web-components-shadow-dom (shadow/CSP-safe), rule-sanitize-model-output (textContent only) |
| c3-212 | component | options.ts awaits replies, surfaces status, adds export download | ref-wire-protocol-validation (reuse history.list), rule-api-key-isolation (no key in status/export) |
| c3-312 | component | options.ts same wiring with browser.* API | rule-api-key-isolation (no key in status/export) |
| c3-1 | container | Parent of c3-117; no new responsibilities — work stays within the component's existing remit | Parent Delta: no-delta |
| c3-2 | container | Parent of c3-212; no new responsibilities | Parent Delta: no-delta |
| c3-3 | container | Parent of c3-312; no new responsibilities | Parent Delta: no-delta |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-wire-protocol-validation | Export crosses the content/SW wire; reuses existing history.list request + history reply with no schema change | comply |
| ref-web-components-shadow-dom | New status element renders inside the component's shadow root and must stay CSP-safe (no inline script, adoptStyles) | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-sanitize-model-output | Status text and export carry model-influenced content; status uses textContent, export uses JSON.stringify + Blob, never injected as HTML | comply |
| rule-api-key-isolation | Surfaced status and exported JSON must never contain the Gemini key; history entries hold only LookupResult (no key) and status strings are static | comply |
| rule-gate-runtime-messages | All actions reuse already-gated message types (history.list, cache.clear, history.clear, connection.test); no new ungated runtime path is introduced | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared component | settings-form.ts: add #status to MARKUP, status/error CSS, public setStatus(text, tone?) | packages/app/src/ui/settings-form.ts |
| Component tests | settings-form.test.ts: setStatus shows text, error tone, clears; axe stays green | packages/app/test/ui/settings-form.test.ts |
| Export helper | New buildHistoryExport(entries) pure fn returning {filename, json}; exported from index | packages/app/src/app/history-export.ts, packages/app/src/index.ts |
| Export helper tests | Asserts pretty JSON, entry round-trip, and no apiKey substring | packages/app/test/app/history-export.test.ts |
| Chrome shell | options.ts: await replies → setStatus; export-history → history.list → download | packages/extension-chrome/src/options.ts |
| Safari shell | options.ts: same wiring with browser.* | packages/extension-safari/src/options.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| C3 CLI / validators / schema / hints | N.A - this ADR changes product code only; no .c3/ CLI, validator, schema, hint, or template is touched | c3 check stays green after doc/code changes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| vitest (settings-form.test.ts) | Fails if setStatus stops rendering/announcing status | bun run test |
| vitest (history-export.test.ts) | Fails if export drops entries or leaks apiKey | bun run test |
| tsc (bun run typecheck) | Fails if setStatus/helper types or reply handling drift | bun run typecheck |
| Manual browser run | All five buttons show status / produce download | PR before/after evidence |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add a dedicated history.export wire message + router handler | history.list with no limit already returns every entry (history-policy.ts:39); a new message duplicates wire surface against the lean dependency rule |
| Page-level toast/banner for feedback | User chose an inline status line; putting it in the shared component avoids duplicating feedback UI across both shells |
| Trigger download from the service worker | SW has no DOM/anchor; URL.createObjectURL+anchor must run in the page context anyway |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Export payload leaks the API key | Export only serializes history entries (LookupResult, no key); status strings are static | history-export.test.ts asserts no apiKey in output |
| Status element introduces an a11y regression | Use role="status" + aria-live="polite"; plain textContent | existing axe test in settings-form.test.ts stays green |
| Very large history inflates the JSON blob | History is capped at 500 entries by historyAppend (DEFAULT_CAP) | history-policy cap unchanged |

## Verification

| Check | Result |
| --- | --- |
| bun run test | all suites green incl. new setStatus + buildHistoryExport tests |
| bun run typecheck | no type errors |
| Browser: click Save / Test / Clear cache / Clear history | inline status message appears for each |
| Browser: click Export history | ai-dict-history.json downloads with the stored entries |
