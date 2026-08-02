/**
 * Lookup e2e spec — Tasks 6 & 7: cache-hit, cache-miss, repeat-from-cache.
 *
 * Gemini interception: context.route (confirmed by spike to intercept the service
 * worker's fetch). No SW self.fetch stub needed.
 *
 * Run the suite with: cd packages/extension-chrome && bunx playwright test
 * No env flags or gating — bundled Chromium headful runs the full
 * content-script → service-worker flow on macOS and in CI (xvfb).
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  GEMINI_GLOB,
} from './helpers';

const CACHE_KEY = 'fbf304968493913a'; // fnv1a64Hex('bank|The bank by the river is steep.|vi')

// ─── Task 6: Cache-hit (no Gemini network call) ──────────────────────────────

test('cache hit: selecting "bank" renders the cached result without a network call', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((key) => {
    const result = {
      markdown: '## bank\nA financial institution.',
      word: 'bank',
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1,
    };
    return chrome.storage.local.set({
      [`cache:${key}`]: JSON.stringify(result),
      'cache:index': JSON.stringify([{ key, atime: 1 }]),
    });
  }, CACHE_KEY);

  await gotoFixture(page);
  await page.waitForTimeout(1_000); // let the content workflow initialise
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await page.close();
});

// ─── Task 7: Cache-miss (Gemini faked via context.route) ─────────────────────

test('cache miss: clicking Define calls the (faked) Gemini server and renders the result', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context); // no cache entry seeded → cold miss
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present, cacheEnabled true, NO cache entry
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(1); // exactly one network call on a cold cache
  await page.close();
});

// ─── Task 7: Repeat-from-cache (second lookup hits cache, not network) ───────

test('second lookup of the same word is served from cache (no extra network call)', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  // First lookup — cold miss → Gemini is called once and the result is cached.
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // Navigate back to the same fixture page so the content script re-initialises.
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  // Second lookup of the same word — must hit cache, not the network.
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(1); // still only one network call total
  await page.close();
});

// ─── Context disambiguation: same word, two sentences, two senses ────────────

test('context disambiguation: the same word "bank" in two different sentences renders two different senses', async ({
  context,
  extensionId,
}) => {
  const RIVER_MD = '## bank\nThe land along the side of a river or lake.';
  const MONEY_MD = '## bank\nA business that keeps money safe and lends it out.';

  // Context-aware mock: answer with the sense that matches the sentence the extension
  // actually sent, proving the surrounding sentence (not just the word) reaches the model.
  await context.route(GEMINI_GLOB, async (route) => {
    const body = route.request().postData() ?? '';
    const isRiver = /river|grassy/i.test(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: isRiver ? RIVER_MD : MONEY_MD }] } }],
      }),
    });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<html><body>' +
        '<p id="river">I sit on the grassy bank of the river all afternoon.</p>' +
        '<p id="money">The next day the bank approved my loan.</p>' +
        '</body></html>',
    }),
  );
  await page.goto('http://test.fixture/');
  await page.waitForTimeout(1_000);

  // 1) "bank" in the RIVER sentence → riverside sense.
  await selectWord(page, 'river', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText(
    'land along the side of a river',
    { timeout: 10_000 },
  );

  // Dismiss by collapsing the selection, then re-select the SAME word elsewhere on the page.
  // Clear the per-tab lookup cooldown (workflow.ts COOLDOWN_MS = 2000) first, or the second
  // Define is blocked client-side with a "slow down" message instead of firing.
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(2_100);

  // 2) The SAME word "bank" in the MONEY sentence → financial sense.
  await selectWord(page, 'money', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText(
    'keeps money safe and lends it out',
    { timeout: 10_000 },
  );
  await page.close();
});
