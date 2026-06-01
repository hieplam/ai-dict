import { defineConfig } from '@playwright/test';

// MV3 extensions with service workers do not load in Playwright's default headless mode.
// Set PLAYWRIGHT_HEADLESS=1 when running under xvfb-run (Linux CI, Bundle 07) — this tells
// specs to use headless:true in launchPersistentContext. Without a virtual display the only
// viable mode is headless:false, which is the default for local dev.
// Export for consumption by e2e specs so headless policy is defined in one place.
export const E2E_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
});
