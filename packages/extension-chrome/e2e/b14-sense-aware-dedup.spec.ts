import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: import('@playwright/test').Page, paragraph: string): Promise<void> {
  await gotoFixture(page, paragraph);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B14 sense-aware dedup', () => {
  test('saving the same headword from a different sentence offers a merge prompt; confirming appends a second sense', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    let dump = await swStorageDump(context);
    let entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1);

    await doLookup(page, 'The bank approved my loan application today.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();

    const prompt = page.locator('bottom-sheet lookup-card .merge-prompt');
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(star).toHaveAttribute('aria-pressed', 'false'); // reverted — nothing written yet
    dump = await swStorageDump(context);
    entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1); // still 1 — the conflict reply wrote nothing

    await prompt.locator('.merge-prompt-add').click();
    await expect(star).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(prompt).toBeHidden();
    await expect
      .poll(async () => {
        const d = await swStorageDump(context);
        return JSON.parse(d['saved:bank'] as string).senses.length;
      })
      .toBe(2);
  });

  test('declining the merge prompt writes nothing and leaves the word unstarred', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    await doLookup(page, 'The bank approved my loan application today.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    const prompt = page.locator('bottom-sheet lookup-card .merge-prompt');
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    await prompt.locator('.merge-prompt-dismiss').click();
    await expect(prompt).toBeHidden();
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1); // unchanged — decline = no write
  });

  test('re-saving the exact same sentence is a silent no-op — no merge prompt, still 1 sense', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    await doLookup(page, 'The bank by the river is steep.');
    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    await star.click(); // unsave
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click(); // re-save — SAME fixture paragraph/sentence + SAME fixture URL

    await expect(star).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(page.locator('bottom-sheet lookup-card .merge-prompt')).toHaveCount(0);
    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses).toHaveLength(1);
  });
});
