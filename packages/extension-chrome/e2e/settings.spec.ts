import { test, expect } from './fixtures';
import { seedSettings, storageDump } from './helpers';

test('persists settings to storage and reloads them on the options page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-testkey' });
  await page.reload();
  await page.waitForSelector('settings-form');
  const stored = await page.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as {
      settings: { apiKey: string };
    };
    return settings.apiKey;
  });
  expect(stored).toBe('AIza-testkey');
});

test('chrome.storage.local.clear empties stored settings', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate(() => chrome.storage.local.clear());
  const dump = await storageDump(page);
  expect(dump.settings).toBeUndefined();
});

test('first run with empty storage shows onboarding, not the settings form', async ({
  context,
  extensionId,
}) => {
  // beforeEach already cleared storage; with no usable key, options.ts shows onboarding so a
  // first-time user is guided to add a key instead of being dropped into a settings form.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');
  expect(await page.locator('settings-form').count()).toBe(0);
  // The language step defaults to Vietnamese without any stored settings.
  const targetLang = await page.evaluate(() => {
    const view = document.querySelector('onboarding-view')!;
    return view.shadowRoot!.querySelector<HTMLSelectElement>('#target')!.value;
  });
  expect(targetLang).toBe('vi');
});

test('targetLang round-trips through storage', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'en' });
  const dump = await storageDump(page);
  expect((dump.settings as { targetLang: string }).targetLang).toBe('en');
});
