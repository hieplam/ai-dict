import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { E2E_HEADLESS } from '../playwright.config';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

/**
 * Chrome-extension fixture following Playwright's documented pattern.
 * `context` and `extensionId` are test-scoped (each test gets its own context).
 * An auto per-test hook resets chrome.storage.local so cache/history/settings never
 * leak between tests.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Optional real-Chrome channel for local runs; undefined = bundled Chromium.
      channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
      // Keep Playwright in "headed" mode and opt into Chromium's NEW headless via an arg when
      // E2E_HEADLESS is set (the default). Playwright's `headless:true` injects the OLD headless
      // mode, which cannot load MV3 extensions (the service worker never registers);
      // `--headless=new` can. Pass HEADED=1 to watch a real window. See playwright.config.ts.
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    await use(new URL(sw.url()).hostname);
  },
});

// Reset extension storage before EVERY test (applies to all specs importing this `test`).
test.beforeEach(async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(() => chrome.storage.local.clear());
  await page.close();
});

export { expect };
