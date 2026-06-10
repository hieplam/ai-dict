---
id: adr-20260610-dep-direction-build-gate
c3-seal: c77f0b26734f4b9590420dcd5faecb315ffb3f09fe41e9f6e7b0b480ea08b3ee
title: dep-direction-build-gate
type: adr
goal: 'Make the inward-only import dependency direction (`ref-core-dependency-rule`) mechanically enforced instead of convention-upheld: add a dependency-free checker script that fails with actionable errors on any import whose direction violates the documented matrix, run it as a hard gate **before every extension build** and at the front of `bun run lint`, and repoint the stale `import-x/no-restricted-paths` ESLint zones (documented as Known drift in `rule-domain-purity`) at the real post-flatten paths.'
status: implemented
date: "2026-06-10"
---

## Goal

Make the inward-only import dependency direction (`ref-core-dependency-rule`) mechanically enforced instead of convention-upheld: add a dependency-free checker script that fails with actionable errors on any import whose direction violates the documented matrix, run it as a hard gate **before every extension build** and at the front of `bun run lint`, and repoint the stale `import-x/no-restricted-paths` ESLint zones (documented as Known drift in `rule-domain-purity`) at the real post-flatten paths.

## Context

The architecture's load-bearing constraint is the lean dependency rule: `packages/app/src/domain/**` imports only its own files and `../ports`; `ports.ts` imports only domain types; nothing in `packages/app` may import an extension shell; the two shells never import each other. Today this is upheld **only by convention**: `eslint.config.mjs` still targets the pre-flatten paths (`packages/core/src`, `packages/adapters-shared`, `packages/shared-ui`) which no longer hold source, so the zones match nothing — this gap is documented as "Known drift" in `rule-domain-purity`. Nothing stops a code change (human or LLM) from adding `import { z } from 'zod'` inside `domain/` or importing a shell from the core; it would compile, pass lint, and ship. The user's explicit requirement: a hard gate that triggers before build, stops on failure, and prints the violated rule so an LLM agent cannot proceed in the wrong direction. Constraints: bun-only toolchain (no Node assumption beyond bun's runtime), no new npm dependencies, must pass on today's clean tree, and CI (`ci.yml` lint / build-chrome / build-safari / e2e jobs) must inherit the gate without workflow edits.

## Decision

Two reinforcing layers, both wired into paths that already run:

1. **`scripts/check-dep-direction.mjs`** — a small dependency-free checker (regex import extraction + path resolution, no AST, no npm deps) that walks `packages/app/src/**` and `packages/extension-*/src/**` and enforces an explicit allowlist matrix: domain → {domain, ../ports} only; `ports.ts` → domain types only; `wire.ts` → {domain, zod} only; all of `packages/app` → never resolves outside the package and never names `@ai-dict/extension-*`; each shell → never imports the sibling shell. On violation it prints `file:line`, the offending specifier, the named rule (`rule-domain-purity` / `ref-core-dependency-rule`), and the fix hint ("declare a port in ports.ts and inject an adapter"), then exits 1. It becomes the first command of both extension `build` scripts (`bun ../../scripts/check-dep-direction.mjs && bun esbuild.config.mjs`) so **no bundle can be produced from a violating tree**, and the first command of root `lint` so the CI lint job gates PRs even when no build runs. Logic is exported as pure functions and unit-tested under the existing `scripts/` vitest project.
2. **ESLint zones repointed** at `packages/app/src/{domain,app,ui}` and the extension packages, restoring IDE-time feedback and closing the Known-drift item; the dead `packages/shared-ui` type-only block is deleted.

A script wins over ESLint-only because `no-restricted-paths` is denylist-shaped (cannot express "domain imports *nothing* except these two targets", so a new npm import inside domain would slip through) and because the build scripts must gate even if someone runs `bun esbuild.config.mjs`'s wrapper directly without lint. ESLint is kept because it gives in-editor red squiggles the script cannot.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-1 | container | The allowlist matrix encodes this container's internal layer boundaries (domain / ports / wire / app / ui) | Verify matrix matches the container's documented component boundaries; no source changes |
| c3-2 | container | packages/extension-chrome/package.json build script gains the pre-build gate | Confirm build still produces identical dist; gate runs before esbuild |
| c3-3 | container | packages/extension-safari/package.json build script gains the pre-build gate | Confirm build still produces identical dist; gate runs before esbuild |
| c3-0 | system | Root package.json lint script and eslint.config.mjs zones change; new scripts/check-dep-direction.mjs tooling | c3 check after doc updates; rule-domain-purity Known-drift paragraph rewritten |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-core-dependency-rule | The checker is the mechanical enforcement of exactly this ref's one-directional rule; the matrix must match its text | comply |
| ref-dependency-injection | The checker's fix-hint message ("declare a port, inject an adapter") must point violators at this pattern | comply |
| ref-wire-protocol-validation | wire.ts allowlist (domain + zod) must not contradict wire.ts's documented role as the zod edge | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-domain-purity | Its "Known drift" paragraph documents the stale ESLint zones this ADR fixes, and the checker's domain allowlist must match its scope line (domain/** only; wire.ts and app/** exempt as edge); after merge the rule is lint-AND-build enforced, so the body must be updated | update-rule |
| rule-typed-errors | Checker is repo tooling (Node script), not domain code — typed-error envelope does not apply; plain exit-1 with formatted report | N.A - tooling script outside the domain error envelope |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| scripts/check-dep-direction.mjs | New checker: walk, extract imports (static/dynamic/export-from), resolve, evaluate allowlist matrix, format violations, exit 1 | File exists; bun scripts/check-dep-direction.mjs exits 0 on clean tree |
| scripts/check-dep-direction.test.ts | Unit tests for extraction + each matrix rule (violating and conforming cases) plus a whole-repo integration test | bun run test scripts project green |
| packages/extension-chrome/package.json | build → bun ../../scripts/check-dep-direction.mjs && bun esbuild.config.mjs | Violating import makes bun run build:chrome fail before esbuild |
| packages/extension-safari/package.json | Same pre-build gate | Same failure mode for safari build |
| package.json (root) | lint → bun scripts/check-dep-direction.mjs && eslint .; add standalone check:deps script | CI lint job inherits gate with no workflow edit |
| eslint.config.mjs | Repoint zones to packages/app/src/{domain,app,ui} + shells; drop dead shared-ui block | bun run lint green; temporary violation shows eslint error |
| rule-domain-purity | Rewrite Known-drift paragraph: enforcement now lint + pre-build script | c3 read rule-domain-purity shows updated body; c3 check green |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI surface changes | This ADR changes repo tooling and C3 content (rule body via c3 write), not the c3x CLI, validators, schemas, or templates | N.A - content-only; c3 check green after writes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run --filter @ai-dict/extension-chrome build (and safari) | Checker runs first; non-zero exit aborts before esbuild — no dist from a violating tree | Manual: inject import 'zod' into domain/, build fails with rule message |
| bun run lint (local + CI lint job) | Checker runs before eslint; PRs blocked on violation | CI lint job log shows checker pass line |
| ESLint import-x/no-restricted-paths (repointed) | IDE-time + lint-time denial of cross-layer imports | Temporary violation produces eslint error |
| scripts/check-dep-direction.test.ts | Locks the matrix itself: each rule has a violating fixture; whole-repo scan asserted clean | bun run test green |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| ESLint zones only (no script) | no-restricted-paths is denylist-shaped: cannot express domain's allowlist ("nothing except ./ and ../ports"), so a new npm import inside domain/ passes; also lint is not in the build path, so bun run build:chrome would still bundle a violating tree |
| dependency-cruiser npm package | Adds a dependency + config DSL to a repo whose constraint set is five allowlist lines; bun-only repo keeps tooling lean (same judgment that flattened the hexagon as overengineered) |
| TypeScript project references to wall off layers | Repo deliberately flattened to one @ai-dict/app package; re-introducing intra-package compilation walls reverses the documented flatten decision (ref-core-dependency-rule "Why") |
| Git pre-commit hook only | Hooks are bypassable (--no-verify, as this repo itself does for asset commits) and don't run in CI builds; the user asked for a build gate |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Regex import extraction misses an exotic form (multi-line import, template specifier) | Extraction handles static, import type, export … from, side-effect, and dynamic import() across joined source; unit tests cover each form; multi-line handled by scanning whole text not lines | Extraction unit tests green |
| False positive blocks a legitimate build | Matrix derived from the actual current import graph (verified clean today); allowlist failures name the exact rule so the fix is obvious; escape = fix the import, not bypass | Whole-repo integration test asserts zero violations on master |
| Checker and ESLint matrices drift apart | Both derive from the same documented rules; rule-domain-purity body names both surfaces so a future change must touch both | c3 read rule-domain-purity lists both enforcement surfaces |
| Build script path breaks if scripts/ moves | Path is relative (../../scripts/) and exercised by every CI build job — breakage is loud and immediate | CI build-chrome / build-safari jobs green |

## Verification

| Check | Result |
| --- | --- |
| bun scripts/check-dep-direction.mjs on clean tree | exit 0, "no violations" summary |
| bun run test (scripts project) | all checker unit + integration tests pass |
| Inject import { z } from 'zod' into packages/app/src/domain/types.ts, run bun run --filter @ai-dict/extension-chrome build | exits non-zero BEFORE esbuild, names rule-domain-purity and the fix hint; revert restores green |
| bun run lint | checker passes, then eslint passes with repointed zones |
| bun run typecheck && bun run test full suite | green |
| c3 check | no issues after rule-domain-purity update |
