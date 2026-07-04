# Handoff — Anthropic provider + fallback pool (PR #89)

**Read this first when continuing on another machine.** It is self-contained.
Plan of record: [`../superpowers/plans/2026-07-03-anthropic-provider-fallback-pool.md`](../superpowers/plans/2026-07-03-anthropic-provider-fallback-pool.md).

Snapshot: 2026-07-04 · branch `feat/anthropic-provider-pool` · [PR #89](https://github.com/hieplam/ai-dict/pull/89).

## Where we are

- ✅ **Feature complete and merged to `master`.** Anthropic (Claude) is a third
  lookup provider behind a silent any-failure fallback pool; the card shows a
  provider badge, a subtle fallback note, and a one-shot manual provider picker.
- ✅ **14 / 15 CI checks green** on the merged commit: typecheck, lint,
  format-check, knip, secret-scan, dep-audit, unit/component/contract tests,
  coverage-gate, build-chrome, build-safari, e2e-chrome.
- ✅ **Adversarial review PASS** against the plan + C3 rules (S1 key isolation,
  typed errors, wire-schema strictObject, domain purity).
- ⚠️ **One check is red and was accepted at merge: `sonarcloud`.** It fails on a
  single condition — see below. There is no branch protection on `master`, so the
  squash-merge proceeded with this known, intentional debt.

## The one open item — SonarCloud new-code duplication

SonarCloud quality gate = ERROR on exactly one condition (all others pass):

| Metric                             | Actual   | Threshold | Status    |
| ---------------------------------- | -------- | --------- | --------- |
| `new_coverage`                     | 96.6%    | ≥ 80%     | OK        |
| `new_reliability_rating`           | A        | A         | OK        |
| `new_security_rating`              | A        | A         | OK        |
| `new_maintainability_rating`       | A        | A         | OK        |
| `new_security_hotspots_reviewed`   | 100%     | 100%      | OK        |
| **`new_duplicated_lines_density`** | **4.7%** | **≤ 3%**  | **ERROR** |

**Why:** `packages/app/src/app/anthropic-lookup-client.ts` was created (per the plan)
by copying `openai-lookup-client.ts` structure verbatim — the same near-duplicate
shape the existing Gemini/OpenAI clients already share. SonarCloud measures the new
Anthropic file's lines as duplicating the OpenAI file.

Query the live gate any time:

```
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=hieplam_ai-dict&pullRequest=<PR#>" | python3 -m json.tool
```

## Do this next — dedupe follow-up (separate PR off `master`)

Goal: pull the shared HTTP skeleton out of the OpenAI + Anthropic clients so
`new_duplicated_lines_density` drops under 3%, then delete this open item.

1. **New worktree off latest `master`:** `git worktree add .claude/worktrees/provider-client-dedupe -b refactor/provider-client-dedupe origin/master`.
2. **Extract a shared helper** (e.g. `packages/app/src/app/http-lookup-client.ts`)
   holding the identical parts of `openai-lookup-client.ts` and
   `anthropic-lookup-client.ts`:
   - `rejectWith(e: LookupError): never` and `isThrownLookupError(e)`.
   - the AbortController + caller-signal wiring, the timeout timer/`timedOut` flag,
     the `try/catch/finally`, and the final unreachable `rejectWith`.
   - Inject the per-provider bits: `endpoint`, `headers(apiKey)`, `body(prompt, model)`,
     `parseOk(json) → string | undefined`, `parseErr(json) → { vendorStatus?, vendorMessage? }`,
     and the `provider` literal.
   - **S1 (rule-api-key-isolation): the key stays header-only** — pass it into the
     `headers()` builder; never into URL/body/logs.
   - **rule-typed-errors:** keep throwing `Object.assign(new Error(msg), lookupError)`.
3. **Re-point both clients** at the helper; keep their public deps
   (`OpenAIDeps` / `AnthropicDeps`) and default models
   (`gpt-4o-mini`, `claude-haiku-4-5-20251001`) unchanged.
4. **Gates:** `bun run lint && bun run format:check && bun run typecheck && bun run test && bun run build:chrome`, then `cd packages/extension-chrome && bunx playwright test provider-fallback`. The existing
   `openai-lookup-client.test.ts` / `anthropic-lookup-client.test.ts` must stay green
   untouched (they are the behavioural contract for the extraction).
5. **Confirm the gate clears:** open the PR, wait for `sonarcloud`, re-query the API
   above — `new_duplicated_lines_density` must be ≤ 3%.

## Gotchas / lessons

- **CI runs the PR _merge_ commit** (branch + latest `master`), not the branch head.
  A stale branch can go red on files it never touched (here: master's 1.7.1
  `manifest.json` + a landing-page plan doc failed prettier). Fix = merge `master`
  in, run `bun run format:check` locally, `prettier --write` the offenders.
- **Model id** is pinned to `claude-haiku-4-5-20251001` (ADR line 17). The bare
  `claude-haiku-4-5` alias is not used anywhere in code.
- **Evidence:** PR before/after assets live on the throwaway branch
  `pr-assets/anthropic-provider-pool`.
