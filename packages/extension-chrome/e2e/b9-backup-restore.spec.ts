import { test, expect } from './fixtures';
import { seedSettings, storageDump } from './helpers';

const status = 'settings-form #status';

function seedOneSavedWord(word: string, savedAt: number) {
  return {
    [`saved:${word}`]: JSON.stringify({
      word,
      status: 'learning',
      savedAt,
      senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
    }),
    'saved:index': JSON.stringify([word]),
  };
}

function seedOneHistoryEntry(id: string, createdAt: number) {
  return {
    [`history:${id}`]: JSON.stringify({
      id,
      word: id,
      context: '',
      createdAt,
      result: {
        markdown: '',
        word: id,
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: createdAt,
      },
    }),
    'history:index': JSON.stringify([id]),
  };
}

test('Export backup downloads ai-dict-backup.json matching the E2 envelope, never containing the key', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-should-never-appear' });
  await page.evaluate((data) => chrome.storage.local.set(data), {
    ...seedOneSavedWord('bank', 1000),
    ...seedOneHistoryEntry('h1', 2000),
  });
  await page.reload();
  await page.waitForSelector('settings-form');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('settings-form #backup-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ai-dict-backup.json');

  const file = await download.path();
  const raw = await import('node:fs').then((fs) => fs.readFileSync(file, 'utf8'));
  const parsed = JSON.parse(raw) as {
    format: string;
    version: number;
    data: { savedWords: { word: string }[]; history: { id: string }[] };
  };
  expect(parsed.format).toBe('ai-dict-backup');
  expect(parsed.version).toBe(1);
  expect(parsed.data.savedWords).toHaveLength(1);
  expect(parsed.data.savedWords[0]!.word).toBe('bank');
  expect(parsed.data.history).toHaveLength(1);
  expect(raw).not.toContain('AIza-should-never-appear');
  expect(raw).not.toContain('"apiKey"');
  await expect(page.locator(status)).toContainText('Exported 1 saved words and 1 history entries');
});

test('Import (merge) adds new entries without deleting existing ones', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((data) => chrome.storage.local.set(data), seedOneSavedWord('existing', 1));
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: {
      savedWords: [
        {
          word: 'imported',
          status: 'learning',
          savedAt: 2,
          senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
        },
      ],
      history: [],
      settings: {},
    },
  });

  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 1 saved words and 0 history entries');
  const dump = await storageDump(page);
  expect(dump['saved:existing']).toBeDefined();
  expect(dump['saved:imported']).toBeDefined();
});

test('Import (replace) wipes pre-existing data not present in the file', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.evaluate((data) => chrome.storage.local.set(data), seedOneSavedWord('stale', 1));
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: {
      savedWords: [
        {
          word: 'fresh',
          status: 'learning',
          savedAt: 2,
          senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
        },
      ],
      history: [],
      settings: {},
    },
  });

  page.once('dialog', (d) => d.accept());
  await page.locator('settings-form #backup-import-replace').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 1 saved words and 0 history entries');
  const dump = await storageDump(page);
  expect(dump['saved:stale']).toBeUndefined();
  expect(dump['saved:fresh']).toBeDefined();
});

test('A newer-version backup file is rejected client-side; storage is untouched', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');
  const before = await storageDump(page);

  const futureJson = JSON.stringify({ format: 'ai-dict-backup', version: 2, data: {} });
  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(futureJson),
    });

  await expect(page.locator(status)).toContainText('newer version of AI Dictionary');
  const after = await storageDump(page);
  expect(after).toEqual(before);
});

test('The existing stored key survives an import (S1)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-existing' });
  await page.reload();
  await page.waitForSelector('settings-form');

  const backupJson = JSON.stringify({
    format: 'ai-dict-backup',
    version: 1,
    exportedAt: 1,
    data: { savedWords: [], history: [], settings: { targetLang: 'en' } },
  });

  await page.locator('settings-form #backup-import-merge').click();
  await page
    .locator('settings-form')
    .locator('#backup-file')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupJson),
    });

  await expect(page.locator(status)).toContainText('Imported 0 saved words and 0 history entries');
  const dump = await storageDump(page);
  // B9 drift note: unlike `saved:*`/`history:*` keys (JSON.stringify'd strings), `settings` is
  // stored as a plain object by chrome.storage.local — matches the convention every other spec
  // in this suite uses (c5-key-hygiene.spec.ts, c6-invalid-key-recovery.spec.ts,
  // provider-selection.spec.ts), not the plan's `JSON.parse(dump['settings'] as string)`.
  const settings = dump['settings'] as { apiKey: string; targetLang: string };
  expect(settings.apiKey).toBe('AIza-existing');
  expect(settings.targetLang).toBe('en'); // the non-secret field DID apply
});
