---
bundle: "04"
title: adapters-shared
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["02", "03"]
owns_files:
  - packages/adapters-shared/package.json
  - packages/adapters-shared/tsconfig.json
  - packages/adapters-shared/vitest.config.ts
  - packages/adapters-shared/src/gemini-lookup-client.ts
  - packages/adapters-shared/src/inline-bottom-sheet-renderer.ts
  - packages/adapters-shared/src/markdown-sanitize.ts
  - packages/adapters-shared/src/index.ts
  - packages/adapters-shared/test/*.test.ts
---

# Bundle 04 — adapters-shared/ (platform-free port impls)

**Purpose:** Concrete port implementations with no platform/browser-extension API: `GeminiLookupClient` (impl `LookupClient` via global `fetch`, with 20s timeout, error mapping, `navigator.onLine` short-circuit) and `InlineBottomSheetRenderer` (impl `ResultRenderer` by composing shared-ui `<bottom-sheet>` + `<lookup-card>`, feeding **sanitized** Markdown through the raw-HTML-disabled renderer + DOMPurify allowlist).

## Lock protocol
Verify prereqs `02-core.md` AND `03-shared-ui.md` are both `DONE`. Flip YAML → LOCKED, commit `[04] lock`, rebase, abort on race. Execute.

## Inputs
- Bundle 02 DONE: `LookupClient`, `ResultRenderer` ports; `LookupRequest/Result/Error` types; `mapError`.
- Bundle 03 DONE: `<bottom-sheet>`, `<lookup-card>` components + their events.
- Spec §5.1, §6.9 (error map), §7.3 S2 (fetch shape), S4 (sanitize), S11 (timeout/onLine), §8.7 (bundle budget context).

## Outputs (frozen contracts)
- `GeminiLookupClient implements LookupClient`: POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, header `X-Goog-Api-Key`; honors `opts.signal`; 20s `AbortController` timeout; `navigator.onLine === false` → `NETWORK` before fetch; maps responses via core `mapError`. Constructor-injected `fetch` slice (testable, no `sinon`).
- `markdown-sanitize.ts`: Markdown renderer with raw HTML disabled (`marked`/`snarkdown`, `html:false`) → DOMPurify allowlist (no raw HTML/scripts/event-handlers/`javascript:`; `data:` only `image/*`); anchors forced `target="_blank" rel="noopener noreferrer"`, `https:` only.
- `InlineBottomSheetRenderer implements ResultRenderer`: `renderLoading/renderResult/renderError/close` mounting `<bottom-sheet>` + `<lookup-card>` with sanitized content; constructor takes a host element.

## Definition of Done
- D1: `GeminiLookupClient.lookup` returns a `LookupResult` for the success fixture; sets `model: 'gemini-2.5-flash'`.
- D2: Each §6.9 error condition (injected via fake fetch / fixtures) maps to the correct `LookupError.code` + `retryable`.
- D3: 20s timeout aborts and maps to `NETWORK`; an our-cancel `signal` abort propagates (caller decides suppression); `navigator.onLine===false` short-circuits to `NETWORK` without calling fetch.
- D4: **[S4 security]** `markdown-sanitize` strips `<script>`, inline event handlers, `javascript:` URLs, and disallowed `data:` URIs; the prompt-injection fixture renders inert (no executable payload). Asserted by test.
- D5: `InlineBottomSheetRenderer` drives the loading→result→error→close lifecycle, mounting shared-ui components with sanitized markdown only.
- D6: No extension/platform API imported (lint hex rule: adapters-shared ⇏ extension-*); `fetch` is injected, not globally assumed in tests.
- D7: Coverage ≥ 90% (spec §8.2).

## Implementation steps
> **TO BE FILLED by a per-bundle `superpowers:writing-plans` pass.** TDD: gemini-lookup-client (success + each error row + timeout + offline) → markdown-sanitize (XSS vectors) → inline-bottom-sheet-renderer (lifecycle).

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/adapters-shared test --coverage` → pass, ≥ 90%.

## Validate (sanity / no scope drift)
- `pnpm --filter @ai-dict/adapters-shared typecheck` + `pnpm lint` clean.
- `git diff --stat` only `packages/adapters-shared/**`.
- No `chrome.*` / `browser.*` references (those are extension-only).
- API key never logged; error messages sanitized (no key value).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D7 met with evidence?
- [ ] [S4] All XSS vectors in the prompt-injection fixture neutralized?
- [ ] Error map matches §6.9 exactly (reuses core `mapError`, no fork)?
- [ ] Gemini endpoint/model/header match contracts (`gemini-2.5-flash`, `X-Goog-Api-Key`)?
- [ ] No platform API; `fetch` injected for tests?
- [ ] Only `packages/adapters-shared/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `04`.
