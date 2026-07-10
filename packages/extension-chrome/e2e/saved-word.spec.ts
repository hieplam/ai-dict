import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';
import type { BrowserContext } from '@playwright/test';

/**
 * Read the extension's chrome.storage.local via the service worker, matching the established
 * pattern in error-reporting.spec.ts. `page` at this point in each test is the http://test.fixture/
 * content page (needed so the card/side-panel keeps its live DOM state for further interaction),
 * and `page.evaluate` runs in that page's main world, which has no `chrome` global — only the
 * service worker (an extension context) does.
 */
async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('B1 save word (star)', () => {
  test('tapping the star persists a saved:<word> entry matching the ratified schema', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toContainText('Saved');

    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.word).toBe('bank');
    expect(entry.status).toBe('learning');
    expect(typeof entry.savedAt).toBe('number');
    expect(entry.senses).toHaveLength(1);
    expect(entry.senses[0].definition).toContain('financial institution');
    expect(entry.senses[0].translation).toBe('');
    expect(entry.senses[0].sentence.length).toBeGreaterThan(0);
    expect(typeof entry.senses[0].url).toBe('string');
    expect(typeof entry.senses[0].title).toBe('string');

    const index = JSON.parse((dump['saved:index'] as string | undefined) ?? '[]');
    expect(index).toContain('bank');
  });

  test('tapping the star again removes the saved entry', async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeUndefined();
  });

  test('saving from the side panel persists sentence/url/title from the live mirror', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await doLookup(page);
    const panelStar = panel.locator('side-panel-view .save-btn');
    await expect(panelStar).toBeVisible({ timeout: 10_000 });
    await panelStar.click();

    await expect.poll(async () => (await storageDump(panel))['saved:bank']).toBeDefined();
    const dump = await storageDump(panel);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses[0].sentence.length).toBeGreaterThan(0);
    expect(entry.senses[0].url).toContain('http');
  });

  test('history.clear does not remove saved words (independent keyspace)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);
    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    // Sent from a second extension-origin page (not the SW itself — a self-sent
    // chrome.runtime.sendMessage from the SW has no "receiving end" and rejects) and not from
    // `page`, which is still the http://test.fixture/ content page with no `chrome` global.
    const utilPage = await context.newPage();
    await utilPage.goto(`chrome-extension://${extensionId}/options.html`);
    await utilPage.evaluate(() => chrome.runtime.sendMessage({ type: 'history.clear' }));

    const dump = await swStorageDump(context);
    expect(dump['saved:bank']).toBeDefined();
    expect(
      Object.keys(dump).filter((k) => k.startsWith('history:') && k !== 'history:index'),
    ).toHaveLength(0);
  });
});

const GEMINI_WITH_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.',
          },
        ],
      },
    },
  ],
});

test.describe('B2 rich context capture (translation)', () => {
  test('tapping the star persists a real translation when the model emits a TRANSLATION line', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: GEMINI_WITH_TRANSLATION_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    // The visible card never leaks the machine-readable signal lines.
    await expect(page.locator('bottom-sheet lookup-card')).not.toContainText('TRANSLATION:');
    await expect(page.locator('bottom-sheet lookup-card')).not.toContainText('DEFINED_AS:');

    const star = page.locator('bottom-sheet lookup-card .save-btn');
    await star.click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    // New in B2: translation is populated with real content, not ''.
    expect(entry.senses[0].translation).toBe('ngân hàng');
    // Regression guard (B1): definition/sentence/url/title are still correctly populated and
    // the machine-readable signal lines never leak into the stored definition.
    expect(entry.senses[0].definition).toContain('financial institution');
    expect(entry.senses[0].definition).not.toContain('TRANSLATION:');
    expect(entry.senses[0].definition).not.toContain('DEFINED_AS:');
    expect(entry.senses[0].sentence.length).toBeGreaterThan(0);
    expect(typeof entry.senses[0].url).toBe('string');
    expect(typeof entry.senses[0].title).toBe('string');
  });

  test('a mocked response with no TRANSLATION line still saves translation as "" (B1 back-compat)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context); // default GEMINI_OK_BODY — no signal lines at all
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page);

    await page.locator('bottom-sheet lookup-card .save-btn').click();
    await expect.poll(async () => (await swStorageDump(context))['saved:bank']).toBeDefined();

    const dump = await swStorageDump(context);
    const entry = JSON.parse(dump['saved:bank'] as string);
    expect(entry.senses[0].translation).toBe('');
    expect(entry.senses[0].definition).toContain('financial institution');
  });
});
