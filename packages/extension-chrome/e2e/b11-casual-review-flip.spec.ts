import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { Page } from '@playwright/test';

/** Build a well-formed stored SavedWordEntry (matches the ratified E1 SavedWordEntrySchema). */
function savedEntry(over: {
  word: string;
  status: 'learning' | 'known';
  savedAt: number;
  definition?: string;
  translation?: string;
  sentence?: string;
}) {
  return {
    word: over.word,
    status: over.status,
    savedAt: over.savedAt,
    senses: [
      {
        definition: over.definition ?? `${over.word} means a financial institution.`,
        translation: over.translation ?? `${over.word} (translated)`,
        sentence: over.sentence ?? `I went to the ${over.word} yesterday.`,
        url: 'https://example.com/article',
        title: 'Example Article',
      },
    ],
  };
}

/** Seed saved words into extension storage, matching saved-words-policy.ts's
 * saved:index / saved:<key> shape (key = word.trim().toLowerCase()). */
async function seedSaved(page: Page, entries: ReturnType<typeof savedEntry>[]): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(es.map((e) => e.word.toLowerCase())),
    };
    for (const e of es) items[`saved:${e.word.toLowerCase()}`] = JSON.stringify(e);
    return chrome.storage.local.set(items);
  }, entries);
}

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('B11 casual review flip', () => {
  test('review shows only the in-window learning word; reveal, mark known, done', async ({
    context,
    extensionId,
  }) => {
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seeder);
    const now = Date.now();
    await seedSaved(seeder, [
      savedEntry({ word: 'kite', status: 'learning', savedAt: now }), // in window
      savedEntry({ word: 'antique', status: 'learning', savedAt: now - 20 * DAY_MS }), // too old
      savedEntry({ word: 'bank', status: 'known', savedAt: now }), // known — excluded
    ]);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .review-btn').click();
    await expect(panel.locator('review-flip-view')).toBeVisible();
    await expect(panel.locator('side-panel-view')).toBeHidden();

    await expect(panel.locator('review-flip-view')).toContainText('Card 1 of 1', {
      timeout: 5_000,
    });
    await expect(panel.locator('review-flip-view')).toContainText('I went to the kite yesterday.');
    await expect(panel.locator('review-flip-view')).not.toContainText('antique');
    // Definition is hidden before reveal (all seeded words share the same default template).
    await expect(panel.locator('review-flip-view')).not.toContainText(
      'means a financial institution',
    );

    await panel.getByRole('button', { name: 'Reveal meaning' }).click();
    await expect(panel.locator('review-flip-view')).toContainText(
      'kite means a financial institution',
    );
    await expect(panel.locator('review-flip-view')).toContainText('kite (translated)');

    await panel.getByRole('button', { name: 'Mark kite as known' }).click();
    await expect(panel.locator('review-flip-view')).toContainText('You reviewed 1 word.', {
      timeout: 5_000,
    });

    await expect
      .poll(async () => {
        const dump = (await panel.evaluate(() => chrome.storage.local.get('saved:kite'))) as {
          'saved:kite'?: string;
        };
        return dump['saved:kite']
          ? (JSON.parse(dump['saved:kite']) as { status: string }).status
          : undefined;
      })
      .toBe('known');

    // Close returns to the normal panel; the review surface goes hidden (still mounted).
    await panel.locator('review-flip-view .close').click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('review-flip-view')).toBeHidden();
  });

  test('an empty deck shows the empty state with a working Back to panel button', async ({
    context,
    extensionId,
  }) => {
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seeder);
    // No saved:* keys seeded — the store is empty.

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await panel.locator('side-panel-view .review-btn').click();
    await expect(panel.locator('review-flip-view')).toBeVisible();
    await expect(panel.locator('review-flip-view')).toContainText('Nothing to review yet', {
      timeout: 5_000,
    });

    await panel.getByRole('button', { name: 'Back to panel' }).click();
    await expect(panel.locator('side-panel-view')).toBeVisible();
    await expect(panel.locator('review-flip-view')).toBeHidden();
  });
});
