/**
 * Regression lock for the default-prompt change (ADR adr-20260614-default-prompt-engeng).
 *
 * The previous default template (#53) dropped {context}, so the selected sentence never
 * reached the model. These tests assert the SHIPPED default template now sends both the
 * selected word and its surrounding sentence to Gemini, and still omits {url}/{title}
 * (data minimization). They also cover the target-language picker offering English (en).
 *
 * Gemini is intercepted on the CONTEXT because the real fetch originates in the service
 * worker (same reason as helpers.mockGemini).
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  storageDump,
  GEMINI_OK_BODY,
} from './helpers';
import { DEFAULT_TEMPLATE } from '../../app/src/domain/default-template';

const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';
const PARAGRAPH =
  'I sat on the grassy bank of the river all afternoon. The next day the bank approved my loan.';
const RIVER_SENTENCE = 'I sat on the grassy bank of the river all afternoon.';

test('default template sends the selected word AND its surrounding sentence to Gemini', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await context.route(GEMINI_GLOB, async (route) => {
    const raw = route.request().postData() ?? '';
    sentPrompt = (JSON.parse(raw) as { contents: { parts: { text: string }[] }[] }).contents[0]
      .parts[0].text;
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // Use the REAL shipped default template (cold cache → Gemini is called).
  await seedSettings(page, { promptTemplate: DEFAULT_TEMPLATE, targetLang: 'vi' });
  await gotoFixture(page, PARAGRAPH);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank'); // first "bank" → the river sentence
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // The fix: word + surrounding sentence both reach the model.
  expect(sentPrompt).toContain('bank');
  expect(sentPrompt).toContain(RIVER_SENTENCE);
  // Data minimization (spec P2): the page URL/title are never injected by the default template.
  expect(sentPrompt).not.toContain('test.fixture');
  await page.close();
});

test('English (en) is a selectable target language and is persisted on Save', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present → settings screen, not onboarding
  await page.reload();
  await page.waitForSelector('settings-form');

  await page.locator('settings-form #target').selectOption('en');
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');

  const dump = await storageDump(page);
  expect((dump.settings as { targetLang: string }).targetLang).toBe('en');
  await page.close();
});
