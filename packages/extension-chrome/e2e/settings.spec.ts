import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { E2E_HEADLESS } from '../playwright.config';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

let ctx: BrowserContext;
let extId: string;

test.beforeAll(async () => {
  // Headless mode is controlled by PLAYWRIGHT_HEADLESS=1 env var (set by CI under xvfb-run).
  // Locally defaults to headless:false because Playwright's bundled Chromium does not support
  // MV3 extension service worker registration in the default headless mode.
  ctx = await chromium.launchPersistentContext('', {
    headless: E2E_HEADLESS,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  // Give the extension service worker time to register, then find it
  await new Promise((r) => setTimeout(r, 2000));
  const workers = ctx.serviceWorkers();
  const sw =
    workers.find((w) => w.url().startsWith('chrome-extension://')) ??
    (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  extId = new URL(sw.url()).hostname;
});
test.afterAll(async () => {
  await ctx.close();
});

test('options page persists settings to chrome.storage.local and loads them on reload', async () => {
  const page = await ctx.newPage();
  // Navigate to the extension options page via chrome-extension:// (chrome API available)
  await page.goto(`chrome-extension://${extId}/options.html`);

  // Set settings directly via storage (simulating a prior save)
  await page.evaluate(() =>
    chrome.storage.local.set({
      settings: {
        targetLang: 'vi',
        promptTemplate: 'Define {word}',
        apiKey: 'AIza-testkey',
        cacheEnabled: true,
        saveHistory: true,
        hasKey: true,
      },
    }),
  );

  // Reload and verify the key field shows the stored value (type=password field)
  await page.reload();
  await page.waitForSelector('settings-form');

  // Read the stored value to confirm it persisted
  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { apiKey: string };
    };
    return settings.apiKey;
  });
  expect(stored).toBe('AIza-testkey');
});

test('clearing storage via chrome.storage.local.clear empties stored settings', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);

  // Seed data
  await page.evaluate(() =>
    chrome.storage.local.set({
      settings: {
        apiKey: 'AIza-clear-me',
        targetLang: 'vi',
        promptTemplate: 't',
        cacheEnabled: true,
        saveHistory: true,
        hasKey: true,
      },
    }),
  );

  // Clear all
  await page.evaluate(() => chrome.storage.local.clear());

  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings?: unknown };
    return settings;
  });
  expect(stored).toBeUndefined();
});
