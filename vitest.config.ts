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

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: packageDirs.length > 0 ? packageDirs : [{ test: { include: [] } }],
  },
});
