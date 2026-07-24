import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swEval<T>(context: BrowserContext, fn: () => T | Promise<T>): Promise<T> {
  const [sw] = context.serviceWorkers();
  if (!sw) throw new Error('no service worker registered');
  return sw.evaluate(fn);
}

test.describe('C7 finish-setup toolbar badge', () => {
  test('a fresh, keyless profile shows the setup badge', async ({ context, extensionId }) => {
    // extensionId fixture forces the SW to be registered before we evaluate inside it.
    void extensionId;
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('!');
    await expect
      .poll(async () => swEval(context, () => chrome.action.getTitle({})))
      .toBe('Finish AI Dictionary setup');
  });

  test('seeding a usable key clears the badge and restores the default title', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // default seed includes apiKey: 'AIza-test', hasKey: true

    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('');
    await expect
      .poll(async () => swEval(context, () => chrome.action.getTitle({})))
      .toBe('AI Dictionary');
  });

  test('clearing the key back out re-shows the setup badge', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('');

    await seedSettings(page, { apiKey: '', hasKey: false, configuredProviders: [] });
    await expect.poll(async () => swEval(context, () => chrome.action.getBadgeText({}))).toBe('!');
  });
});
