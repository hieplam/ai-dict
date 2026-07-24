import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  getServiceWorker,
  relayCommand,
} from './helpers';

test.describe('A4 keyboard-only flow', () => {
  test('define-selection: selecting text then firing the command opens the card', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

    const sw = await getServiceWorker(context);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'define-selection');

    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
  });

  test('define-selection with nothing selected is a safe no-op', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);

    const sw = await getServiceWorker(context);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'define-selection');
    await page.waitForTimeout(300);

    await expect(page.locator('lookup-trigger')).toHaveCount(0);
    await expect(page.locator('bottom-sheet')).toHaveCount(0);
  });

  test('dismiss-lookup closes the pending trigger bubble (no click yet)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

    const sw = await getServiceWorker(context);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'dismiss-lookup');

    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('dismiss-lookup closes an open card', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const sw = await getServiceWorker(context);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'dismiss-lookup');

    await expect(page.locator('bottom-sheet')).toHaveCount(0);
  });

  test('send-to-panel moves the open card to the side panel', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const sw = await getServiceWorker(context);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'send-to-panel');

    await expect(page.locator('bottom-sheet')).toHaveCount(0);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
  });

  test('send-to-panel with no active lookup does not open the panel', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const sw = await getServiceWorker(context);
    await sw.evaluate(() => {
      (globalThis as unknown as { __openCalls: unknown[] }).__openCalls = [];
      chrome.sidePanel.open = ((opts: unknown) => {
        (globalThis as unknown as { __openCalls: unknown[] }).__openCalls.push(opts);
        return Promise.resolve();
      }) as typeof chrome.sidePanel.open;
    });

    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await page.bringToFront(); // C1: make the page under test the active tab so the command relay targets it, not the install-opened options tab (ruling R3)
    await relayCommand(sw, 'send-to-panel');
    await page.waitForTimeout(300);

    const calls = await sw.evaluate(
      () => (globalThis as unknown as { __openCalls: unknown[] }).__openCalls,
    );
    expect(calls.length).toBe(0);
  });
});
