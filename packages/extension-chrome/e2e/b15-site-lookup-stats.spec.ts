import { test, expect } from './fixtures';
import { seedSettings, selectWord, openTrigger, mockGemini } from './helpers';

/**
 * A second, differently-hosted fixture route — deliberately NOT added to the shared
 * `helpers.ts` (kept local to this spec) to avoid touching a file other in-flight cards may also
 * be editing (design spec §9 Concurrency). Mirrors gotoFixture's own shape.
 */
async function gotoSecondFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.route('http://second.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p id="t">The ledger by the desk is heavy.</p></body></html>',
    }),
  );
  await page.goto('http://second.fixture/');
}

test.describe('B15 site lookup stats', () => {
  test('a fresh profile with no history shows no Sites section', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);
    await page.reload();
    await expect(page.locator('side-panel-view').locator('.sites')).toBeHidden();
  });

  test('lookups across two sites are tallied per site in the side panel', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);

    const lookupPage = await context.newPage();
    await lookupPage.route('http://test.fixture/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
      }),
    );
    await lookupPage.goto('http://test.fixture/');
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'bank');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      {
        timeout: 10_000,
      },
    );

    // A second lookup on the SAME site (test.fixture), but a DIFFERENT word so it is a fresh
    // cache miss (an identical word+context re-lookup is served from cache and never appends a
    // second history entry — router.ts returns on the cache hit before the history write). Both
    // words share test.fixture, so the site aggregates to 2 lookups rather than adding a new row.
    await lookupPage.reload();
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'river');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      {
        timeout: 10_000,
      },
    );

    // A lookup on a SECOND, different site.
    await gotoSecondFixture(lookupPage);
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'ledger');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      {
        timeout: 10_000,
      },
    );

    await page.bringToFront();
    await page.reload();
    const sites = page.locator('side-panel-view').locator('.sites');
    await expect(sites).toBeVisible({ timeout: 10_000 });
    const rows = sites.locator('.site-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('test.fixture');
    await expect(rows.nth(0)).toContainText('2 lookups');
    await expect(rows.nth(1)).toContainText('second.fixture');
    await expect(rows.nth(1)).toContainText('1 lookup');
  });

  test('saving a looked-up word adds a "saved" count to its site row', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await seedSettings(page);

    const lookupPage = await context.newPage();
    await lookupPage.route('http://test.fixture/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><p id="t">The bank by the river is steep.</p></body></html>',
      }),
    );
    await lookupPage.goto('http://test.fixture/');
    await lookupPage.waitForTimeout(1_000);
    await selectWord(lookupPage, 't', 'bank');
    await openTrigger(lookupPage);
    await expect(lookupPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      {
        timeout: 10_000,
      },
    );
    await lookupPage.locator('bottom-sheet lookup-card .save-btn').click();

    await page.bringToFront();
    await page.reload();
    const row = page.locator('side-panel-view').locator('.site-row').first();
    await expect(row).toContainText('1 lookup · 1 saved', { timeout: 10_000 });
  });
});
