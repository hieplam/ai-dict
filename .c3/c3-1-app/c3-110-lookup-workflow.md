---
id: c3-110
c3-seal: 4bb6046b0a05fb27f70bb9d190f7776e693338f474d92a44ee15182d88451495
title: lookup-workflow
type: component
category: feature
parent: c3-1
goal: 'Orchestrate the end-to-end word-lookup interaction on the content page: listen for text selections, present the trigger, and drive loading/result/error rendering through injected ports.'
uses:
    - ref-core-dependency-rule
    - ref-dependency-injection
    - rule-domain-purity
    - rule-typed-errors
---

## Goal

Orchestrate the end-to-end word-lookup interaction on the content page: listen for text selections, present the trigger, and drive loading/result/error rendering through injected ports.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Feature |
| Runtime | content script |
| Public surface | runLookupWorkflow(deps: WorkflowDeps): () => void, WorkflowDeps |
| Bundled into | packages/app/src/domain/workflow.ts compiled into content script via content.ts |
| Depends on | c3-102 ports (SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore), c3-101 domain types |

## Purpose

Owns the content-script side state machine: selection → trigger display → user click → settings check → loading → lookup → render result or error. It does NOT perform the actual network lookup (delegated to `LookupClient`), does NOT render UI directly (delegated to `ResultRenderer` and `TriggerUI`), does NOT persist results, and does NOT run in the service worker.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A WorkflowDeps struct with all five port implementations must be provided by the composition root | ref-dependency-injection |
| Input | SelectionEvent emitted by SelectionSource.onSelection (from packages/app/src/domain/workflow.ts) carrying text, sentence, anchor, url, title | c3-102 |
| Internal state | Single inFlight: AbortController │ null (in packages/app/src/domain/workflow.ts) tracks the active lookup; replaced on each new trigger click, aborting the previous | c3-1 |
| Shared dependency | SettingsStore.get() is awaited on every trigger click to read hasKey, targetLang, promptTemplate | c3-102 |
| Error normalisation | toLookupError (private in packages/app/src/domain/workflow.ts) wraps any thrown value: passes through if already LookupError-shaped, else calls mapError({kind:'thrown', error}) | rule-typed-errors |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Primary outcome | User sees a rendered definition card after clicking the trigger for a selected word | c3-102 |
| Happy path | onSelection fires → trigger.show(anchor, cb) → user clicks → trigger.hide() → settings.get() → renderer.renderLoading() → client.lookup(req, {signal}) → renderer.renderResult(result) (verified in packages/app/test/workflow.test.ts) | ref-dependency-injection |
| No-key short-circuit | If settings.hasKey is false, renderer.renderError(mapError({kind:'no-key'})) is called immediately; renderLoading and client.lookup are never invoked (verified in packages/app/test/workflow.test.ts) | rule-typed-errors |
| Concurrent-selection cancellation | Starting a second lookup aborts the first via AbortController; aborted lookup's result/error callbacks are suppressed via controller.signal.aborted guard (verified in packages/app/test/workflow.test.ts) | c3-1 |
| Teardown | Returned () => void aborts any in-flight lookup, calls trigger.hide(), renderer.close(), and teardown() on the selection subscription (verified in packages/app/test/workflow.test.ts) | c3-115 |
| Client error path | Any rejection from client.lookup is caught and passed through toLookupError then renderer.renderError; plain Error maps to code UNKNOWN (verified in packages/app/test/workflow.test.ts) | rule-typed-errors |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-dependency-injection | ref | WorkflowDeps injects all 5 ports; no concrete adapter is imported | high | Composition root (content.ts) supplies adapters |
| ref-core-dependency-rule | ref | workflow.ts imports only ../ports and ./types; no chrome.*, no DOM, no fetch | high | Enforced by rule-domain-purity below |
| rule-domain-purity | rule | File imports only port types and domain types — zero platform APIs | high | Verified: only imports from ../ports and ./types and ./error-mapper |
| rule-typed-errors | rule | All errors flow through toLookupError / mapError; no raw unknown escapes to renderer | high | toLookupError private helper in workflow.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| WorkflowDeps | IN | Struct of five port interfaces: selection, trigger, renderer, client, settings | Domain/Adapters | packages/app/src/domain/workflow.ts — export interface WorkflowDeps |
| runLookupWorkflow(deps) | OUT | Returns a teardown () => void; side-effects only through injected ports | Content script composition root | packages/app/src/domain/workflow.ts — export function runLookupWorkflow |
| Teardown function | OUT | Aborts in-flight request, hides trigger, closes renderer, unsubscribes selection listener | Content script lifecycle | packages/app/test/workflow.test.ts — teardown() test |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| AbortController logic regression | Changing the inFlight guard or signal check | Concurrent-selection test fails silently allowing stale renders | bun run --filter @ai-dict/app test packages/app/test/workflow.test.ts |
| No-key branch removed | Removing the settings.hasKey check | Unit test NO_KEY short-circuit fails | packages/app/test/workflow.test.ts |
| Port interface mismatch | Changing WorkflowDeps fields | TypeScript compile error in composition roots | bun run --filter @ai-dict/app typecheck |
| Teardown contract broken | Omitting renderer.close() or teardown() call | Teardown contract test fails | bun run --filter @ai-dict/extension-chrome test |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Unit tests | Contract | Fake port implementations (FakeSelectionSource, FakeTriggerUI, etc.) may evolve independently | packages/app/test/workflow.test.ts |
| Content-script composition root | Contract | Concrete adapters differ per platform (chrome vs safari) | c3-115 |
