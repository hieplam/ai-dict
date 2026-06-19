import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';

test.describe('open in side panel', () => {
  test('button is present, dismisses the sheet, and the panel recovers the word', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { theme: 'sepia' }); // a key is seeded → no no-key invite
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    // 1. The in-page card shows the side-panel button.
    await expect(page.locator('lookup-card button[data-act="side-panel"]')).toBeVisible();

    // 2. Click the side-panel button.
    await page.locator('lookup-card button[data-act="side-panel"]').click();

    // 3. The in-page sheet is dismissed (the lookup "moved" to the dock).
    await expect(page.locator('bottom-sheet')).toHaveCount(0);

    // 4. A freshly-opened panel recovers the lookup via the SW get-focus cache.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
    await expect(panel.locator('side-panel-view')).toContainText('river bank');
  });
});
