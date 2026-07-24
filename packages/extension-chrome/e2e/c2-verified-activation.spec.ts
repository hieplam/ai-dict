import { test, expect } from './fixtures';
import { mockGemini } from './helpers';

test.describe('C2 verified activation', () => {
  test('a rejected key stays on onboarding with the mapped copy and storage rolled back', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, {
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-bad');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'Google rejected the API key.',
      { timeout: 10_000 },
    );
    await expect(page.locator('onboarding-view #status')).toHaveClass(/error/);
    await expect(page.locator('onboarding-view #save-anyway')).toBeHidden();
    expect(await page.locator('settings-form').count()).toBe(0);
    expect(calls.count).toBe(1);

    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { apiKey?: string; hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(false);
  });

  test('an unreachable connection shows the NETWORK copy + Save anyway; bypass persists with a warning and makes no extra call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { abort: true });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-offline');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'Network failed. Check connection and retry.',
      { timeout: 10_000 },
    );
    const saveAnyway = page.locator('onboarding-view #save-anyway');
    await expect(saveAnyway).toBeVisible();

    // Rolled back before the bypass.
    let stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(false);

    await saveAnyway.click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #status')).toContainText('Saved without testing');
    expect(calls.count).toBe(1); // the bypass makes zero further connection.test calls

    stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { apiKey?: string; hasKey?: boolean };
      };
      return settings?.hasKey ?? false;
    });
    expect(stored).toBe(true);
  });

  test('a double-click on Save & activate still fires exactly one connection.test call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-double');
    const activate = page.locator('onboarding-view #activate');
    await activate.click({ force: true });
    await activate.click({ force: true }); // second click races the first; button disables fast

    await page.waitForSelector('settings-form', { timeout: 10_000 });
    expect(calls.count).toBe(1);
  });
});
