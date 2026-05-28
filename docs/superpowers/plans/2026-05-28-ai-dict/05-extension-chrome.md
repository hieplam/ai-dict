---
bundle: "05"
title: extension-chrome
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["02", "03", "04"]
owns_files:
  - packages/extension-chrome/package.json
  - packages/extension-chrome/tsconfig.json
  - packages/extension-chrome/vitest.config.ts
  - packages/extension-chrome/esbuild.config.mjs
  - packages/extension-chrome/playwright.config.ts
  - packages/extension-chrome/src/manifest.json
  - packages/extension-chrome/src/sw.ts
  - packages/extension-chrome/src/content.ts
  - packages/extension-chrome/src/side-panel.html
  - packages/extension-chrome/src/side-panel.ts
  - packages/extension-chrome/src/options.html
  - packages/extension-chrome/src/options.ts
  - packages/extension-chrome/src/adapters/**
  - packages/extension-chrome/test/**
  - packages/extension-chrome/e2e/**
---

# Bundle 05 — extension-chrome/ (Chrome MV3 desktop)

**Purpose:** The full Chrome Manifest V3 extension. Content-side composition root wires content adapters + `runLookupWorkflow`. SW composes `GeminiLookupClient` + Chrome storage adapters + the message router (`buildRouter(deps)`), owns `Map<requestId, AbortController>` for cancellation + an in-SW write queue serializing `cache:index`/`history:index`. Options page reads/writes full `Settings` (incl. `apiKey`) directly to `chrome.storage.local`. Side panel is a secondary mirror. Strict CSP + minimal permissions. Playwright e2e with `page.route()`-mocked Gemini.

## Lock protocol
Verify prereqs `02`, `03`, `04` all `DONE`. Flip YAML → LOCKED, commit `[05] lock`, rebase, abort on race. Execute. (May run in parallel with Bundle 06 — disjoint files.)

## Inputs
- Bundles 02/03/04 DONE: ports, types, wire schema, `runLookupWorkflow`, `deriveCacheKey`, `mapError`, shared-ui components, `GeminiLookupClient`, `InlineBottomSheetRenderer`.
- Spec §5.4 (components), §6.2–6.10 (storage, flows, router, cancellation), §7.3 S1/S3/S5/S8/S11, §8.1 (e2e-chrome), §8.4 (constructor-injection adapter pattern), §8.7 (budgets).

## Outputs
- `manifest.json`: MV3, statically-registered `content_scripts`, `permissions:["storage","sidePanel"]`, `host_permissions:["<all_urls>","https://generativelanguage.googleapis.com/*"]`, strict CSP (§7.3 S5), no `scripting`, no `externally_connectable`.
- `sw.ts` + `buildRouter(deps)`: handles every `WireMessage`; `sender.id` guard (S3); cache/history toggles honored; cancellation suppression sentinel (§6.10); serialized index writes.
- `content.ts`: composition root per §5.6.
- Adapters: `dom-selection-source`, `chrome-floating-trigger`, `chrome-side-panel-mirror`, `chrome-storage-store`, `chrome-kv-store`, `message-relay-lookup-client`, `message-relay-settings-store` — each constructor-injects its browser-API slice (§8.4).
- `options.html/.ts` (full Settings incl. key, direct storage), `side-panel.html/.ts` (mirror).
- `e2e/` Playwright specs (lookup, settings) + fixture pages; `esbuild.config.mjs` producing `dist/`.

## Definition of Done
- D1: `buildRouter(deps)` unit-tested with injected fake `LookupClient`/`SettingsStore`/`Storage`: lookup happy path, cache hit, NO_KEY, cancellation suppression, history/cache toggles.
- D2: Each adapter unit-tested with hand-rolled fakes (no `sinon-chrome`); `ext/test ⇏ sibling adapters` rule honored (ports injected).
- D3: **[S1]** content side only ever receives `PublicSettings`; `message-relay-settings-store` never exposes `apiKey`; SW strips key on `settings.get` reply. Asserted.
- D4: **[S3]** router rejects messages where `sender.id !== chrome.runtime.id`.
- D5: **[S11]** 20s timeout + `Map<requestId,AbortController>` cancellation + `navigator.onLine` short-circuit wired through SW.
- D6: Index writes serialized through a single in-SW write queue (concurrent-lookup test shows no lost index update).
- D7: `manifest.json` matches §7.3 S5 CSP + S8 permissions **exactly**; no `scripting`/`externally_connectable`.
- D8: Playwright e2e (lookup + settings) green against `page.route()`-mocked Gemini on the fixture pages.
- D9: `esbuild` emits loadable unpacked `dist/`; bundle sizes within §8.7 budgets (content ≤45KB, sw ≤30KB, options ≤40KB, side-panel ≤40KB gz).
- D10: Coverage (adapters + sw-router) ≥ 80% (spec §8.2).

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** TDD per adapter + router; e2e last. Manifest + CSP early (so build/e2e can load it).

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/extension-chrome test --coverage` → pass, ≥ 80%.
- Run: `pnpm --filter @ai-dict/extension-chrome build` then Playwright e2e → green.
- Run: `pnpm size` (chrome bundles) → within budget.

## Validate (sanity / no scope drift)
- `typecheck` + `lint` clean (hex rules).
- `git diff --stat` only `packages/extension-chrome/**`.
- Manifest permissions/CSP diffed against §7.3 S5/S8 — no extra permission.
- No key value logged anywhere; SW logs only `{code, keyConfigured}` (§7.2).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D10 met with evidence?
- [ ] [S1] key never reaches content side / wire?
- [ ] [S3] sender guard enforced + tested?
- [ ] [S5/S8] manifest CSP + permissions exact?
- [ ] Cancellation suppression + serialized index writes tested?
- [ ] e2e green; bundles within budget?
- [ ] Only `packages/extension-chrome/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `05`.
