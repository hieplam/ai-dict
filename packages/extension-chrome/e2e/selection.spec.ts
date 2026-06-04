import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test('a collapsed selection shows no trigger', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  // Collapse the caret and dispatch mouseup — content script returns early for isCollapsed.
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('lookup-trigger')).toHaveCount(0);
});

test('a multi-word phrase selection shows a trigger and renders a result', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'The river bank is steep here.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'river bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});

test('dismiss then re-select shows the trigger again', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'bank');
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

  // Collapse to dismiss, then re-select.
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});
