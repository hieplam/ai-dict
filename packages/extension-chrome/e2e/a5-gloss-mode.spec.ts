import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  GEMINI_OK_BODY,
  GEMINI_TRANSLATION_BODY,
} from './helpers';

test.describe('A5 gloss mode', () => {
  test('gloss ON + translation present: renders the compact bubble, then expands to the full card on click', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const gloss = page.locator('lookup-gloss');
    await expect(gloss).toBeVisible({ timeout: 10_000 });
    await expect(gloss).toContainText('ngân hàng');
    expect(await page.locator('bottom-sheet').count()).toBe(0);

    await gloss.click();
    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss ON + translation absent: opens the full card directly, no bubble ever shows', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_OK_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss OFF (default): opens the full card directly even though a translation WAS available', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // no glossMode override — default off
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('gloss ON + NO_KEY: the setup-invite card shows in full, never compact', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false, glossMode: true });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Set up AI Dictionary', { timeout: 10_000 });
    expect(await page.locator('lookup-gloss').count()).toBe(0);
  });

  test('settings page: the Compact gloss checkbox persists to storage as glossMode', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await page.reload();
    const form = page.locator('settings-form');
    await form.waitFor();

    await expect(form.locator('#gloss-mode-row')).toBeVisible();
    await form.locator('#gloss-mode').check();
    await form.locator('#save').click();
    await expect(form.locator('#status')).toHaveText('Settings saved');

    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings: { glossMode: boolean };
      };
      return settings.glossMode;
    });
    expect(stored).toBe(true);
  });
});
