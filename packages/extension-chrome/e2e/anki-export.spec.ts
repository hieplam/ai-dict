import { test, expect } from './fixtures';
import { seedSettings } from './helpers';

const status = 'settings-form #status';

async function seedTwoSavedWords(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const bank = {
      word: 'bank',
      status: 'learning',
      savedAt: 1700000000000,
      senses: [
        {
          definition: 'a financial institution',
          translation: 'ngân hàng',
          sentence: 'the river bank',
          url: 'https://example.com',
          title: 'Example',
        },
      ],
    };
    const serendipity = {
      word: 'serendipity',
      status: 'known',
      savedAt: 1700000100000,
      senses: [
        {
          definition: 'a happy accident',
          translation: '',
          sentence: 'pure serendipity',
          url: 'https://example.com/2',
          title: 'Example Two',
        },
      ],
    };
    return chrome.storage.local.set({
      'saved:bank': JSON.stringify(bank),
      'saved:serendipity': JSON.stringify(serendipity),
      'saved:index': JSON.stringify(['serendipity', 'bank']),
    });
  });
}

test('Export Anki deck (TSV) downloads a tab-separated file with no header, in the pinned column order', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-tsv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.tsv');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]!.split('\t')).toEqual([
    'serendipity',
    'a happy accident',
    '',
    'pure serendipity',
    'https://example.com/2',
    'Example Two',
    new Date(1700000100000).toISOString(),
    'known',
  ]);
  // [S1] the export must never carry the API key.
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as TSV');
});

test('Export CSV downloads a comma-separated file with the pinned header row', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.csv');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.trimEnd().split('\r\n');
  expect(lines[0]).toBe('word,definition,translation,sentence,url,title,savedAt,status');
  expect(lines).toHaveLength(3);
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as CSV');
});

test('Export Markdown downloads a human-readable file with a heading per saved word', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await seedTwoSavedWords(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #export-anki-md').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-anki.md');

  const file = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain('## bank');
  expect(content).toContain('## serendipity');
  expect(content).not.toContain('apiKey');
  await expect(page.locator(status)).toHaveText('Exported 2 saved words as Markdown');
});

test('Exporting with no saved words reports nothing to export and downloads nothing', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // a key, but no saved: entries
  await page.reload();
  await page.waitForSelector('settings-form');

  let downloadFired = false;
  page.on('download', () => {
    downloadFired = true;
  });
  await page.locator('settings-form #export-anki-tsv').click();
  await expect(page.locator(status)).toHaveText('No saved words to export');
  await page.waitForTimeout(300); // give a wrongly-fired download a moment to surface
  expect(downloadFired).toBe(false);
});
