import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test('cacheEnabled:false hits the network on every lookup', async ({ context, extensionId }) => {
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { cacheEnabled: false });
  await doLookup(page);
  // doLookup re-navigates via gotoFixture, so a separate reload is redundant (and the
  // double-navigation it caused left the content script's selection listener racy).
  await doLookup(page);
  // Poll the counter: the second SW fetch may still be settling when the card text (which
  // comes from the faked response) first appears. expect.poll waits instead of reading once.
  await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(2); // no caching → two calls
});

test('a successful lookup writes a history entry when saveHistory is true', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { saveHistory: true });
  await doLookup(page);
  // Navigate back to an extension page so chrome.storage.local is accessible.
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const dump = await storageDump(page);
  const historyKeys = Object.keys(dump).filter(
    (k) => k.startsWith('history:') && k !== 'history:index',
  );
  expect(historyKeys.length).toBeGreaterThanOrEqual(1);
  expect(dump['history:index']).toBeDefined();
});

test('saveHistory:false writes no history entry', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { saveHistory: false });
  await doLookup(page);
  // Navigate back to an extension page so chrome.storage.local is accessible.
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const dump = await storageDump(page);
  const historyKeys = Object.keys(dump).filter((k) => k.startsWith('history:'));
  expect(historyKeys).toHaveLength(0);
});

test('a cache-miss write updates cache:index', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { cacheEnabled: true });
  await doLookup(page);
  // Navigate back to an extension page so chrome.storage.local is accessible.
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const dump = await storageDump(page);
  expect(dump['cache:fbf304968493913a']).toBeDefined();
  const index = JSON.parse(dump['cache:index'] as string) as { key: string }[];
  expect(index.some((e) => e.key === 'fbf304968493913a')).toBe(true);
});
