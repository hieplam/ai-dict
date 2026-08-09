import { test, expect } from './fixtures';
import { seedSettings, mockGemini } from './helpers';

/** Seed two saved:* entries + their index directly (mirrors saved-word.spec.ts's direct-storage
 * style) — Organize needs pre-existing saved words, which is faster to set up this way than
 * driving a full lookup+save flow twice. */
async function seedSavedWords(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const bank = {
      word: 'bank',
      status: 'learning',
      savedAt: 2000,
      senses: [
        {
          definition: 'A financial institution.',
          translation: '',
          sentence: 'The bank approved the loan.',
          url: 'https://example.com/a',
          title: 'A',
        },
      ],
    };
    const serendipity = {
      word: 'serendipity',
      status: 'learning',
      savedAt: 1000,
      senses: [
        {
          definition: 'A fortunate accident.',
          translation: '',
          sentence: 'Finding it was pure serendipity.',
          url: 'https://example.com/b',
          title: 'B',
        },
      ],
    };
    await chrome.storage.local.set({
      'saved:bank': JSON.stringify(bank),
      'saved:serendipity': JSON.stringify(serendipity),
      'saved:index': JSON.stringify(['bank', 'serendipity']),
    });
  });
}

const ORGANIZE_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify([
              { tag: 'Finance', words: ['bank'] },
              { tag: 'Miscellaneous', words: ['serendipity'] },
            ]),
          },
        ],
      },
    },
  ],
});

test.describe('B12 LLM auto-grouping', () => {
  test('confirming Organize sends exactly one call, renders groups, and persists tags', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-summary')).toContainText(
      'Organized 2 saved words.',
      { timeout: 10_000 },
    );
    const groups = panel.locator('side-panel-view .tag-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('.tag-input')).toHaveValue('Finance');
    await expect(groups.nth(0).locator('.tag-words')).toHaveText('bank');
    expect(calls.count).toBe(1);

    const dump = await panel.evaluate(() => chrome.storage.local.get(null));
    const bank = JSON.parse((dump as Record<string, string>)['saved:bank']!);
    const serendipity = JSON.parse((dump as Record<string, string>)['saved:serendipity']!);
    expect(bank.tags).toEqual(['Finance']);
    expect(serendipity.tags).toEqual(['Miscellaneous']);
  });

  test('dismissing the confirm makes zero Gemini calls and leaves the panel idle', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.dismiss());
    await panel.locator('side-panel-view .organize-btn').click();
    await panel.waitForTimeout(300); // let any (unwanted) async chain settle

    await expect(panel.locator('side-panel-view .organize-btn')).toContainText('Organize my words');
    expect(calls.count).toBe(0);
  });

  test('a malformed model response shows an error and writes no tags', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, {
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-error-msg')).toBeVisible({
      timeout: 10_000,
    });
    const dump = await panel.evaluate(() => chrome.storage.local.get(null));
    const bank = JSON.parse((dump as Record<string, string>)['saved:bank']!);
    expect(bank.tags).toBeUndefined();
  });

  test('renaming a tag updates the label and storage with no additional Gemini call', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');
    await seedSavedWords(panel);

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();
    await expect(panel.locator('side-panel-view .tag-group')).toHaveCount(2, { timeout: 10_000 });

    const financeInput = panel.locator('side-panel-view .tag-group').nth(0).locator('.tag-input');
    await financeInput.fill('Money');
    await financeInput.blur();

    await expect(financeInput).toHaveValue('Money');
    expect(calls.count).toBe(1); // no additional model call from the rename

    await expect
      .poll(async () => {
        const dump = await panel.evaluate(() => chrome.storage.local.get(null));
        return JSON.parse((dump as Record<string, string>)['saved:bank']!).tags;
      })
      .toEqual(['Money']);
  });

  test('Organize with zero saved words shows the empty copy and makes zero Gemini calls', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORGANIZE_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    panel.on('dialog', (d) => d.accept());
    await panel.locator('side-panel-view .organize-btn').click();

    await expect(panel.locator('side-panel-view .organize-summary')).toContainText(
      'No saved words yet',
      { timeout: 10_000 },
    );
    expect(calls.count).toBe(0);
  });
});
