import { test, expect } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

// Open side-panel.html as a normal tab, then post {to:'side-panel', state, payload} from a
// SECOND extension page. chrome.runtime.sendMessage broadcasts to other extension contexts;
// side-panel.ts accepts it (sender.id === runtime.id) and maps it onto the panel.
async function openPanelAndSender(context: BrowserContext, extensionId: string) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/options.html`);
  return { panel, sender };
}

/** Build a well-formed stored HistoryEntry (matches HistoryEntrySchema). */
function entry(id: string, word: string, definition: string) {
  return {
    id,
    word,
    context: `A sentence with ${word} in it.`,
    createdAt: 1_700_000_000_000,
    result: {
      markdown: `## ${word}\n${definition}`,
      word,
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1_700_000_000_000,
    },
  };
}

/** Seed history into extension storage, newest-first index, from an extension page. */
async function seedHistory(page: Page, entries: ReturnType<typeof entry>[]): Promise<void> {
  await page.evaluate((es) => {
    const items: Record<string, string> = { 'history:index': JSON.stringify(es.map((e) => e.id)) };
    for (const e of es) items[`history:${e.id}`] = JSON.stringify(e);
    return chrome.storage.local.set(items);
  }, entries);
}

test('opens on a teaching empty state, not a fake loading spinner', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  await expect(panel.locator('side-panel-view')).toContainText('Select a word', { timeout: 5_000 });
  await expect(panel.locator('side-panel-view')).not.toContainText('Looking up');
});

test('renders a result delivered via runtime message', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## bank\nA financial institution.', word: 'bank', target: 'vi' },
    }),
  );
  await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
    timeout: 5_000,
  });
});

test('renders the loading state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() => chrome.runtime.sendMessage({ to: 'side-panel', state: 'loading' }));
  await expect(panel.locator('side-panel-view')).toContainText('Looking up', { timeout: 5_000 });
});

test('renders an error state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'error',
      payload: {
        code: 'NO_KEY',
        message: 'Add your Gemini API key in Settings.',
        retryable: false,
      },
    }),
  );
  await expect(panel.locator('side-panel-view')).toContainText(
    'Add your Gemini API key in Settings.',
    { timeout: 5_000 },
  );
});

test('ignores a malformed result payload (guard) and keeps prior content', async ({
  context,
  extensionId,
}) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## ok\nFirst valid content.', word: 'ok', target: 'vi' },
    }),
  );
  await expect(panel.locator('side-panel-view')).toContainText('First valid content.', {
    timeout: 5_000,
  });
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({ to: 'side-panel', state: 'result', payload: { not: 'a result' } }),
  );
  await panel.waitForTimeout(300);
  await expect(panel.locator('side-panel-view')).toContainText('First valid content.');
});

test('lists stored history under Recent and revisits a lookup on click', async ({
  context,
  extensionId,
}) => {
  // Seed history from an extension page BEFORE opening the panel, so the panel's on-open
  // history.list query (to the service worker) returns these entries.
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options.html`);
  await seedHistory(seeder, [
    entry('id-bank', 'bank', 'A financial institution.'),
    entry('id-ledger', 'ledger', 'A record of accounts.'),
  ]);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const items = panel.locator('side-panel-view button.recent-item');
  await expect(items).toHaveCount(2, { timeout: 5_000 });
  await expect(items.first()).toContainText('bank');

  // The focus region still shows the empty state until a row is clicked.
  await expect(panel.locator('side-panel-view')).toContainText('Select a word');

  // Clicking a recent row re-shows that lookup in the focus region.
  await items.nth(1).click();
  await expect(panel.locator('side-panel-view .focus')).toContainText('A record of accounts.', {
    timeout: 5_000,
  });
});
