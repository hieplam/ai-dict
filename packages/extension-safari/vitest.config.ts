import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-safari',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/adapters/**', 'src/router.ts', 'src/inbound.ts'],
      exclude: ['src/content.ts', 'src/options.ts', 'src/sw.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
