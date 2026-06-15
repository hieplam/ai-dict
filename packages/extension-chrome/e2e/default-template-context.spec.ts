/**
 * Regression lock for the card-format / prompt-envelope split
 * (ADR adr-20260615-card-format-prompt-split).
 *
 * The prompt is assembled by buildPrompt: the user-editable `outputFormat` is wrapped
 * in a code-owned envelope that always injects the selected word, its surrounding
 * sentence, and the (PII-redacted) page title, plus the safety constraints. These
 * tests assert that pipeline end-to-end through the real service worker:
 *  A  word + sentence + page title reach Gemini; the page URL never does
 *  B  the "Card format" field round-trips through Save (stored as outputFormat)
 *  C  English (en) is a selectable, persisted target language
 *  D  PII in the page title is masked to [redact] before the network call
 *  F  a blank card format still yields a valid lookup with constraints intact
 *
 * Gemini is intercepted on the CONTEXT because the real fetch originates in the
 * service worker (same reason as helpers.mockGemini).
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
import { DEFAULT_OUTPUT_FORMAT } from '../../app/src/domain/default-template';

const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';
const PARAGRAPH =
  'I sat on the grassy bank of the river all afternoon. The next day the bank approved my loan.';
const RIVER_SENTENCE = 'I sat on the grassy bank of the river all afternoon.';
const PAGE_TITLE = 'River walks - Nature blog';

/** Run the canonical "bank" lookup with the default card format and capture the sent prompt. */
async function captureLookup(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  opts: { outputFormat?: string; title?: string } = {},
): Promise<string> {
  let sentPrompt = '';
  await context.route(GEMINI_GLOB, async (route) => {
    const raw = route.request().postData() ?? '';
    sentPrompt = (JSON.parse(raw) as { contents: { parts: { text: string }[] }[] }).contents[0]
      .parts[0].text;
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, {
    outputFormat: opts.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    targetLang: 'vi',
  });
  await gotoFixture(page, PARAGRAPH, opts.title ?? PAGE_TITLE);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank'); // first "bank" → the river sentence
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await page.close();
  return sentPrompt;
}

// A
test('default card format sends the word, its sentence, and the page title to Gemini', async ({
  context,
  extensionId,
}) => {
  const sentPrompt = await captureLookup(context, extensionId);

  expect(sentPrompt).toContain('bank'); // selected word
  expect(sentPrompt).toContain(RIVER_SENTENCE); // surrounding sentence (right sense)
  expect(sentPrompt).toContain(PAGE_TITLE); // page title now wired into the envelope
  expect(sentPrompt).not.toContain('test.fixture'); // page URL is still never sent
});

// B
test('the Card format field round-trips through Save (stored as outputFormat)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present → settings screen, not onboarding
  await page.reload();
  await page.waitForSelector('settings-form');

  const custom = '1. **Define** {word} simply.';
  await page.locator('settings-form #tpl').fill(custom);
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');
  await page.reload();
  await page.waitForSelector('settings-form');

  await expect(page.locator('settings-form #tpl')).toHaveValue(custom);
  const settings = (await storageDump(page)).settings as Record<string, unknown>;
  expect(settings.outputFormat).toBe(custom);
  expect(settings).not.toHaveProperty('promptTemplate'); // renamed, not double-written
  await page.close();
});

// C
test('English (en) is a selectable target language and is persisted on Save', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  await page.locator('settings-form #target').selectOption('en');
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');

  const dump = await storageDump(page);
  expect((dump.settings as { targetLang: string }).targetLang).toBe('en');
  await page.close();
});

// D
test('PII in the page title is masked to [redact] before the network call', async ({
  context,
  extensionId,
}) => {
  const sentPrompt = await captureLookup(context, extensionId, {
    title: 'Pay invoice — billing@acme.com',
  });

  expect(sentPrompt).toContain('[redact]');
  expect(sentPrompt).not.toContain('billing@acme.com');
});

// F
test('a blank Card format still yields a valid lookup with constraints intact', async ({
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
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  // Clear the only user-editable field and save.
  await page.locator('settings-form #tpl').fill('');
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');
  expect(((await storageDump(page)).settings as { outputFormat: string }).outputFormat).toBe('');

  await gotoFixture(page, PARAGRAPH, PAGE_TITLE);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  // An empty format must NOT break the lookup — the card still renders.
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // Word, context, title, and constraints all survive a blank format.
  expect(sentPrompt).toContain('bank');
  expect(sentPrompt).toContain(RIVER_SENTENCE);
  expect(sentPrompt).toContain(PAGE_TITLE);
  expect(sentPrompt).toContain('Do not include any HTML');
  await page.close();
});
