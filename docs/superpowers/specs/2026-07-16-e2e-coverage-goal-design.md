# E2E Coverage Goal — Design

The what/why for the e2e coverage push. The how lives in
`docs/superpowers/plans/2026-07-16-e2e-p1-coverage.md`.

## Goal frame (reverse-tornado OKR, owner-ruled 2026-07-16)

- **Objective:** e2e case coverage — `covered / inventoried user-facing cases` — read
  mechanically from `docs/testing/e2e-case-inventory.md` (the frozen denominator).
- **Baseline:** 99 covered / 128 total = **77.3%**.
- **Target (owner ruling):** coverage **≥ 80%** — reached at 103/128; the staged batch closes 6
  gaps → 105/128 = **82.0%**.
- **Scope:** Chrome e2e via the existing Playwright harness only. Safari stays on unit/adapter
  tests. P3 gaps (unit-proven) are explicitly not pursued.

### Walls (anti-goals — must hold while the objective moves)

| Wall             | Metric                                                            | Read                    |
| ---------------- | ----------------------------------------------------------------- | ----------------------- |
| Zero flaky tests | 3 consecutive full-suite runs, identical green result             | `bun run e2e:chrome` ×3 |
| No weakening     | 0 disabled functional tests; assertion count ≥ 279                | grep diff vs baseline   |
| Integrity        | Denominator frozen; removing/demoting a case needs owner sign-off | inventory file review   |

A metric win that breaches a wall is a failed loop. Progress is only ever read from the
inventory replay (`grep -c '| \[covered\]'`), never from "N tests merged".

## Baseline reality (DKR-2 finding, 2026-07-16)

The master suite is **not green**: run 1 of the 3× baseline read produced **15 failed / 95
passed (12.7m)**, clustered on the onboarding / no-key / settings-form surface (all 3
`onboarding.spec.ts` tests, no-key invites in `side-panel.spec.ts` / `settings-nav.spec.ts` /
`evidence.spec.ts`, `settings.spec.ts` first-run) plus 3 outliers (`bottom-sheet-overflow`,
`cache-history` cacheEnabled:false, `error-reporting`). Runs 2–3 discriminate deterministic
breakage from flakiness. **Consequence: no new test work merges until the suite reads 3× green**
— repairing the baseline is Task 1 of the plan, ahead of everything else.

## The P1 batch (6 cases, staged on `feature/E2eP1Cases`)

Chosen by rank from the inventory's 10 P1 gaps; 6 clears the 80% target with margin.

1. **S4 sanitize proof** (`sanitize-hostile-output.spec.ts`) — hostile mocked Gemini response
   (`<script>`, `<img onerror>`, `javascript:` link) through the real SW → content-script →
   card pipeline: nothing executes, hostile elements absent, `https:` link + benign markdown
   survive. E2e teeth for `rule-sanitize-model-output`; previously unit-only.
2. **Timeout** (`lookup-timeout.spec.ts`) — a provider route that never fulfills; the 20s
   client abort (`http-lookup-client.ts` DEFAULT_TIMEOUT_MS) must surface the network-error
   card rather than hang. Own file so parallel workers absorb the 20s wait.
3. **OpenAI error wording** (`provider-errors.spec.ts`) — OpenAI 401 with Gemini unconfigured
   (no fallback masking) → "OpenAI rejected the API key."
4. **Fallback exhaustion** (`provider-fallback.spec.ts`) — Gemini 500 + Claude 500 → the
   _primary's_ error surfaces ("Gemini server error. Retry."), each endpoint hit exactly once.
5. **No-fallback-key** (`provider-fallback.spec.ts`) — only Gemini configured, Gemini 500 →
   clean error, zero calls to OpenAI/Anthropic (tripwire mocks).
6. **Dismiss during pending** (`lookup-pending-dismiss.spec.ts`) — dismiss while the response
   is 3s away (new `delayMs` mock option in `helpers.ts`); the late result must not resurrect
   the sheet.

Deliberately deferred: "new selection while in-flight" (P1 #7, not needed for target), OpenAI
429/500 wording, all P2 probes (unknown behavior → each needs its own discovery first).

## Roles (owner ruling 2026-07-16)

The orchestrator (top session) holds the frame, walls, metric reads, and adjudication.
**All implementation — repairs, verification runs, fixes — is dispatched to subagents**
(`hunter` for code, per this repo's tribe convention). Workers hand back at unknowns; they do
not widen scope or self-certify.
