import { test, expect } from './fixtures';
import { gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('C10 deterministic funnel', () => {
  test('fresh profile: onboarding → activation → first successful lookup', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);

    // 1. Fresh profile, options page → onboarding (never settings — the e2e build is
    // guaranteed key-free by the fixtures.ts guard from Task 4).
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector('onboarding-view');

    // 2. Activation (today's actual onboarding behavior — a non-empty key is accepted; C2's
    // future verified-activation change adds a connection.test round-trip inside this same
    // click and does not change this spec — C10's scope fence is dev-infra only).
    await optionsPage.locator('onboarding-view #key').fill('AIza-funnel-test');
    await optionsPage.locator('onboarding-view #activate').click();
    await optionsPage.waitForSelector('settings-form');
    await expect(optionsPage.locator('settings-form #status')).toContainText("You're all set");

    // 3. First successful lookup, on a real content page, using the key just saved by step 2
    // (chrome.storage.local is shared across every extension page in this context).
    const readerPage = await context.newPage();
    await gotoFixture(readerPage);
    await readerPage.waitForTimeout(1_000);
    await selectWord(readerPage, 't', 'bank');
    await openTrigger(readerPage);
    await expect(readerPage.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      { timeout: 10_000 },
    );
  });
});
