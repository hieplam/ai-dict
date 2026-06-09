# SonarQube Cloud integration — design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)
**Branch:** `feat/sonarqube-cloud`

## Goal

Add **SonarQube Cloud** static analysis (bugs, code smells, security hotspots,
duplication) to this public repo, wired into CI with test coverage, and seed a
**one-time backlog of GitHub Issues** from the first scan's findings so existing
problems can be worked through. The repo has never been scanned before.

## Why SonarQube Cloud (not self-hosted Community Edition)

This repo is **public**, so SonarQube Cloud is free _and_ includes PR/branch
analysis — the paid-tier feature on the self-hosted side. Cloud also needs no
server to host or maintain. Self-hosted Community Edition would cost $0 in
licence but require an always-on server and still lacks PR decoration without an
unofficial plugin. For a public repo, Cloud strictly dominates.

## Decisions (locked with the user)

| #   | Decision                   | Choice                                                                           |
| --- | -------------------------- | -------------------------------------------------------------------------------- |
| 1   | Analysis mode              | **CI-based with coverage** (scanner runs in GitHub Actions, uploads Vitest lcov) |
| 2   | Quality Gate strictness    | **Block the PR** — the Sonar job fails when the gate fails                       |
| 3   | Findings → GitHub tracking | **One-time backlog → GitHub Issues** (manual trigger, filtered, deduped)         |
| 4   | Backlog filter             | **Bugs + Vulnerabilities + Security Hotspots, severity ≥ Major**                 |
| 5   | Sonar host                 | `https://sonarcloud.io/api`, overridable via env var                             |

## Architecture

The work splits into a **repo half** (this PR) and a **dashboard half** (manual
steps only the repo owner can do — they need a GitHub login and produce the
`SONAR_TOKEN` secret). The repo half is inert until the dashboard half is done.

Two layers, in dependency order. **Part B depends on Part A** having scanned the
project at least once (the issues API returns nothing before a first analysis).

```
Part A: base scan + coverage  ──►  Sonar dashboard has findings  ──►  Part B: backlog → GitHub Issues
        (every push/PR)                                                  (manual, one-time)
```

### Part A — base scan + coverage

**A1. lcov coverage reporter (3 files)**

The three test packages run v8 coverage but Vitest's default reporters don't
include `lcov`, which Sonar needs. Add `lcov` (keeping `text` for the CI log
summary) to each package's `vitest.config.ts`:

- `packages/app/vitest.config.ts`
- `packages/extension-chrome/vitest.config.ts`
- `packages/extension-safari/vitest.config.ts`

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],   // ← added; 'text' keeps the CI summary
  // ...existing include / exclude / thresholds unchanged
}
```

Each package then emits `packages/<pkg>/coverage/lcov.info`.

**A2. `sonar-project.properties` (new, repo root)**

```properties
sonar.organization=hieplam
sonar.projectKey=hieplam_ai-dict
# Sources: production code only (the three packages' src dirs)
sonar.sources=packages/app/src,packages/extension-chrome/src,packages/extension-safari/src
# Test files (co-located in src AND in test/ dirs) are classified as tests
sonar.tests=packages/app/test,packages/extension-chrome/test,packages/extension-safari/test
sonar.test.inclusions=**/*.test.ts
# Keep src/*.test.ts out of the MAIN source set so Sonar never indexes a file
# as both source and test (that overlap is a hard "indexed twice" error)
sonar.exclusions=**/*.test.ts,**/dist/**,**/*.d.ts
# Coverage — three lcov files, comma-separated
sonar.javascript.lcov.reportPaths=packages/app/coverage/lcov.info,packages/extension-chrome/coverage/lcov.info,packages/extension-safari/coverage/lcov.info
```

> `organization` / `projectKey` use SonarQube Cloud's default `<org>_<repo>`
> naming. The user confirms the exact values after importing the repo and
> adjusts this file if they differ.
>
> **Source/test partition** is the one part to verify in the first scan: `src`
> is the main source set, `*.test.ts` is excluded from it (via `sonar.exclusions`)
> and re-classified as test code. If the first analysis still reports an
> "indexed twice" or overlap error, narrow `sonar.tests` / `sonar.exclusions`
> until the partition is clean — this is expected one-time tuning, not a redesign.

**A3. `sonarcloud` job in `.github/workflows/ci.yml` (new job)**

Folded into the existing `ci.yml` for consistency with every other gate (same
bun-setup + cache pattern). Sequence:

1. `actions/checkout` with **`fetch-depth: 0`** — Sonar needs full git history
   for accurate new-code detection and blame.
2. setup-bun + cache + `bun install --frozen-lockfile` (matches sibling jobs).
3. Generate lcov coverage **non-blocking within this job** — the dedicated
   `coverage-gate` job remains the threshold enforcer; this job must still
   produce lcov even if a package is under threshold. Concretely, run
   `bun run --filter '*' test -- --coverage || true` so a threshold miss never
   prevents the lcov files from being written and the scan from running.
   Genuine test failures are still caught (and block the PR) by the existing
   `test-unit` / `test-component` / `test-contract` jobs, so swallowing this
   job's exit code loses no real signal.
4. `SonarSource/sonarqube-scan-action@<pinned-sha>` with
   `args: -Dsonar.qualitygate.wait=true`, env `SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}`.
   `qualitygate.wait=true` makes the scanner block until the gate resolves and
   **fail the job if the gate fails** → the red check blocks the PR (once the
   check is marked required — a dashboard-side step).

Action SHAs are pinned to match the repo's existing convention (every `uses:` in
`ci.yml` is pinned to a commit SHA with a version comment).

### Part B — one-time backlog importer

**B1. `scripts/sonar-issues.mjs` (new) — dependency-free Bun script**

Pulls findings from **two** Sonar Web API endpoints (they are distinct entities):

- `GET {host}/api/issues/search` — `componentKeys=<projectKey>`,
  `types=BUG,VULNERABILITY`, `severities=MAJOR,CRITICAL,BLOCKER`,
  `resolved=false`, paginated (`ps=500`).
- `GET {host}/api/hotspots/search` — `projectKey=<projectKey>`,
  `status=TO_REVIEW`, paginated.

Auth: `Authorization: Bearer ${SONAR_TOKEN}`. Host from `SONAR_HOST_URL`
(default `https://sonarcloud.io`).

For each finding it builds a GitHub issue:

- **Title:** `[Sonar][<TYPE>] <message> (<file>:<line>)`
- **Body:** rule key, severity, a permalink to the file at the scanned commit, a
  link back to the finding in Sonar, and a **hidden dedup marker**
  `<!-- sonar-key: <issueKey> -->`.
- **Labels:** `sonarqube` + a type label (`bug` / `vulnerability` /
  `security-hotspot`); created if missing.

**Dedup:** before creating, list existing issues labelled `sonarqube` (any
state), parse their `sonar-key` markers, and skip findings whose key already has
an issue. Re-running is therefore idempotent — no duplicates.

**Create-only (deliberate scope guardrail):** the importer does **not** auto-close
GitHub issues when Sonar later resolves a finding. That lifecycle sync is the
expensive, high-maintenance part the user explicitly opted out of by choosing
"one-time / low-maintenance". You close issues as you fix them; re-running never
resurrects a closed one (dedup matches on key regardless of state).

**`--dry-run` flag:** prints the issues it _would_ create without calling the
GitHub API — used for local verification before the token/scan exist.

GitHub writes use the REST API with the built-in `GITHUB_TOKEN` (no extra
dependency); the workflow grants `issues: write`.

**B2. `.github/workflows/sonar-backlog-to-issues.yml` (new)**

`workflow_dispatch` (manual) only. Permissions: `issues: write`,
`contents: read`. Steps: checkout → setup-bun → `bun scripts/sonar-issues.mjs`,
env `SONAR_TOKEN`, `GITHUB_TOKEN`, `SONAR_HOST_URL`, project key.

## C3 architecture note

Per `.c3/code-map.yaml`, every file this change touches or adds lies **outside**
the C3 component model (the model tracks `src`/`test` files; it does not own
`vitest.config.ts`, `ci.yml`, root config, or `scripts/`). No rule-governed path
is affected — `rule-domain-purity` (`domain/**`), `rule-sanitize-model-output`
(`markdown-sanitize.ts`), `rule-api-key-isolation`, `rule-gate-runtime-messages`,
and `rule-typed-errors` all scope to source paths left untouched. This change
crosses no component boundaries and triggers no C3 rule. Secrets (`SONAR_TOKEN`)
live only in GitHub Actions secrets, never committed — consistent with the
repo's gitleaks posture and the spirit of `rule-api-key-isolation`.

## Testing strategy

The importer's logic is structured for unit testing without live credentials:

- **Pure mapping** `sonarFindingToIssue(finding)` → `{ title, body, labels }`,
  covering both issue and hotspot shapes, the dedup marker, and severity/type
  labelling.
- **Dedup filter** `filterNewFindings(findings, existingKeys)` → only findings
  whose key is absent.

These get Vitest unit tests (fits the repo's TDD culture) and provide real
green-tests evidence. The network/GitHub I/O is a thin shell around these pure
functions and is exercised manually via `--dry-run`.

The script lives in `scripts/` with a co-located `scripts/sonar-issues.test.ts`.
The root `vitest.config.ts` currently discovers projects from `packages/*` only,
so it gets one small extension: also register `scripts` as a project (a
`scripts/vitest.config.ts` with a `node` environment) so the test runs under the
existing `bun run test`. This keeps the importer's tests in the standard suite
with no new top-level test command.

## Evidence plan (per CLAUDE.md Before/After)

- **Part A:** local proof of lcov generation — Before: no `coverage/lcov.info`;
  After: `bun run test -- --coverage` produces lcov for all three packages
  (screenshot/terminal capture in the PR).
- **Part B:** green Vitest run of the mapping/dedup unit tests, plus a
  `--dry-run` sample of issues the importer would open.
- A live green Sonar check and real created issues can only be shown **after**
  the user completes the dashboard checklist (token + first scan); noted in the
  PR as a follow-up the owner performs.
- Evidence assets, if binary, hosted on a throwaway `pr-assets/<slug>` branch and
  referenced by `github.com/.../raw/...` URLs. This repo is public, so the
  same-origin-cookie requirement from CLAUDE.md does not strictly apply, but the
  `github.com/.../raw/...` convention is kept for consistency.

## User dashboard checklist (manual — cannot be automated)

1. Sign in to **sonarqube.io** (SonarQube Cloud) with GitHub; bind the `hieplam`
   org and **import** the `ai-dict` repo.
2. In the project, **turn OFF Automatic Analysis** (Analysis Method → CI) — else
   it conflicts with the CI scanner.
3. Generate a token → add as the GitHub Actions secret **`SONAR_TOKEN`**.
4. Confirm the `organization` / `projectKey` in `sonar-project.properties` match
   the imported project; adjust if different.
5. After the first green `sonarcloud` run, mark the **`sonarcloud` check as
   Required** in branch protection for `main` — this is what actually enforces
   the PR block.
6. (When ready to seed the backlog) run the **"sonar-backlog-to-issues"**
   workflow manually from the Actions tab.

## Known risks

- **Monorepo lcov path mapping** — Sonar must resolve each lcov's `SF:` paths
  against the repo root. v8 may emit absolute or package-relative paths.
  _Mitigation:_ verify coverage appears in a real scan / inspect lcov paths
  during implementation; if they don't map, normalise paths or set per-module
  base dirs before opening the PR.
- **First-scan noise** — a never-scanned codebase can surface many findings; the
  ≥ Major Bug/Vuln/Hotspot filter bounds the backlog. If still large, tighten to
  `CRITICAL,BLOCKER` at run time.
- **Gate blocks day-one** — the default Quality Gate may flag pre-existing issues
  on the first PR. Accepted by the user (chose "block"); tune the gate in the
  dashboard if needed.

## Out of scope (YAGNI)

- Continuous finding↔issue lifecycle sync (auto-close on resolve).
- SARIF export to GitHub Code Scanning.
- Coverage for packages without tests (`core`, `adapters-shared`, `shared-ui`).
- Changing existing coverage thresholds or other CI gates.
