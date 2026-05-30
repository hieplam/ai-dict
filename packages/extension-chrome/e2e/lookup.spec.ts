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
  // Seed settings and pre-populate the lookup cache so no real Gemini call is needed.
  // Cache key = fnv1a64Hex('bank|The bank by the river is steep.|vi') = 'fbf304968493913a'
  // (computed from the word/sentence/target that DomSelectionSource will extract via dblclick).
  await page.goto(`chrome-extension://${extId}/options.html`);
  const cacheKey = 'fbf304968493913a';
  const cachedResult = { markdown: '## bank\nA financial institution.', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
  await page.evaluate((args: { cacheKey: string; cachedResult: object }) => chrome.storage.local.set({
    settings: { targetLang: 'vi', promptTemplate: 'Define {word}', apiKey: 'AIza-test', cacheEnabled: true, saveHistory: true, hasKey: true },
    [`cache:${args.cacheKey}`]: JSON.stringify(args.cachedResult),
    'cache:index': JSON.stringify([{ key: args.cacheKey, atime: Date.now() }]),
  }), { cacheKey, cachedResult });

  // Navigate to a real http page so the content script runs (<all_urls> host permission)
  await page.route('http://test.fixture/', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
  }));
  await page.goto('http://test.fixture/');
  // Wait for content script to inject and the workflow to start
  await page.waitForTimeout(2000);

  // Create a deterministic text selection over "bank" via Range API, then dispatch mouseup
  // so DomSelectionSource's handler fires with a real non-collapsed selection.
  await page.evaluate(() => {
    const p = document.getElementById('t')!;
    const textNode = p.firstChild!;
    const text = textNode.textContent ?? '';
    const start = text.indexOf('bank');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 4); // 'bank' is 4 chars
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  // Wait for the selection trigger to appear
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('lookup-trigger').click();
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', { timeout: 10000 });
});
