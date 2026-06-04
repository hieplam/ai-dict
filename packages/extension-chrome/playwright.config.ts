import { defineConfig } from '@playwright/test';

// Headless by default; pass HEADED=1 to watch the browser (e.g. `HEADED=1 bunx playwright test`).
// MV3 extension service workers register in Chromium's modern headless mode, which Playwright
// uses for launchPersistentContext, so the full content-script → SW flow runs headless too.
// Export so the headless policy lives in one place, consumed by the e2e fixture.
export const E2E_HEADLESS = process.env.HEADED !== '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Each test launches its own headful Chromium-with-extension context. Running several in
  // parallel on one machine starves CPU/display and causes service-worker registration and
  // trigger-wait timeouts, so the suite is serialised. This matches how CI runs it under xvfb.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
});
