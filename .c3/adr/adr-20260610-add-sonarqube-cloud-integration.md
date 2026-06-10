---
id: adr-20260610-add-sonarqube-cloud-integration
c3-seal: 5cce82e7c93b5760b8849001ff00954c87c7b7cd10d170e811ec2fb0e48b28bc
title: add-sonarqube-cloud-integration
type: adr
goal: Wire SonarQube Cloud static analysis (bugs, code smells, security hotspots, duplication) into this public repo's CI with Vitest lcov coverage from all three test packages, make the quality gate block PRs, and add a manually-triggered, one-time importer that seeds a GitHub Issues backlog from the first scan's findings (Bugs + Vulnerabilities + Security Hotspots, severity ≥ Major). Implements the approved spec `docs/superpowers/specs/2026-06-09-sonarqube-cloud-integration-design.md`.
status: implemented
date: "2026-06-10"
---

# Add SonarQube Cloud integration

## Goal

Wire SonarQube Cloud static analysis (bugs, code smells, security hotspots, duplication) into this public repo's CI with Vitest lcov coverage from all three test packages, make the quality gate block PRs, and add a manually-triggered, one-time importer that seeds a GitHub Issues backlog from the first scan's findings (Bugs + Vulnerabilities + Security Hotspots, severity ≥ Major). Implements the approved spec `docs/superpowers/specs/2026-06-09-sonarqube-cloud-integration-design.md`.

## Context

The repo has never been scanned by any static-analysis service. It is a public GitHub repo (`hieplam/ai-dict`, verified `visibility: PUBLIC`), so SonarQube Cloud is free and includes PR/branch analysis. CI lives in a single `.github/workflows/ci.yml` (bun-based, every action pinned to a commit SHA). The three test packages (`app`, `extension-chrome`, `extension-safari`) run v8 coverage but emit no lcov, which Sonar requires. Every file this change touches — `packages/*/vitest.config.ts`, root `vitest.config.ts`, `.github/workflows/ci.yml`, new `sonar-project.properties`, new `scripts/sonar-issues.mjs` + test, new `.github/workflows/sonar-backlog-to-issues.yml`, `eslint.config.mjs` — is **outside the C3 code map** (verified via `c3 lookup` on each path: no matches; the model tracks `src`/`test` only). The repo half implemented here is inert until the owner completes dashboard-side steps (import project, disable Automatic Analysis, add `SONAR_TOKEN` secret).

## Decision

CI-based analysis folded into the existing `ci.yml` as a `sonarcloud` job (same bun-setup/cache pattern, `fetch-depth: 0`, `SonarSource/sonarqube-scan-action` pinned by SHA, `-Dsonar.qualitygate.wait=true` so a failing gate fails the job and blocks the PR once the check is required). Coverage comes from adding the `lcov` reporter (keeping `text`) to the three package vitest configs; lcov generation inside the sonarcloud job is non-blocking (`|| true`) because the dedicated `coverage-gate` job already enforces thresholds and genuine test failures are caught by `test-unit`/`test-component`/`test-contract`. A root `sonar-project.properties` partitions sources vs tests (`*.test.ts` excluded from main and re-classified as tests) to avoid Sonar's indexed-twice error. The backlog importer is a dependency-free Bun script `scripts/sonar-issues.mjs` whose mapping (`sonarFindingToIssue`) and dedup (`filterNewFindings`) logic are pure exported functions with co-located Vitest unit tests (`scripts/sonar-issues.test.ts`, registered as a `scripts` Vitest project); it dedups via a hidden `<!-- sonar-key: ... -->` marker so re-runs are idempotent, is create-only (no lifecycle sync, per the user's locked decision), and runs only via a manual `workflow_dispatch` workflow with `issues: write`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| N.A - no C3 entity affected: all touched files are build/CI/tooling infrastructure outside the code map (c3 lookup returned no matches for every path) | N.A - uncharted by design | N.A - the component model scopes to src/test source paths, none of which change | N.A - coverage gap is deliberate; recorded here as ownership evidence per Parent Delta rule |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| N.A - no ref governs the touched paths (c3 lookup on all seven files returned zero refs; refs scope to core/adapter/UI source) | N.A | N.A |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-api-key-isolation | The change introduces a new secret (SONAR_TOKEN). The rule's letter scopes to the Gemini API key in extension storage, but its spirit — secrets never committed, never readable outside their isolation boundary — applies to CI secrets. | review — comply in spirit: token lives only in GitHub Actions secrets, referenced as ${{ secrets.SONAR_TOKEN }}; nothing committed; existing gitleaks secret-scan job continues to enforce |
| N.A - remaining rules (rule-domain-purity, rule-sanitize-model-output, rule-gate-runtime-messages, rule-typed-errors) all scope to source paths (domain/**, markdown-sanitize.ts, service-worker routers) that this change does not touch | N.A - out of scope | N.A - no action |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Coverage reporters | Add reporter: ['text', 'lcov'] to coverage in packages/app/vitest.config.ts, packages/extension-chrome/vitest.config.ts, packages/extension-safari/vitest.config.ts (thresholds/include/exclude unchanged) | bun run --filter '*' test -- --coverage emits packages/<pkg>/coverage/lcov.info ×3 |
| Sonar config | New root sonar-project.properties: org hieplam, key hieplam_ai-dict, sources = three src dirs, tests = three test dirs, sonar.test.inclusions=/*.test.ts, sonar.exclusions=/.test.ts,/dist/,**/.d.ts, three lcov report paths | file present; first-scan tuning documented in spec |
| CI scan job | New sonarcloud job in .github/workflows/ci.yml: checkout fetch-depth: 0, bun setup + cache (sibling-job pattern), non-blocking coverage run, SonarSource/sonarqube-scan-action pinned to commit SHA with -Dsonar.qualitygate.wait=true, env SONAR_TOKEN | job YAML matches sibling pin/cache conventions |
| Backlog importer | New scripts/sonar-issues.mjs: fetches api/issues/search (BUG,VULNERABILITY; MAJOR,CRITICAL,BLOCKER; unresolved; paginated) + api/hotspots/search (TO_REVIEW; paginated), Bearer auth, host from SONAR_HOST_URL default https://sonarcloud.io; pure exported sonarFindingToIssue / filterNewFindings; --dry-run flag; GitHub writes via REST + GITHUB_TOKEN | unit tests green; --dry-run sample output |
| Importer tests | New scripts/sonar-issues.test.ts (mapping both finding shapes, dedup marker, labels, dedup filter) + scripts/vitest.config.ts (node env, name scripts); root vitest.config.ts registers scripts as an additional project | bun run test includes and passes the scripts project |
| Backlog workflow | New .github/workflows/sonar-backlog-to-issues.yml: workflow_dispatch only, issues: write / contents: read, checkout → setup-bun → bun scripts/sonar-issues.mjs with SONAR_TOKEN/GITHUB_TOKEN/SONAR_HOST_URL | workflow file present, actions pinned |
| Lint accommodation | eslint.config.mjs: add scripts/.ts to projectService.allowDefaultProject; add fetch to the Node-globals block for scripts/**/.mjs | bun run lint green |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI command, validator, schema, hint, template, or test surface is touched; this is an application-repo change documented via this ADR only | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| scripts/sonar-issues.test.ts via root bun run test | Pure mapping/dedup logic regression-tested in the standard suite | green Vitest run |
| sonarcloud CI job | Fails the PR check when the Sonar quality gate fails (qualitygate.wait=true); inert until SONAR_TOKEN exists | job definition in ci.yml |
| Existing coverage-gate job | Remains the per-package threshold enforcer; lcov addition does not alter thresholds | unchanged ci.yml job |
| Existing secret-scan (gitleaks) job | Catches any accidentally committed token | unchanged ci.yml job |
| knip job | scripts/*.mjs already registered as entry — importer cannot become dead code silently | knip.json root workspace |
| lint / format-check jobs | New script/test/config files conform to repo style | green CI |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Self-hosted SonarQube Community Edition | $0 licence but needs an always-on server and lacks PR decoration without an unofficial plugin; this repo is public so Cloud is free and includes PR analysis — Cloud strictly dominates |
| Separate standalone workflow for the scan | Every other gate lives in ci.yml with the shared bun-setup/cache pattern; a separate file would duplicate that and fragment the required-checks story |
| Continuous finding↔issue lifecycle sync (auto-close) | The user explicitly chose one-time/low-maintenance backlog; lifecycle sync is the expensive half and stays out of scope |
| SARIF export to GitHub Code Scanning | YAGNI per spec; Sonar dashboard + PR decoration already covers triage |
| Blocking coverage run inside the sonarcloud job | A threshold miss would mask the scan entirely; thresholds are already enforced by coverage-gate, real test failures by the test jobs — duplicating the gate here only loses scan signal |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Monorepo lcov SF: paths don't resolve against repo root, coverage shows 0% | Inspect generated lcov.info paths during implementation; if package-relative, normalise paths in the CI step before scanning | local bun run --filter '*' test -- --coverage then inspect SF: lines in all three lcov files |
| First scan floods the backlog | Importer filters to Bugs/Vulns/Hotspots ≥ Major; can tighten to CRITICAL,BLOCKER at run time via flag/env | --dry-run count before real run |
| Quality gate blocks day-one PRs on pre-existing issues | Accepted by user (chose "block"); gate tunable in the Sonar dashboard | first live scan after owner adds token |
|  |  | true on coverage swallows real test failures inside the sonarcloud job |
| Importer creates duplicate issues on re-run | Dedup via hidden <!-- sonar-key: <key> --> marker matched against all existing sonarqube-labelled issues (any state) | unit test for filterNewFindings + idempotency test |

## Verification

| Check | Result |
| --- | --- |
| bun run test (root, includes new scripts project) | all projects green |
| bun run --filter '*' test -- --coverage | coverage/lcov.info exists in all three packages; SF: paths inspected |
| bun scripts/sonar-issues.mjs --dry-run against a local stub Sonar API | prints planned issues, makes no GitHub API calls |
| bun run lint && bun run format:check && bun run typecheck | green |
| c3 check | no issues after ADR lifecycle updates |
