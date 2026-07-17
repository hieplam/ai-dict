import { test, expect } from './fixtures';

// C1: fresh installs open the welcome screen automatically. The `context` fixture itself IS a
// simulated fresh install (chromium.launchPersistentContext('', ...) uses a new temp profile per
// test — see fixtures.ts), so chrome.runtime.onInstalled({ reason: 'install' }) has already fired
// by the time this test body runs; no click/navigation is needed to observe it.
test.describe('C1 open onboarding on install', () => {
  test('a fresh install opens exactly one options.html tab showing the welcome screen', async ({
    context,
  }) => {
    const optionsPages = context.pages().filter((p) => p.url().includes('options.html'));
    expect(optionsPages).toHaveLength(1);

    const [page] = optionsPages;
    await page!.waitForSelector('onboarding-view');
    await expect(page!.locator('onboarding-view #key')).toBeVisible();
  });
});
