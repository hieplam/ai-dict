import { test, expect } from './fixtures';
import { seedSettings, mockGemini } from './helpers';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e-evidence');

// Every options-page action must end in a visible status line — that is the bug
// these tests lock down: previously each button fired and showed nothing.
const status = 'settings-form #status';

test('Save shows a confirmation status', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // A key already exists → the settings screen (not onboarding) is shown.
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');
  await page.locator('settings-form #key').fill('AIza-newkey');
  await page.locator('settings-form #save').click();
  await expect(page.locator(status)).toHaveText('Settings saved');
  await page.screenshot({ path: path.join(shots, 'save.png') });
});

test('Clear cache shows a confirmation status', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.locator('settings-form #clear-cache').click();
  await expect(page.locator(status)).toHaveText('Cache cleared');
  await page.screenshot({ path: path.join(shots, 'clear-cache.png') });
});

test('Clear history shows a confirmation status', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.locator('settings-form #clear-history').click();
  await expect(page.locator(status)).toHaveText('History cleared');
});

test('Test connection reports OK when the key works', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-test', hasKey: true });
  await page.reload();
  await page.locator('settings-form #test').click();
  await expect(page.locator(status)).toHaveText('Connection OK');
  await page.screenshot({ path: path.join(shots, 'test-ok.png') });
});

test('Test connection reports an error when the stored key is missing', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // a key exists → land on the settings screen
  await page.reload();
  await page.waitForSelector('settings-form');
  // Drop the stored key so a connection test hits NO_KEY. Routing to onboarding only runs on
  // load, so the settings form stays put while storage now has no usable key.
  await seedSettings(page, { apiKey: '', hasKey: false });
  await page.locator('settings-form #test').click();
  // NO_KEY surfaces as an error-toned status (exact copy comes from the error mapper).
  await expect(page.locator(status)).toHaveClass(/error/);
  await page.screenshot({ path: path.join(shots, 'test-error.png') });
});

test('Export history downloads a JSON file containing the entries', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // a key → the settings screen (export lives there, not in onboarding)
  // Seed one history entry directly into storage.
  await page.evaluate(() => {
    const entry = {
      id: 'e1',
      word: 'bank',
      context: 'by the river',
      result: {
        markdown: '## bank',
        word: 'bank',
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: 1,
      },
      createdAt: 1,
    };
    return chrome.storage.local.set({
      'history:e1': JSON.stringify(entry),
      'history:index': JSON.stringify(['e1']),
    });
  });
  await page.reload();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-history.json');

  const file = await download.path();
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    entries: { word: string }[];
  };
  expect(parsed.entries).toHaveLength(1);
  expect(parsed.entries[0]!.word).toBe('bank');
  // [S1] the export must never carry the API key.
  expect(readFileSync(file, 'utf8')).not.toContain('apiKey');

  await expect(page.locator(status)).toHaveText('Exported 1 entries');
  await page.screenshot({ path: path.join(shots, 'export.png') });
});

test('Export with empty history reports nothing to export', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // A key (no history) → settings screen with nothing to export.
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');
  await page.locator('settings-form #export').click();
  await expect(page.locator(status)).toHaveText('No history to export');
});

test('Restore default repopulates the prompt template after confirm', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');
  const tpl = page.locator('settings-form #tpl');
  await tpl.fill('my custom prompt that differs from the default');
  // A customized field guards the restore behind a confirm() dialog.
  page.once('dialog', (d) => d.accept());
  await page.locator('settings-form #reset-tpl').click();
  // Assert on a stable substring of DEFAULT_TEMPLATE, not the whole multi-line string.
  await expect(tpl).toHaveValue(/Sense selection/);
  await expect(page.locator(status)).toHaveText(
    'Prompt template restored — Save settings to apply.',
  );
  await page.screenshot({ path: path.join(shots, 'restore-default.png') });
});
