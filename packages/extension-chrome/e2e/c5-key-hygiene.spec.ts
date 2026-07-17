import { test, expect } from './fixtures';
import { storageDump } from './helpers';

test.describe('C5 key paste hygiene', () => {
  test('a padded, quote-wrapped key pasted in onboarding is stored fully cleaned', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page
      .locator('onboarding-view #key')
      .fill('  "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234"  \n');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form');
    const dump = await storageDump(page);
    const settings = dump['settings'] as { apiKey: string };
    expect(settings.apiKey).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
  });

  test('an OpenAI-shaped key pasted into the onboarding Gemini field shows a live mismatch hint', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page
      .locator('onboarding-view #key')
      .fill('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop');

    const hint = page.locator('onboarding-view #key-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('OpenAI');
    await expect(hint).toContainText('Gemini');

    // The hint never blocks activation (roadmap C5 scope fence).
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form');
  });
});
