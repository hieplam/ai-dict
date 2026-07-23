import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';

// First-run setup: when there is no usable key the extension can't do its one job, so the
// options page shows an onboarding screen and every keyless surface offers a way into it.

test('onboarding: activating with a key swaps to the settings screen and persists it', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');

  // The blocking step is the API key (Playwright pierces the open shadow root).
  await page.locator('onboarding-view #key').fill('AIza-activated');
  await page.locator('onboarding-view #activate').click();

  // Setup done → the full settings screen takes over with a confirming status.
  await page.waitForSelector('settings-form');
  await expect(page.locator('settings-form #status')).toContainText("You're all set");

  // …and the key is stored with hasKey derived.
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
  // C1 (ruling R3): the fresh-install options tab (onInstalled → chrome.tabs.create) is still open;
  // openOptionsPage() would focus/reuse it instead of firing a 'page' event. Close any open options
  // tab first so this test still proves the CTA/gear *creates* the options page (keeps the
  // waitForEvent('page') assertion falsifiable).
  for (const p of context.pages()) {
    if (p.url().includes('options.html')) await p.close();
  }
  const optionsPagePromise = context.waitForEvent('page');
  await card.locator('.setup-cta').click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();
  expect(optionsPage.url()).toContain('options.html');
  await optionsPage.waitForSelector('onboarding-view');
});
