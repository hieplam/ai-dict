/**
 * Provider fallback + picker e2e (Task 12).
 *
 * Drives the real content-script → service-worker flow in bundled Chromium with the
 * unpacked extension. Covers the three card metadata behaviours:
 *   1. the provider badge names the answering provider;
 *   2. any-failure fallback silently switches to the next configured provider and
 *      shows a "… unavailable — answered by …" note;
 *   3. the one-shot picker re-runs the same lookup against a chosen provider.
 *
 * Provider fetches originate in the SW, so all endpoints are faked via context.route
 * (see helpers), exactly like lookup.spec.ts.
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  mockOpenAI,
  mockAnthropic,
} from './helpers';

test('badge names the answering provider (Gemini)', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { provider: 'gemini' }); // only the Gemini key → no picker, just a badge
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('financial institution', { timeout: 10_000 });
  await expect(card.locator('.prov-badge')).toHaveText('Gemini');
  await page.close();
});

test('any-failure fallback: Gemini 500 → Claude answers, with a fallback note', async ({
  context,
  extensionId,
}) => {
  const gemini = await mockGemini(context, { status: 500 }); // primary fails
  const anthropic = await mockAnthropic(context); // configured fallback answers
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { provider: 'gemini', anthropicApiKey: 'sk-ant-e2e' });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('via Claude', { timeout: 10_000 });
  await expect(card.locator('.prov-badge')).toHaveText('Claude');
  await expect(card.locator('.fallback-note')).toContainText('Gemini unavailable');
  await expect.poll(() => gemini.count, { timeout: 5_000 }).toBe(1);
  await expect.poll(() => anthropic.count, { timeout: 5_000 }).toBe(1);
  await page.close();
});

test('one-shot picker: switch from Gemini to ChatGPT re-runs the lookup', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const openai = await mockOpenAI(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // Two keys → the picker appears. cacheEnabled:false so the switch actually re-fetches
  // (the cache key ignores provider; the router also bypasses the cache on a manual pick).
  await seedSettings(page, {
    provider: 'gemini',
    openaiApiKey: 'sk-e2e',
    cacheEnabled: false,
  });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card.locator('.prov-badge')).toHaveText('Gemini', { timeout: 10_000 });

  // Open the picker and choose ChatGPT.
  await card.locator('.prov-switch').click();
  await card.locator('.prov-menu [data-provider="openai"]').click();

  await expect(card.locator('.prov-badge')).toHaveText('ChatGPT', { timeout: 10_000 });
  await expect(card).toContainText('via OpenAI');
  await expect.poll(() => openai.count, { timeout: 5_000 }).toBe(1);
  await page.close();
});
