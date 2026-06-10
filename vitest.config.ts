import { defineConfig } from 'vitest/config';
import { readdirSync, existsSync } from 'node:fs';

// `test.workspace` / `vitest.workspace.*` is deprecated since Vitest 3.2 — use `test.projects`.
// Dynamically resolve package list so the root test script exits 0 on an empty workspace
// (Vitest 4.x throws a startup error when the projects glob matches nothing).
const packageDirs = existsSync('packages')
  ? readdirSync('packages')
      .filter((d) => !d.startsWith('_'))
      .map((d) => `packages/${d}`)
  : [];

// scripts/ holds repo-tooling tests (e.g. the Sonar backlog importer) outside the workspace
const projectDirs = [
  ...packageDirs,
  ...(existsSync('scripts/vitest.config.ts') ? ['scripts'] : []),
];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: projectDirs.length > 0 ? projectDirs : [{ test: { include: [] } }],
  },
});
