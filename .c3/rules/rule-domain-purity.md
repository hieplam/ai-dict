---
id: rule-domain-purity
c3-seal: d66b2ba48307e6982ab8da4431069184c7343f82c2bae3d3f7c29b10bd6be07e
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

**Enforcement (mechanical, two surfaces — ADR `adr-20260610-dep-direction-build-gate`):**

1. **Build gate:** `scripts/check-dep-direction.mjs` enforces the full allowlist matrix (domain → `./` + `../ports` only; `ports.ts` → domain types only; `wire.ts` → domain + `zod` only; core never imports a shell; shells never import each other). It runs as the first command of both extension `build` scripts and of `bun run lint`, exits 1 with the violated rule and fix hint, so a violating tree cannot produce a bundle or pass CI. Matrix locked by `scripts/check-dep-direction.test.ts`.
2. **IDE/lint feedback:** `eslint.config.mjs` `import-x/no-restricted-paths` zones, repointed at the post-flatten paths (`packages/app/src/{domain,app,ui}` and the extension packages).
