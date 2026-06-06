---
id: ref-core-dependency-rule
c3-seal: 153e486f4df2854eb3c48f9022ee99506b506ecfa2b666c90bac85a92925b69a
title: core-dependency-rule
type: ref
goal: 'Keep the lookup logic portable across two browser runtimes (Chrome and Safari/iOS) without per-platform forks. The recurring need: a single rule for *which direction a dependency may point*, so the same core code is reused verbatim by both extension shells and stays testable in isolation.'
---

## Goal

Keep the lookup logic portable across two browser runtimes (Chrome and Safari/iOS) without per-platform forks. The recurring need: a single rule for *which direction a dependency may point*, so the same core code is reused verbatim by both extension shells and stays testable in isolation.

## Choice

A **lean dependency rule** — the kept half of ports-and-adapters, with the package ceremony dropped:

- dependencies are **one-directional**, always pointing inward toward the domain;
- the **domain core depends on nothing outward** (`packages/app/src/domain/**` imports only its own types and `../ports`);
- the core reaches the outside **only through port interfaces** declared in `packages/app/src/ports.ts`; concrete adapters are injected by the composition roots `sw.ts` / `content.ts`.

## Why

A fuller hexagonal layout (separate `core` / `adapters-shared` / `shared-ui` packages with cross-package import zones) was built and then judged overengineered for a two-surface extension — it was flattened 5 packages → 3 (commit *"Flatten hexagon: 5 packages → 3, kill duplication"*). The flatten deliberately keeps **only** the dependency rule, because that is the part that earns its weight here: the pure core runs in a plain-Node vitest with fake ports — no DOM, no `chrome.*`, no network, no API key (see `docs/knowledge-base/hexagonal-architecture.md`) — and the identical core is bundled into both `extension-chrome` and `extension-safari`. The discarded part — package boundaries policed by build tooling — bought nothing once the code lived in one library, and its leftover `eslint` import-zones now point at deleted paths (see `rule-domain-purity`). Alternative rejected: importing `chrome` / `fetch` directly in the core would couple it to one platform and break reuse.

## How

The domain declares a need as a port and receives an implementation; only the composition root names concrete adapters. Literal from `packages/extension-chrome/src/content.ts`:

```ts
// REQUIRED: the composition root is the ONLY place that `new`s adapters
runLookupWorkflow({
  selection: new DomSelectionSource(document),             // SelectionSource port
  trigger: new ChromeFloatingTrigger(),                    // TriggerUI port
  renderer: { /* InlineBottomSheetRenderer + ChromeSidePanelMirror */ },
  client: new MessageRelayLookupClient(chrome.runtime),    // LookupClient port
  settings: new MessageRelaySettingsStore(chrome.runtime), // SettingsStore port
});
```

And the inward-only imports in `packages/app/src/domain/workflow.ts`:

```ts
// REQUIRED: domain imports only ports + domain types — never an adapter
import type { SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore } from '../ports';
import type { SelectionEvent, LookupRequest, LookupError } from './types';
```
