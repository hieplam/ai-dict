import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-chrome',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // lcov for SonarQube Cloud; text keeps the CI log summary. projectRoot
      // makes SF: paths repo-relative so Sonar can map them from the repo root.
      reporter: ['text', ['lcov', { projectRoot: '../..' }]],
      // side-panel-messages.ts is a pure, fully unit-tested module (not a composition root),
      // so it is measured like the adapters/router/inbound logic.
      include: [
        'src/adapters/**',
        'src/router.ts',
        'src/inbound.ts',
        'src/side-panel-messages.ts',
        'src/command-messages.ts',
      ],
      exclude: [
        'src/content.ts',
        'src/options.ts',
        'src/side-panel.ts',
        'src/sw.ts',
        '**/*.test.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
