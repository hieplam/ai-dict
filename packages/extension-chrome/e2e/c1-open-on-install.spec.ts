import { test, expect } from './fixtures';

// C1: fresh installs open the welcome screen automatically. The `context` fixture itself IS a
// simulated fresh install (chromium.launchPersistentContext('', ...) uses a new temp profile per
// test — see fixtures.ts), so chrome.runtime.onInstalled({ reason: 'install' }) fires and the
// sw.ts listener opens options.html via chrome.tabs.create (campaign ruling R1). No click or
// navigation is needed to observe it.
test.describe('C1 open onboarding on install', () => {
  test('a fresh install opens exactly one options.html tab showing the welcome screen', async ({
    context,
  }) => {
    // The install-opened tab may still be materialising when the body starts; poll until it has
    // appeared, then assert there is exactly one (proves "opens exactly one tab, once").
    await expect
      .poll(() => context.pages().filter((p) => p.url().includes('options.html')).length, {
        timeout: 10_000,
      })
      .toBe(1);

    const [page] = context.pages().filter((p) => p.url().includes('options.html'));
    await page!.waitForSelector('onboarding-view');
    await expect(page!.locator('onboarding-view #key')).toBeVisible();
  });
});
