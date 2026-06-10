import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';

// The canonical "bank" fixture lookup hashes to this cache key (same as cache-history.spec.ts).
const BANK_CACHE_KEY = 'cache:fbf304968493913a';

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test('deleting a Recent row removes the history entry AND its cached definition', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await doLookup(page);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  // The lookup is listed under Recent with a per-row delete button.
  const row = panel.locator('side-panel-view .recent-row', { hasText: 'bank' });
  await expect(row).toHaveCount(1);
  await row.locator('button.recent-del').click();

  // The row disappears (the whole Recent section collapses once empty)…
  await expect(panel.locator('side-panel-view .recent-row')).toHaveCount(0);

  // …and BOTH stores dropped the entry: history record + index id + cache value + index row.
  await expect
    .poll(async () => {
      const dump = await storageDump(panel);
      const historyKeys = Object.keys(dump).filter(
        (k) => k.startsWith('history:') && k !== 'history:index',
      );
      const index = JSON.parse((dump['cache:index'] as string | undefined) ?? '[]') as {
        key: string;
      }[];
      return {
        historyKeys: historyKeys.length,
        cached: dump[BANK_CACHE_KEY] !== undefined,
        indexed: index.some((e) => e.key === BANK_CACHE_KEY.replace('cache:', '')),
      };
    })
    .toEqual({ historyKeys: 0, cached: false, indexed: false });

  // The point of the feature: the same selection now misses the cache and re-queries Gemini
  // (with whatever prompt template is current).
  expect(calls.count).toBe(1);
  await doLookup(page);
  await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(2);
});

test('deleting one Recent row leaves other cached words untouched', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await doLookup(page);

  // Second lookup of a different word from the same fixture sentence.
  await selectWord(page, 't', 'river');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  await expect(panel.locator('side-panel-view .recent-row')).toHaveCount(2);

  // Both rows' context sentence mentions "river", so target the button by its exact name.
  await panel.getByRole('button', { name: 'Delete river from history and cache' }).click();

  await expect(panel.locator('side-panel-view .recent-row')).toHaveCount(1);
  await expect(panel.locator('side-panel-view .recent-row')).toContainText('bank');

  // bank's cache entry survives the deletion of river.
  const dump = await storageDump(panel);
  expect(dump[BANK_CACHE_KEY]).toBeDefined();
});
