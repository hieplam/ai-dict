---
paths:
  - 'packages/app/src/domain/**/*.ts'
---

# domain-purity

Keep the domain core inward-only so it stays portable and unit-testable.
Canonical rule: `.c3/rules/rule-domain-purity.md` (+ `ref-core-dependency-rule`). Mechanically gated by `scripts/check-dep-direction.mjs` and ESLint `import-x/no-restricted-paths`.

## NEVER

- `chrome.*`, `fetch`, or DOM access inside `domain/`.
- Import `ui/`, `app/`, `wire.ts`, or any npm library into `domain/`.

## Module boundaries

- Import only from `./` (domain) and `../ports`.
- To reach outward, add a port to `ports.ts` and inject an adapter.
