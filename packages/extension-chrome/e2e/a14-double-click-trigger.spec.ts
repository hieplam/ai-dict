import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  gotoEditableFixture,
  dblclickWord,
  openTrigger,
  mockGemini,
} from './helpers';

test.describe('A14 double-click trigger', () => {
  test('off by default: double-clicking a word still shows the trigger bubble, no auto-fire', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // doubleClickLookup absent → off
    await gotoFixture(page);
    await page.waitForTimeout(1_000); // let the content workflow initialise

    await dblclickWord(page, 't', 'bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
    expect(await page.locator('bottom-sheet lookup-card').count()).toBe(0);
    expect(calls.count).toBe(0);

    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('opted in: double-clicking a word defines it immediately, bypassing the trigger button', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { doubleClickLookup: true });
    await gotoFixture(page);
    await page.waitForTimeout(1_000);

    await dblclickWord(page, 't', 'bank');
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('opted in but guarded: double-clicking inside a contenteditable region never auto-fires', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { doubleClickLookup: true });
    await gotoEditableFixture(page);
    await page.waitForTimeout(1_000);

    await dblclickWord(page, 'edit', 'bank');
    await page.waitForTimeout(500); // give an errant auto-fire a chance to render
    expect(await page.locator('bottom-sheet lookup-card').count()).toBe(0);
    expect(calls.count).toBe(0);
  });
});
