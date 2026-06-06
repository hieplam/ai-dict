---
id: c3-102
c3-seal: 784a2887c266edfeab3a06b2a6185fb06fdcac10088579a53756e901c654450d
title: ports
type: component
category: foundation
parent: c3-1
goal: Declare the six port interfaces that form the only seam between the dependency-free core and all platform adapters.
uses:
    - ref-core-dependency-rule
    - rule-domain-purity
---

## Goal

Declare the six port interfaces that form the only seam between the dependency-free core and all platform adapters.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-1 (app) |
| Category | Foundation |
| Runtime | both |
| Public surface | SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore, Storage |
| Bundled into | packages/app/src/ports.ts |
| Depends on | c3-101 (domain-types) — imports AnchorRect, SelectionEvent, LookupRequest, LookupResult, LookupError, PublicSettings |
| Implemented by | c3-201 (chrome-adapters), c3-301 (safari-adapters) |

## Purpose

Owns the complete set of abstract interfaces that the core workflow (`c3-110`) calls and that adapters are required to satisfy. By placing these interfaces in the core package (`packages/app`), ownership stays inward: the core defines the contract, adapters comply. `SettingsStore.get()` returns `PublicSettings` — not `Settings` — enforcing that the API key never travels through a port. This component does NOT contain any implementation logic, concrete classes, platform calls, or runtime state. It does NOT define wire-level schemas (that is `c3-103`); it exposes only TypeScript interface shapes.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | c3-101 (domain-types) must be resolved first; packages/app/src/ports.ts imports from ./domain/types | ref-core-dependency-rule |
| Inputs | Ports are interfaces; they receive no runtime input at the module level | c3-1 |
| Internal state | Stateless — packages/app/src/ports.ts contains only interface declarations | ref-core-dependency-rule |
| Dependency direction | Adapters import from ports.ts; ports.ts imports only from domain/types — never from adapters | ref-core-dependency-rule |
| Injection point | Composition roots sw.ts / content.ts instantiate concrete adapters and inject them into the core workflow | ref-dependency-injection |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Each port method is called by core workflow logic and fulfilled by the injected adapter at runtime | c3-110 |
| Primary path — selection | Core subscribes via SelectionSource.onSelection(cb) which returns an unsubscribe function; defined in packages/app/src/ports.ts:11 | c3-110 |
| Primary path — settings | Core calls SettingsStore.get() which returns Promise<PublicSettings>; apiKey is never exposed | rule-api-key-isolation |
| Primary path — storage | Core calls Storage.getItem/setItem/removeItem/keys as a key-value primitive; prefix namespacing is the adapter's responsibility | ref-kv-storage-prefixes |
| Failure behavior | Error handling is delegated to callers of each port; ports themselves define no error contracts | c3-110 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-core-dependency-rule | ref | Ports owned by core, implemented outward by adapters; no inward imports | High | This file is the canonical seam the rule describes |
| rule-domain-purity | rule | Ports may only import from domain/**; no platform APIs, no zod, no chrome.* | High | Verified by absence of any non-domain import in packages/app/src/ports.ts |
| rule-api-key-isolation | rule | SettingsStore.get() returns PublicSettings, not Settings | High | Keeps apiKey out of every code path that flows through a port |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| SelectionSource.onSelection | IN | (cb: (e: SelectionEvent) => void) => () => void — returns unsubscribe | Content-script adapter implements; core workflow subscribes | packages/app/src/ports.ts:11 |
| TriggerUI.show / TriggerUI.hide | IN | show(anchor: AnchorRect, onClick: () => void): void / hide(): void | UI adapter implements; core workflow calls | packages/app/src/ports.ts:15-17 |
| ResultRenderer.renderLoading/renderResult/renderError/close | IN | Four lifecycle methods covering the full result display lifecycle | UI adapter implements; lookup workflow drives | packages/app/src/ports.ts:20-24 |
| LookupClient.lookup | IN | (req: LookupRequest, opts?: { signal?: AbortSignal }) => Promise<LookupResult> | Service-worker adapter implements; core workflow calls | packages/app/src/ports.ts:27 |
| SettingsStore.get | OUT | Returns Promise<PublicSettings> — apiKey stripped | All callers receive only public fields | packages/app/src/ports.ts:31 |
| Storage.keys | OUT | (prefix?: string) => Promise<string[]> — caller-supplied prefix narrows result set | Adapter implements; persistence policies use prefix to namespace | packages/app/src/ports.ts:39 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Changing SettingsStore.get() return type to Settings | Returning full settings through a port | rule-api-key-isolation violation; adapters that rely on PublicSettings type fail to compile | bun run --filter @ai-dict/app typecheck |
| Removing a port method | Any interface method deleted | All adapter classes implementing the port fail to compile | bun run --filter @ai-dict/extension-chrome typecheck |
| Adding a platform import to ports.ts | Import of chrome.*, zod, or DOM API | rule-domain-purity violation; caught by extension build failing to resolve non-domain symbol | bun run --filter @ai-dict/extension-chrome e2e |
| Changing SelectionSource.onSelection signature | Altering callback or return type | Content-script adapters in c3-201 and c3-301 fail to compile | bun run --filter @ai-dict/extension-safari typecheck |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| ChromeSelectionSource, ChromeTriggerUI, etc. in c3-201 | Contract — six port interface shapes | Implementations may add private fields; public method signatures must match exactly | packages/app/src/ports.ts |
| SafariSelectionSource, etc. in c3-301 | Contract — six port interface shapes | Same as chrome — public contract is fixed | packages/app/src/ports.ts |
| Composition-root injection in sw.ts / content.ts | Contract — port interfaces drive the constructor/factory parameters | Concrete types may differ per platform; port interface is the stable contract | ref-dependency-injection |
