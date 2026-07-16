/**
 * Provider-specific error mapping e2e: lookup-errors.spec.ts proves the Gemini error table;
 * this spec proves the mapper's provider-aware wording for OpenAI — the message must name
 * OpenAI, not Google. Gemini is left unconfigured (apiKey: '') so the fallback pool cannot
 * silently answer and mask the error.
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  mockOpenAI,
} from './helpers';

test('OpenAI 401 surfaces "OpenAI rejected the API key."', async ({ context, extensionId }) => {
  const gemini = await mockGemini(context);
  const openai = await mockOpenAI(context, { status: 401, body: '{}' });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, {
    provider: 'openai',
    openaiApiKey: 'sk-e2e',
    apiKey: '', // no Gemini key → no fallback candidate to mask the OpenAI error
    cacheEnabled: false,
  });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('OpenAI rejected the API key.', { timeout: 10_000 });
  expect(openai.count).toBe(1);
  expect(gemini.count).toBe(0);

  await page.close();
});
