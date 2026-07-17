import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

// First-run setup: when there is no usable key the extension can't do its one job, so the
// options page shows an onboarding screen and every keyless surface offers a way into it.

test('onboarding: activating with a key swaps to the settings screen and persists it', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context); // 200 OK by default — the connection.test passes
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');

  await page.locator('onboarding-view #key').fill('AIza-activated');
  await page.locator('onboarding-view #activate').click();

  await page.waitForSelector('settings-form', { timeout: 10_000 });
  await expect(page.locator('settings-form #status')).toContainText("You're all set");
  expect(calls.count).toBe(1); // C2: exactly one connection.test call for the one click

  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { apiKey: string; hasKey: boolean };
    };
    return `${settings.apiKey}|${settings.hasKey}`;
  });
  expect(stored).toBe('AIza-activated|true');
});

test('onboarding: empty key shows an error and never leaves the onboarding screen', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');
  await page.locator('onboarding-view #activate').click();
  await expect(page.locator('onboarding-view #status')).toHaveClass(/error/);
  expect(await page.locator('settings-form').count()).toBe(0);
});

test('no-key card shows the setup invite and "Open Settings" opens the options page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  // The card reads as onboarding, not a red failure, and offers the action.
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('Set up AI Dictionary', { timeout: 10_000 });
  await expect(card.locator('.setup-cta')).toHaveText('Open Settings');

  // Clicking it routes content script → service worker → openOptionsPage, opening a new tab
  // that lands on the onboarding screen.
  const optionsPagePromise = context.waitForEvent('page');
  await card.locator('.setup-cta').click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();
  expect(optionsPage.url()).toContain('options.html');
  await optionsPage.waitForSelector('onboarding-view');
});
