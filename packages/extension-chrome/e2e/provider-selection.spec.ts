import { test, expect } from './fixtures';
import {
  seedSettings,
  storageDump,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  mockOpenAI,
} from './helpers';

interface StoredSettings {
  provider?: string;
  apiKey?: string;
  openaiApiKey?: string;
  hasKey?: boolean;
}

test('options page: switching to ChatGPT and saving persists provider + OpenAI key', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-keep' });
  await page.reload();
  await page.waitForSelector('settings-form');

  const provider = page.locator('settings-form #provider');
  await expect(page.locator('settings-form #key-label')).toHaveText('Gemini API key');
  await provider.selectOption('openai');
  await expect(page.locator('settings-form #key-label')).toHaveText('OpenAI API key');
  await page.locator('settings-form #key').fill('sk-e2e-openai');
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');

  const dump = await storageDump(page);
  const settings = dump['settings'] as StoredSettings;
  expect(settings.provider).toBe('openai');
  expect(settings.openaiApiKey).toBe('sk-e2e-openai');
  // The Gemini key survives the switch — switching providers never wipes the other key.
  expect(settings.apiKey).toBe('AIza-keep');
  expect(settings.hasKey).toBe(true);
});

test('lookup with provider openai hits the OpenAI endpoint, not Gemini, and renders the result', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, {
    provider: 'openai',
    openaiApiKey: 'sk-e2e',
    apiKey: '',
    cacheEnabled: false,
  });
  const gemini = await mockGemini(context);
  const openai = await mockOpenAI(context);

  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('via OpenAI', { timeout: 10_000 });
  expect(openai.count).toBe(1);
  expect(gemini.count).toBe(0);
});

test('settings stored before the provider field existed still look up via Gemini', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // Seed a pre-provider settings blob: no provider, no openaiApiKey.
  await page.evaluate(() =>
    chrome.storage.local.set({
      settings: {
        targetLang: 'vi',
        outputFormat: 'Define {word}',
        apiKey: 'AIza-legacy',
        cacheEnabled: false,
        saveHistory: true,
        hasKey: true,
        theme: 'sepia',
      },
    }),
  );
  const gemini = await mockGemini(context);
  const openai = await mockOpenAI(context);

  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('financial institution', { timeout: 10_000 });
  expect(gemini.count).toBe(1);
  expect(openai.count).toBe(0);
});
