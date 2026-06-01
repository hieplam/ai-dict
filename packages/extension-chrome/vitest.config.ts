import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-chrome',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/adapters/**', 'src/router.ts', 'src/inbound.ts'],
      exclude: ['src/content.ts', 'src/options.ts', 'src/side-panel.ts', 'src/sw.ts', '**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
