import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B5 status lifecycle', () => {
  test('saving a word shows a Learning toggle; clicking it flips storage + UI to Known and back', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const statusBtn = page.locator('bottom-sheet lookup-card .status-btn');
    await expect(statusBtn).toBeVisible({ timeout: 10_000 });
    await expect(statusBtn).toContainText('Learning');
    await expect(statusBtn).toHaveAttribute('aria-pressed', 'false');

    await statusBtn.click();
    await expect(statusBtn).toContainText('Known');
    await expect(statusBtn).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('known');

    await statusBtn.click();
    await expect(statusBtn).toContainText('Learning');
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('learning');
  });

  test('an unsaved lookup renders no status toggle', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .status-btn')).toHaveCount(0);
  });

  test('the side panel exposes its own independent status toggle', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await doLookup(page);
    const panelStar = panel.locator('side-panel-view .save-btn');
    await expect(panelStar).toBeVisible({ timeout: 10_000 });
    await panelStar.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const panelStatus = panel.locator('side-panel-view .status-btn');
    await expect(panelStatus).toBeVisible({ timeout: 10_000 });
    await panelStatus.click();
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string);
        return entry.status;
      })
      .toBe('known');
  });
});
