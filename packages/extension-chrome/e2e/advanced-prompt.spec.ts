/**
 * End-to-end lock for the Advanced full-prompt override (#62) and the Konami-gated Developer
 * viewer. Proves, through the real service worker:
 *  1. the Konami code (↑↑↓↓←→←→BA) reveals the Developer panel, which renders the assembled prompt
 *     (including live PII redaction of the demo title);
 *  2. a custom `promptEnvelope` replaces the built-in envelope in the request that reaches Gemini;
 *  3. editing the Advanced envelope in settings persists to `settings.promptEnvelope` on Save.
 *
 * Gemini is intercepted on the CONTEXT because the real fetch originates in the service worker
 * (same reason as helpers.mockGemini).
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  storageDump,
  mockGemini,
} from './helpers';

const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const;

test('the Konami code unlocks the Developer panel and shows the assembled prompt', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present → settings screen (not onboarding)
  await page.reload();
  await page.waitForSelector('settings-form');

  // The panel starts hidden; enter the Konami sequence with focus on a non-input element.
  await expect(page.locator('settings-form #devpanel')).toBeHidden();
  await page.locator('settings-form h1.title').click();
  for (const key of KONAMI) await page.keyboard.press(key);

  await expect(page.locator('settings-form #devpanel')).toBeVisible();
  const prompt = page.locator('settings-form #devprompt');
  await expect(prompt).toContainText('serendipity'); // demo word/context
  await expect(prompt).toContainText('[redact]'); // demo title PII redacted live
  await page.close();
});

test('a custom promptEnvelope replaces the built-in envelope in the Gemini request', async ({
  context,
  extensionId,
}) => {
  let sentPrompt = '';
  await mockGemini(context, {
    onRequest: (raw) => {
      sentPrompt = (JSON.parse(raw) as { contents: { parts: { text: string }[] }[] }).contents[0]
        .parts[0].text;
    },
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { promptEnvelope: 'CUSTOM ENVELOPE {word}' });
  await gotoFixture(page, 'The bank by the river is steep.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // The override IS the whole prompt: the built-in envelope (persona + constraints) is gone.
  expect(sentPrompt).toBe('CUSTOM ENVELOPE bank');
  expect(sentPrompt).not.toContain('Do not include any HTML');
  await page.close();
});

test('editing the Advanced envelope persists to settings.promptEnvelope on Save', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.reload();
  await page.waitForSelector('settings-form');

  // Expand the Advanced disclosure, then type a marker envelope and save.
  await page.locator('settings-form summary').click();
  const marker = 'MARKER ENVELOPE {word} in {target_lang}';
  await page.locator('settings-form #envelope').fill(marker);
  await page.locator('settings-form #save').click();
  await expect(page.locator('settings-form #status')).toHaveText('Settings saved');

  const settings = (await storageDump(page)).settings as Record<string, unknown>;
  expect(settings.promptEnvelope).toBe(marker);
  await page.close();
});
