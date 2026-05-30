import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
});
