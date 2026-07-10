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

test.describe('B7 repeat-offender nudge', () => {
  test('the nudge banner appears only on the 3rd lookup of the same word', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false }); // force a fresh history append each time

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toBeVisible();
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toContainText(
      '3rd time meeting this word',
    );
  });

  test('tapping the nudge Save button persists the word via the same save path as the star', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await doLookup(page);
    await doLookup(page);
    const nudgeSave = page.locator('bottom-sheet lookup-card .nudge-row__save-btn');
    await expect(nudgeSave).toBeVisible();
    await nudgeSave.click();

    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const dump = await storageDump(page);
    expect(dump['saved:bank']).toBeDefined();
  });

  test('the nudge never re-shows for the same word after being shown once (dismiss or ignore)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await doLookup(page);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toBeVisible();

    // Dismiss without saving.
    await page.locator('bottom-sheet lookup-card .nudge-row__dismiss-btn').click();
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);

    // A 4th (and 5th) lookup of the same word must never re-show the banner.
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
  });

  test('a different word starts its own fresh count (no cross-word leakage)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, {
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: '## steep\nRising sharply.' }] } }],
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'steep');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('Rising sharply', {
      timeout: 10_000,
    });
    await expect(page.locator('bottom-sheet lookup-card .nudge-row')).toHaveCount(0);
  });
});
