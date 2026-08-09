import { test, expect } from './fixtures';
import { seedSettings } from './helpers';
import type { Page } from '@playwright/test';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a well-formed stored HistoryEntry (matches HistoryEntrySchema, B10's url/title included). */
function entry(id: string, word: string, createdAt: number, url?: string) {
  return {
    id,
    word,
    context: `A sentence with ${word} in it.`,
    createdAt,
    ...(url !== undefined ? { url, title: 'A page' } : {}),
    result: {
      markdown: `## ${word}\nA definition.`,
      word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: createdAt,
    },
  };
}

/** Seed history into extension storage, newest-first index. */
async function seedHistory(page: Page, entries: ReturnType<typeof entry>[]): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = { 'history:index': JSON.stringify(es.map((e) => e.id)) };
    for (const e of es) items[`history:${e.id}`] = JSON.stringify(e);
    return chrome.storage.local.set(items);
  }, entries);
}

/** Seed saved words into extension storage, newest-first index. */
async function seedSaved(page: Page, words: { word: string; savedAt: number }[]): Promise<void> {
  await page.evaluate((ws) => {
    const items: Record<string, string> = {
      'saved:index': JSON.stringify(ws.map((w) => w.word.toLowerCase())),
    };
    for (const w of ws) {
      items[`saved:${w.word.toLowerCase()}`] = JSON.stringify({
        word: w.word,
        status: 'learning',
        savedAt: w.savedAt,
        senses: [{ definition: 'd', translation: '', sentence: 's', url: 'u', title: 't' }],
      });
    }
    return chrome.storage.local.set(items);
  }, words);
}

test('the This week section summarizes lookups, saves, repeats, and the top site', async ({
  context,
  extensionId,
}) => {
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(seeder);

  const now = await seeder.evaluate(() => Date.now());
  await seedHistory(seeder, [
    entry('h1', 'bank', now - 1 * DAY_MS, 'https://www.nautil.us/a'),
    entry('h2', 'bank', now - 2 * DAY_MS, 'https://nautil.us/b'), // 2nd "bank" lookup this week → repeat
    entry('h3', 'ledger', now - 3 * DAY_MS, 'https://nautil.us/c'),
    entry('h4', 'stale', now - 8 * DAY_MS, 'https://outside.example/'), // outside the 7d window
  ]);
  await seedSaved(seeder, [
    { word: 'bank', savedAt: now - 1 * DAY_MS },
    { word: 'ancient', savedAt: now - 30 * DAY_MS }, // outside the window
  ]);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const digest = panel.locator('side-panel-view .digest');
  await expect(digest).toContainText('3 lookups this week', { timeout: 5_000 });
  await expect(digest).toContainText('1 saved');
  await expect(digest).toContainText('1 repeat lookup');
  await expect(digest).toContainText('Mostly from nautil.us');
});

test('the This week section shows the empty state when there is no activity in the window', async ({
  context,
  extensionId,
}) => {
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(seeder);
  // No history/saved seeded at all.

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const digest = panel.locator('side-panel-view .digest');
  await expect(digest).toContainText('Nothing yet this week', { timeout: 5_000 });
});
