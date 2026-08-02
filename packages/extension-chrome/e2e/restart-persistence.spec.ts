import { persistentTest, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

/**
 * Read the extension's chrome.storage.local straight off the service worker, mirroring the
 * established pattern in saved-word.spec.ts — the only context guaranteed to have the `chrome`
 * global (a page navigated to a `chrome-extension://` origin also works, but the SW is always
 * live once a lookup has run).
 */
async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

/**
 * Real select -> Define trigger -> rendered card flow, matching the pattern used across the
 * existing lookup specs (e.g. saved-word.spec.ts's doLookup helper).
 */
async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

persistentTest(
  'settings, a saved word, and lookups survive closing and relaunching against the same profile',
  async ({ session }) => {
    // --- Before the restart: seed settings, perform a lookup, save the word. ---
    await mockGemini(session.context);
    const page = await session.context.newPage();
    await page.goto(`chrome-extension://${session.extensionId}/options.html`);
    await seedSettings(page, { targetLang: 'vi', theme: 'dark' });
    await doLookup(page);

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect
      .poll(async () => (await swStorageDump(session.context))['saved:bank'])
      .toBeDefined();

    const beforeDump = await swStorageDump(session.context);
    expect((beforeDump.settings as { targetLang: string; theme: string }).targetLang).toBe('vi');
    expect((beforeDump.settings as { targetLang: string; theme: string }).theme).toBe('dark');
    const beforeEntry = JSON.parse(beforeDump['saved:bank'] as string);
    expect(beforeEntry.word).toBe('bank');

    // --- Relaunch: closes the context, relaunches against the SAME userDataDir, re-derives
    // the extension id (never cached — it can change across relaunches). This is the actual
    // MV3 service-worker cold-start this spec exists to exercise. ---
    await session.relaunch();

    // --- After the restart: a brand-new SW process reading disk-persisted storage. ---
    const afterDump = await swStorageDump(session.context);
    expect((afterDump.settings as { targetLang: string; theme: string }).targetLang).toBe('vi');
    expect((afterDump.settings as { targetLang: string; theme: string }).theme).toBe('dark');
    expect(afterDump['saved:bank']).toBeDefined();
    const afterEntry = JSON.parse(afterDump['saved:bank'] as string);
    expect(afterEntry.word).toBe('bank');
    expect(afterEntry.senses[0].definition).toContain('financial institution');

    const index = JSON.parse((afterDump['saved:index'] as string | undefined) ?? '[]');
    expect(index).toContain('bank');

    // A fresh lookup (new page, new selection, mocked Gemini again) still works end-to-end
    // after the cold-started service worker rehydrates.
    await mockGemini(session.context);
    const freshPage = await session.context.newPage();
    await doLookup(freshPage);
  },
);
