/**
 * A12 — non-English source pages. End-to-end lock, through the real service worker, that:
 *  1. a page-level `<html lang>` reaches the prompt's {source_lang} slot and the card's display;
 *  2. no lang attribute anywhere falls back to the neutral auto-infer phrase, never "English";
 *  3. a nearest-ancestor `lang` override beats the page-level default;
 *  4. the card's manual override re-runs the lookup with a fresh (non-cached) fetch.
 *
 * Gemini is intercepted via helpers.mockGemini, which routes on the CONTEXT (not the page)
 * because the real fetch originates in the extension's service worker, and auto-detects whether
 * sw.ts's onLookupChunk opt-in routes this build's Gemini traffic through the streaming SSE
 * endpoint or the plain JSON one — a hand-rolled `context.route` that only fulfills
 * `application/json` would silently break the moment sw.ts opts into streaming.
 */
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

interface GeminiRequestBody {
  contents: { parts: { text: string }[] }[];
}

function firstPromptText(postData: string): string {
  return (JSON.parse(postData) as GeminiRequestBody).contents[0]?.parts[0]?.text ?? '';
}

test('a page-level lang attribute reaches {source_lang} and the card display', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await mockGemini(context, {
    onRequest: (postData) => {
      sentPrompt = firstPromptText(postData);
    },
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'Le petit chat noir dort sur le tapis.');
  await page.evaluate(() => {
    document.documentElement.lang = 'fr';
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'petit');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  expect(sentPrompt).toContain('learners of fr');
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: French',
  );
  await page.close();
});

test('no lang attribute anywhere falls back to the auto-infer phrase, never "English"', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await mockGemini(context, {
    onRequest: (postData) => {
      sentPrompt = firstPromptText(postData);
    },
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'The bank by the river is steep.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  expect(sentPrompt).not.toContain('learners of English');
  expect(sentPrompt).toContain('infer the source language');
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Auto-detect',
  );
  await page.close();
});

test('a nearest-ancestor lang wins over the page-level default', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'wrapped text here');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
    const p = document.getElementById('t')!;
    const wrapper = document.createElement('div');
    wrapper.lang = 'ja';
    p.replaceWith(wrapper);
    wrapper.append(p);
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'wrapped');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Japanese',
  );
  await page.close();
});

test("the card's manual override re-runs the lookup with a fresh (non-cached) fetch", async ({
  context,
  extensionId,
}) => {
  const prompts: string[] = [];
  const gemini = await mockGemini(context, {
    onRequest: (postData) => {
      prompts.push(firstPromptText(postData));
    },
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { targetLang: 'vi' });
  await gotoFixture(page, 'The bank by the river is steep.');
  await page.evaluate(() => {
    document.documentElement.lang = 'fr';
  });
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  expect(gemini.count).toBe(1);

  await page.locator('bottom-sheet lookup-card .src-lang-row__change').click();
  await page.locator('bottom-sheet lookup-card [data-code="ja"]').click();
  await expect(page.locator('bottom-sheet lookup-card .src-lang-row')).toContainText(
    'Source: Japanese',
    { timeout: 10_000 },
  );

  expect(gemini.count).toBe(2); // the override bypassed the cache — a fresh fetch fired
  expect(prompts[1]).toContain('learners of ja');
  await page.close();
});
