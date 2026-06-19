import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';

test.describe('open in side panel', () => {
  test('button is present, dismisses the sheet, and the panel recovers the word', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { theme: 'sepia' }); // a key is seeded → no no-key invite
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    // 1. The in-page card shows the side-panel button.
    const sidePanelBtn = page.locator('lookup-card button[data-act="side-panel"]');
    await expect(sidePanelBtn).toBeVisible();

    // 2. Click the side-panel button.
    await sidePanelBtn.click();

    // 3. The in-page sheet is dismissed (the lookup "moved" to the dock).
    await expect(page.locator('bottom-sheet')).toHaveCount(0);

    // 4. A freshly-opened panel recovers the lookup via the SW get-focus cache.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
    await expect(panel.locator('side-panel-view')).toContainText('river bank', { timeout: 5_000 });
  });

  test('clicking the bottom-sheet icon opens the side panel (chrome.sidePanel.open invoked)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);

    // Headless Chromium cannot render/observe the real OS side panel, so we assert the happy
    // path at the API boundary: spy on chrome.sidePanel.open in the service worker and confirm
    // the icon click makes the SW invoke it with the originating tab's windowId. The SW reads
    // chrome.sidePanel.open dynamically at call time, so replacing the property here is seen.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    await sw.evaluate(() => {
      (globalThis as unknown as { __openCalls: { windowId?: number }[] }).__openCalls = [];
      chrome.sidePanel.open = ((opts: { windowId?: number }) => {
        (globalThis as unknown as { __openCalls: { windowId?: number }[] }).__openCalls.push(opts);
        return Promise.resolve(); // stub the real open() — it would no-op in headless anyway
      }) as typeof chrome.sidePanel.open;
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { theme: 'sepia' });
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);

    // The icon lives in the lookup card INSIDE the bottom sheet.
    const sidePanelBtn = page.locator('bottom-sheet lookup-card button[data-act="side-panel"]');
    await expect(sidePanelBtn).toBeVisible();

    await sidePanelBtn.click();

    // The content script relays the click (preserving the user gesture) and the SW opens the panel.
    await expect
      .poll(
        () =>
          sw.evaluate(
            () => (globalThis as unknown as { __openCalls: unknown[] }).__openCalls.length,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    const calls = await sw.evaluate(
      () => (globalThis as unknown as { __openCalls: { windowId?: number }[] }).__openCalls,
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(typeof calls[0]?.windowId).toBe('number');
  });
});
