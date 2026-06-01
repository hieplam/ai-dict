import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'adapters-shared',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
