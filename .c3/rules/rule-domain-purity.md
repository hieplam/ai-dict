---
id: rule-domain-purity
c3-seal: 396dd7855fdea3005e0e82a521092d60c9f1807b23c3690bdf52b0a5401bbf7e
title: domain-purity
type: rule
goal: Enforce the inward-only dependency direction at the domain edge so the core stays portable and unit-testable — the load-bearing half of the architecture (`ref-core-dependency-rule`).
---

## Goal

Enforce the inward-only dependency direction at the domain edge so the core stays portable and unit-testable — the load-bearing half of the architecture (`ref-core-dependency-rule`).

## Rule

Files in `packages/app/src/domain/` import only from `./` (domain) and `../ports` — never `chrome.*`, `fetch`, the DOM, `ui/`, `app/`, or an npm library.

## Golden Example

Literal from `packages/app/src/domain/workflow.ts` — every import stays inward:

```ts
// REQUIRED: ports + domain types only; no platform, no library, no adapter
import type {
  SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore,
} from '../ports';
import type { SelectionEvent, LookupRequest, LookupError } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| import { z } from 'zod' inside domain/ | Keep zod at the edge in wire.ts; domain stays library-free | A library import makes the core non-portable and breaks the dependency-free guarantee |
| chrome.storage.local... in a policy | Depend on the Storage port; inject the adapter | Couples the domain to one platform |
| document.querySelector in workflow.ts | Depend on SelectionSource / ResultRenderer ports | DOM access can't run in the SW or a Node test |

## Scope

`packages/app/src/domain/**`. The sibling `wire.ts` (imports `zod`) and `app/**` adapters are the *edge*, not the core, and are exempt.

## Override

To reach outward, add a port to `packages/app/src/ports.ts` and inject an adapter — never import the dependency directly.

**Known drift:** `eslint.config.mjs` still enforces this via `import-x/no-restricted-paths` zones targeting the pre-flatten package paths (`packages/core/src`, `packages/adapters-shared`, `packages/shared-ui`), which no longer hold source. Until those zones are repointed at `packages/app/src/{domain,app,ui}`, the rule is upheld by this directory-edge convention rather than by lint.
