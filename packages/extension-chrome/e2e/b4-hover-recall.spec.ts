import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, hoverWord, mockGemini } from './helpers';
import type { Page } from '@playwright/test';

/** Seed one saved:<word> entry directly via `chrome.storage.local`, matching the E1 schema
 * exactly (mirrors b3-highlight.spec.ts's own seeding pattern: JSON.stringify'd entry strings +
 * a JSON.stringify'd `saved:index` array — see saved-words-policy.ts's normalizeWordKey/set). */
async function seedSaved(
  page: Page,
  word: string,
  status: 'learning' | 'known',
  sense: { definition: string; translation: string; sentence: string; url: string; title: string },
): Promise<void> {
  await page.evaluate(
    ({ word, status, sense }) => {
      const key = word.toLowerCase();
      const entry = { word, status, savedAt: 1_700_000_000_000, senses: [sense] };
      return chrome.storage.local.set({
        [`saved:${key}`]: JSON.stringify(entry),
        'saved:index': JSON.stringify([key]),
      });
    },
    { word, status, sense },
  );
}

const BANK_SENSE = {
  definition: 'A financial institution that accepts deposits.',
  translation: 'ngân hàng',
  sentence: 'The bank by the river is steep.',
  url: 'http://test.fixture/',
  title: 'Test fixture',
};

test.describe('B4 hover-recall', () => {
  test('hovering a saved learning-status highlighted word shows the popup with its saved meaning, then hides on leave', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForFunction(
      () => (globalThis as { CSS: typeof CSS }).CSS.highlights?.has('ad-saved-word') === true,
      {
        timeout: 10_000,
      },
    );

    await hoverWord(page, 't', 'bank');
    await expect(page.locator('hover-recall-popup')).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('hover-recall-popup')).toContainText('ngân hàng');

    await page.mouse.move(5, 5); // far away from the highlighted word
    await expect(page.locator('hover-recall-popup')).toBeHidden({ timeout: 2_000 });
  });

  test('"View full entry" makes zero network calls and the side panel recovers the saved definition', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForFunction(
      () => (globalThis as { CSS: typeof CSS }).CSS.highlights?.has('ad-saved-word') === true,
      {
        timeout: 10_000,
      },
    );

    await hoverWord(page, 't', 'bank');
    await expect(page.locator('hover-recall-popup')).toBeVisible({ timeout: 2_000 });
    await page
      .locator('hover-recall-popup')
      .getByRole('button', { name: 'View full entry' })
      .click();

    expect(calls.count).toBe(0); // B4's zero-tokens/zero-network fence, made concrete

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await expect(panel.locator('side-panel-view')).toContainText('financial institution', {
      timeout: 5_000,
    });
    await expect(panel.locator('side-panel-view')).toContainText('bank', { timeout: 5_000 });
  });

  test('a known-status saved word is never highlighted, so hovering it never shows the popup', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await seedSaved(page, 'bank', 'known', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(1_000); // let the (empty-for-known-words) scan settle

    await hoverWord(page, 't', 'bank');
    await page.waitForTimeout(500); // past HOVER_DELAY_MS
    await expect(page.locator('hover-recall-popup')).toBeHidden();
  });

  test('with highlightSavedWords off, hovering the (unpainted) word never shows the popup', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { highlightSavedWords: false });
    await seedSaved(page, 'bank', 'learning', BANK_SENSE);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(1_000);

    await hoverWord(page, 't', 'bank');
    await page.waitForTimeout(500);
    await expect(page.locator('hover-recall-popup')).toBeHidden();
  });
});
