import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { Page } from '@playwright/test';

/** Seed `saved:*` entries directly into extension storage, matching the ratified E1 shape
 * (index newest-first, mirroring saved-words-policy.ts's own savedWordUpsert ordering) — the
 * same "seed storage directly, skip the real save flow" precedent side-panel.spec.ts's own
 * local seedHistory() helper already uses. */
async function seedSaved(
  page: Page,
  entries: { word: string; status: 'learning' | 'known'; savedAt: number; url: string }[],
): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(es.map((e) => e.word.toLowerCase())),
    };
    for (const e of es) {
      items[`saved:${e.word.toLowerCase()}`] = JSON.stringify({
        word: e.word,
        status: e.status,
        savedAt: e.savedAt,
        senses: [
          {
            definition: `${e.word} definition`,
            translation: '',
            sentence: `a sentence with ${e.word}`,
            url: e.url,
            title: 'Example',
          },
        ],
      });
    }
    return chrome.storage.local.set(items);
  }, entries);
}

test.describe('B6 words page', () => {
  test('My Words opens the saved-word collection with search/filter/sort and returns via Back', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);
    await seedSaved(setup, [
      { word: 'bank', status: 'learning', savedAt: 1, url: 'https://a.example/x' },
      { word: 'cat', status: 'known', savedAt: 2, url: 'https://b.example/y' },
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .words-nav').click();
    await expect(panel.locator('words-page-view')).toBeVisible();
    await expect(panel.locator('side-panel-view')).toBeHidden();

    const rows = panel.locator('words-page-view .word-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('cat'); // newest-first default: savedAt 2 before 1
    await expect(rows.nth(1)).toContainText('bank');

    await panel.locator('words-page-view .search').fill('ban');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('bank');
    await panel.locator('words-page-view .search').fill('');

    await panel.locator('words-page-view .status-filter').selectOption('known');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('cat');
    await panel.locator('words-page-view .status-filter').selectOption('all');

    await panel.locator('words-page-view .site-filter').selectOption('a.example');
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(1);
    await expect(panel.locator('words-page-view .word-row')).toContainText('bank');
    await panel.locator('words-page-view .site-filter').selectOption('all');

    await panel.locator('words-page-view .sort').selectOption('alpha');
    const alphaRows = panel.locator('words-page-view .word-row');
    await expect(alphaRows.nth(0)).toContainText('bank');
    await expect(alphaRows.nth(1)).toContainText('cat');

    await panel.locator('words-page-view .back').click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('words-page-view')).toBeHidden();
  });

  test('editing status and deleting a word from the words page persists to chrome.storage.local', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);
    await seedSaved(setup, [
      { word: 'bank', status: 'learning', savedAt: 1, url: 'https://a.example/x' },
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await panel.locator('side-panel-view .words-nav').click();

    const statusBtn = panel.locator('words-page-view .status-btn');
    await expect(statusBtn).toHaveText('Learning');
    await statusBtn.click();
    await expect(statusBtn).toHaveText('Known');
    await expect
      .poll(async () => {
        const dump = (await panel.evaluate(() => chrome.storage.local.get('saved:bank'))) as {
          'saved:bank'?: string;
        };
        return dump['saved:bank']
          ? (JSON.parse(dump['saved:bank']) as { status: string }).status
          : undefined;
      })
      .toBe('known');

    await panel.locator('words-page-view .del-btn').click();
    await expect(panel.locator('words-page-view .word-row')).toHaveCount(0);
    await expect(panel.locator('words-page-view')).toContainText(/no saved words yet/i);
    await expect
      .poll(async () => {
        const dump = (await panel.evaluate(() => chrome.storage.local.get('saved:bank'))) as {
          'saved:bank'?: string;
        };
        return dump['saved:bank'];
      })
      .toBeUndefined();
  });

  test('the words page shows its teaching empty state when nothing is saved yet', async ({
    context,
    extensionId,
  }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(setup);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await panel.locator('side-panel-view .words-nav').click();

    await expect(panel.locator('words-page-view')).toContainText(/no saved words yet/i);
  });
});
