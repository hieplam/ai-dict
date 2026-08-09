import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';
import type { BrowserContext } from '@playwright/test';

const ORIGINAL_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

const RELATED_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'RELATED: "shore, embankment, bluff"\n\n## bank\nA financial institution.\n\n**Related words**\nShore, embankment, bluff.',
          },
        ],
      },
    },
  ],
});

async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

test.describe('B13 related words on save', () => {
  test('tapping the related chip resends the original selection, shows the result, and does NOT persist when the word is not saved', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });

    let sentPrompt = '';
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, {
      body: RELATED_BODY,
      onRequest: (postData) => {
        const parsed = JSON.parse(postData) as { contents: { parts: { text: string }[] }[] };
        sentPrompt = parsed.contents[0]?.parts[0]?.text ?? '';
      },
    });

    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect(card).toContainText('Shore, embankment, bluff.', { timeout: 10_000 });

    expect(sentPrompt).toContain('RELATED WORDS');
    expect(sentPrompt).toContain('"bank"');
    expect(sentPrompt).toContain('The bank by the river is steep.');

    // The machine-only signal line never leaks into the visible card.
    await expect(card).not.toContainText('RELATED:');

    // Never starred — nothing should be persisted.
    const dump = await swStorageDump(context);
    expect(dump['saved:bank']).toBeUndefined();
  });

  test('tapping the related chip on an ALREADY-saved word persists related onto the existing entry, touching nothing else', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });

    await card.locator('.save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();
    const before = JSON.parse((await swStorageDump(context))['saved:bank'] as string) as {
      senses: {
        definition: string;
        translation: string;
        sentence: string;
        url: string;
        title: string;
      }[];
    };

    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: RELATED_BODY });
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect(card).toContainText('Shore, embankment, bluff.', { timeout: 10_000 });

    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = dump['saved:bank']
          ? (JSON.parse(dump['saved:bank'] as string) as {
              senses: { related?: string[] }[];
            })
          : null;
        return entry?.senses[0]?.related;
      })
      .toEqual(['shore', 'embankment', 'bluff']);

    const after = JSON.parse((await swStorageDump(context))['saved:bank'] as string) as {
      senses: {
        definition: string;
        translation: string;
        sentence: string;
        url: string;
        title: string;
      }[];
    };
    expect(after.senses[0]!.definition).toBe(before.senses[0]!.definition);
    expect(after.senses[0]!.translation).toBe(before.senses[0]!.translation);
    expect(after.senses[0]!.sentence).toBe(before.senses[0]!.sentence);
    expect(after.senses[0]!.url).toBe(before.senses[0]!.url);
    expect(after.senses[0]!.title).toBe(before.senses[0]!.title);
  });

  test('a subsequent normal re-save clears the previously-persisted related array', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    await card.locator('.save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: RELATED_BODY });
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string) as {
          senses: { related?: string[] }[];
        };
        return entry.senses[0]?.related;
      })
      .toEqual(['shore', 'embankment', 'bluff']);

    // Simulate a genuine re-save with a fresh lookup+star cycle (fresh navigation, new
    // selection) — gotoFixture re-navigates the page, which is enough to reset the in-page
    // card/trigger state without an extra explicit reload.
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: ORIGINAL_BODY });
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(card).toContainText('A financial institution.', { timeout: 10_000 });
    await card.locator('.save-btn').click();

    await expect
      .poll(async () => {
        const dump = await swStorageDump(context);
        const entry = JSON.parse(dump['saved:bank'] as string) as {
          senses: { related?: string[] }[];
        };
        return entry.senses[0]?.related;
      })
      .toBeUndefined();
  });

  test('a related tap always hits the network, even for an already-cached word/sentence/target', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: ORIGINAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText(
      'A financial institution.',
      { timeout: 10_000 },
    );
    expect(calls.count).toBe(1);

    const card = page.locator('bottom-sheet lookup-card');
    await card.locator('.refine-chip', { hasText: 'Related words' }).click();
    await expect.poll(() => calls.count, { timeout: 10_000 }).toBe(2);
  });
});
