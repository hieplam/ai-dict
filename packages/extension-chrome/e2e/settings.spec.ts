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

test('options page applies defaults when storage is empty', async ({ context, extensionId }) => {
  // beforeEach already cleared storage; options.ts should fall back to DEFAULTS.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('settings-form');
  // The form should reflect the default target language 'vi' without any stored settings.
  // Read from the shadow-DOM select element (SettingsForm exposes no value getter).
  const targetLang = await page.evaluate(() => {
    const form = document.querySelector('settings-form')!;
    const select = form.shadowRoot!.querySelector<HTMLSelectElement>('#target')!;
    return select.value;
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
