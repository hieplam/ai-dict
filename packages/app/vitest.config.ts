import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app',
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
