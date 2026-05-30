import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

let ctx: BrowserContext;
let extId: string;

test.beforeAll(async () => {
  // Extensions with MV3 service workers require headless:false — Playwright's headless mode
  // does not support extension service worker registration (known limitation). This is expected;
  // Bundle 07 CI wires this job to xvfb-run. Locally, it runs in non-headless mode.
  ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
  // Give the extension service worker time to register, then find it
  await new Promise((r) => setTimeout(r, 2000));
  const workers = ctx.serviceWorkers();
  const sw = workers.find((w) => w.url().startsWith('chrome-extension://')) ?? await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  extId = new URL(sw.url()).hostname;
});
test.afterAll(async () => { await ctx.close(); });

test('selecting a word shows a trigger; clicking it renders the mocked Gemini result', async () => {
  const page = await ctx.newPage();
  await page.route('https://generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }] }) }),
  );
  // Seed a key via the extension options page (chrome-extension:// scheme → chrome API available)
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.evaluate(() => chrome.storage.local.set({ settings: { targetLang: 'vi', promptTemplate: 'Define {word}', apiKey: 'AIza-test', cacheEnabled: true, saveHistory: true, hasKey: true } }));

  // Navigate to a real http page so the content script runs (<all_urls> host permission)
  await page.route('http://test.fixture/', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
  }));
  await page.goto('http://test.fixture/');
  // Wait for content script to inject and the workflow to start
  await page.waitForTimeout(2000);
  await page.dblclick('#t');                                   // selects a word
  // Wait for the selection trigger to appear
  await page.locator('lookup-trigger').waitFor({ timeout: 5000 });
  await page.locator('lookup-trigger').click();
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', { timeout: 10000 });
});
