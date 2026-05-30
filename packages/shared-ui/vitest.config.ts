import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared-ui',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});
