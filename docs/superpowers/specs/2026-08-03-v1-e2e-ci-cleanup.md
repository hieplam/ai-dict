# V1 — e2e & CI cleanup (verification-loop campaign, card 1)

**Goal (measurable):** every e2e spec that runs in CI carries real assertions; CI contains no
job that is a duplicate, a silent no-op, or driven by a dead flag. Proof: the deleted files are
gone, `bun run e2e:chrome` and the full CI pipeline are green, and no `PLAYWRIGHT_RUN_LOOKUP_E2E`
reference remains anywhere in the repo.

**Why:** an audit (2026-08-02) found 4 near-assertion-free screenshot/demo specs running on every
CI push (contradicting the owner's 2026-07-16 retired-media-evidence ruling), 10 permanently
skipped per-card evidence specs, a dead env flag, a CI job (`test-component`) that byte-for-byte
duplicates `test-unit` under a misleading name, and a SonarCloud job that silently passes green
when `SONAR_TOKEN` is unset. All decisions below were ratified by the owner on 2026-08-02/03.

## Ratified decisions (scope fence — do exactly this, nothing more)

Delete these 10 spec files from `packages/extension-chrome/e2e/`:

- `evidence.spec.ts`, `context-bank-demo.spec.ts`, `define-fix-demo.spec.ts` (always-run demo/screenshot specs)
- `a4-evidence.spec.ts`, `a8-evidence.spec.ts`, `a16-evidence.spec.ts`, `b1-evidence.spec.ts`,
  `b2-evidence.spec.ts`, `b5-evidence.spec.ts`, `b7-evidence.spec.ts` (env-gated per-card evidence, purpose served)

Keep but env-gate: `readme-demo.spec.ts` — add a `test.skip(!process.env.PLAYWRIGHT_RUN_README_DEMO, ...)`
guard following the exact pattern the surviving asset regenerators use (`media-kit.spec.ts`,
`media-demos.spec.ts`, `store-screenshots.spec.ts` — keep all three unchanged).

`.github/workflows/ci.yml`:

- Remove the `PLAYWRIGHT_RUN_LOOKUP_E2E=1` env line (no spec reads it — verified dead).
- Delete the `test-component` job entirely (same command as `test-unit`); fix any `needs:` references.
- Delete the `sonarcloud` job entirely; fix any `needs:` references.
- Do NOT touch `dep-audit` — its advisory-on-PR/blocking-nightly split is a ratified deliberate choice.

## Out of scope

New tests, hard-rule scanners, doc updates (cards V2–V5). If a deleted spec turns out to be
imported/referenced by a helper, remove the dead reference too — but do not refactor helpers.

## Acceptance

1. `git grep -l "PLAYWRIGHT_RUN_LOOKUP_E2E"` → empty.
2. `bun run build:chrome:e2e && bun run e2e:chrome` green locally.
3. CI green on the PR with `test-component` and `sonarcloud` absent from the run.
4. PR body carries a "Testing performed" section (suites, counts, gates) per repo convention.
