import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // lcov for SonarQube Cloud; text keeps the CI log summary. projectRoot
      // makes SF: paths repo-relative so Sonar can map them from the repo root.
      reporter: ['text', ['lcov', { projectRoot: '../..' }]],
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
