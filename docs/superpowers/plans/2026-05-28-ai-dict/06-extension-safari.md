---
bundle: "06"
title: extension-safari
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["02", "03", "04"]
owns_files:
  - packages/extension-safari/package.json
  - packages/extension-safari/tsconfig.json
  - packages/extension-safari/vitest.config.ts
  - packages/extension-safari/esbuild.config.mjs
  - packages/extension-safari/src/manifest.json
  - packages/extension-safari/src/sw.ts
  - packages/extension-safari/src/content.ts
  - packages/extension-safari/src/options.html
  - packages/extension-safari/src/options.ts
  - packages/extension-safari/src/adapters/**
  - packages/extension-safari/test/**
  - packages/extension-safari/e2e/ios-simulator-checklist.md
  - packages/extension-safari/xcode/**
---

# Bundle 06 — extension-safari/ (Safari iOS Web Extension + Xcode wrapper)

**Purpose:** Mirror of the Chrome extension for Safari iOS, using `browser.storage.local`, no `sidePanel` (inline `<bottom-sheet>` is the only surface), Safari `browser_specific_settings`. Includes the **iOS-app-only** Xcode wrapper that loads `dist/`, and the mandatory manual iOS Simulator checklist (no automated E2E — Apple exposes no WebDriver for iOS Safari Web Extensions, so adapter coverage is elevated to compensate).

## Lock protocol
Verify prereqs `02`, `03`, `04` all `DONE`. Flip YAML → LOCKED, commit `[06] lock`, rebase, abort on race. Execute. (May run in parallel with Bundle 05 — disjoint files.)

## Inputs
- Bundles 02/03/04 DONE (same shared contracts as Chrome).
- Spec §5.5 (Safari differences), §6.* flows (shared), §7.3 S1/S3/S6/S8, §8.1 (manual iOS tier), §8.2 (90% coverage — no e2e net), §8.10 (ios checklist outline).

## Outputs
- `manifest.json`: no `sidePanel`; `permissions:["storage"]`; `host_permissions:["<all_urls>","https://generativelanguage.googleapis.com/*"]`; `browser_specific_settings`; strict CSP.
- `sw.ts` + `buildRouter(deps)`, `content.ts` composition root — Safari analogues of the Chrome flows (no side-panel mirror).
- Adapters: `dom-selection-source`, `safari-floating-trigger`, `safari-storage-store`, `safari-kv-store`, `message-relay-lookup-client`, `message-relay-settings-store` (over `browser.storage.local`).
- `options.html/.ts` (full Settings incl. key, direct storage).
- `xcode/`: iOS app target only (App Store wrapper) loading `packages/extension-safari/dist/`; `MARKETING_VERSION` placeholder wired for `release:bump`. **No macOS target.**
- `e2e/ios-simulator-checklist.md` per §8.10 outline.
- `esbuild.config.mjs` → `dist/` (web-ext code; loadable unpacked / syncable into Xcode).

## Definition of Done
- D1: `buildRouter(deps)` unit-tested with fakes: lookup happy path, cache hit, NO_KEY, cancellation suppression, toggles.
- D2: Each adapter unit-tested with hand-rolled fakes over a `browser.storage.local`-like slice (constructor injection); `ext/test ⇏ sibling adapters` honored.
- D3: **[S1]** content side receives `PublicSettings` only; key never crosses the wire; SW strips key on `settings.get`.
- D4: **[S3]** sender check enforced; no `externally_connectable`.
- D5: `manifest.json` matches §7.3 S8 Safari permissions exactly (no `sidePanel`, no `scripting`); CSP per S5; `browser_specific_settings` present.
- D6: `esbuild` emits loadable `dist/`; bundle sizes within §8.7 (content ≤45KB, sw ≤30KB, options ≤40KB gz).
- D7: Xcode project builds the iOS target referencing `dist/` (build verified on macOS in release flow — Bundle 07; here, project structure + sync script exist and are documented).
- D8: `ios-simulator-checklist.md` covers all 12 steps of §8.10.
- D9: Coverage ≥ 90% (spec §8.2 — elevated, no e2e safety net).

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** TDD per adapter + router; manifest + esbuild early; Xcode wrapper + checklist last.

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/extension-safari test --coverage` → pass, ≥ 90%.
- Run: `pnpm --filter @ai-dict/extension-safari build` → loadable `dist/`.
- Run: `pnpm size` (safari bundles) → within budget.
- Xcode build itself is exercised by Bundle 07 (macOS runner); here verify project files + sync script presence.

## Validate (sanity / no scope drift)
- `typecheck` + `lint` clean.
- `git diff --stat` only `packages/extension-safari/**`.
- No `sidePanel`, no Chrome-only APIs; no macOS Xcode target (non-goal §2).
- No key value logged (§7.2).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D9 met with evidence?
- [ ] [S1] key isolation verified?
- [ ] [S3] sender guard tested?
- [ ] Manifest matches §7.3 S8 Safari list (no sidePanel/scripting)?
- [ ] iOS target only — no macOS target?
- [ ] 12-step iOS checklist complete?
- [ ] Only `packages/extension-safari/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `06`.
