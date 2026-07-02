/**
 * Media kit — screenshots (docs/media/screenshots): the README / landing-page /
 * store image set, captured from the REAL extension so every asset shows the
 * shipped Paperlight UI. Not part of the normal suite — no behavioural assertions
 * beyond "the surface rendered" (the *.spec.ts siblings own those). Page shots are
 * 1280×800 so the Chrome Web Store listing can reuse them directly.
 *
 * (Re)generate with:
 *   PLAYWRIGHT_RUN_MEDIA_KIT=1 bunx playwright test e2e/media-kit.spec.ts
 */
import { test, expect } from './fixtures';
import { seedSettings, selectWord, openTrigger } from './helpers';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';

const RUN = process.env.PLAYWRIGHT_RUN_MEDIA_KIT === '1';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/media/screenshots');
const shot = (name: string) => resolve(OUT, `${name}.png`);
const PAGE_SIZE = { width: 1280, height: 800 };
const PANEL_SIZE = { width: 420, height: 760 };

// The reading page every still is captured on — same essay as the README demo video,
// so the stills and the moving demo tell one continuous story. "serendipity" and
// "stumble" both live in #para's single text node so selectWord can range them.
const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>The Quiet Art of Noticing</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #faf9f7; color: #1f2328;
         font: 18px/1.7 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 56px 28px 80px; }
  .eyebrow { letter-spacing: .14em; text-transform: uppercase; font-size: 12px;
             color: #8a8f98; font-weight: 600; margin: 0 0 14px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 40px; line-height: 1.15;
       margin: 0 0 16px; letter-spacing: -.01em; }
  .byline { color: #6b7280; font-size: 14px; margin: 0 0 36px; }
  p { margin: 0 0 22px; }
</style></head>
<body>
  <div class="wrap">
    <p class="eyebrow">Essay</p>
    <h1>The Quiet Art of Noticing</h1>
    <p class="byline">By A. Reader &middot; 6 min read</p>
    <p>Good writing rarely arrives in a thunderclap. More often it is a matter of paying
       attention to the small things that, at first glance, seem to lead nowhere &mdash; an
       overheard phrase, a misremembered name, a detour on the way home.</p>
    <p id="para">The best ideas often come from serendipity rather than from a careful plan: you go looking for one thing and stumble onto something far better, and the trick is simply to notice it when it happens.</p>
    <p>That habit of noticing is not a talent you are born with. It is a muscle, and like any
       muscle it grows with use until the world starts handing you gifts you would once have
       walked straight past.</p>
  </div>
</body></html>`;

// The 5-section Card format the demo lookups are seeded with (a rich but real
// configuration — the same one the README demo videos use).
const DEMO_OUTPUT_FORMAT = [
  '1. **IPA**',
  '2. **Part of Speech (POS)**',
  '3. **Eng -> Eng** (learner-style definition in simple English)',
  '4. **Eng -> {target_lang}** (translation)',
  '5. **Example** (one short sentence in English + its {target_lang} translation)',
].join('\n');

// The SHIPPED default Card format (packages/app/src/domain/default-template.ts) —
// seeded for the settings still so the Translation section shows the true default.
const SHIPPED_OUTPUT_FORMAT = [
  '1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).',
  '2. **Eng -> {target_lang}** — translate the full meaning into the selected language.',
].join('\n');

const SERENDIPITY_MD = [
  '1. **IPA** /ˌserənˈdɪpəti/',
  '2. **Part of Speech (POS)** Noun',
  '3. **Eng -> Eng** The finding of valuable or pleasant things by chance when you are not looking for them. It’s about fortunate accidents.',
  '4. **Eng -> vi** sự tình cờ may mắn; sự may mắn bất ngờ; cơ duyên',
  '5. **Example** It was pure serendipity that we found such a great restaurant. Thật là một sự tình cờ may mắn khi chúng tôi tìm thấy một nhà hàng tuyệt vời như vậy.',
].join('\n');

const STUMBLE_MD = [
  '1. **IPA** /ˈstʌmbəl/',
  '2. **Part of Speech (POS)** Verb',
  '3. **Eng -> Eng** To find or discover something by chance, without planning or expecting to.',
  '4. **Eng -> vi** tình cờ gặp được; vô tình phát hiện ra',
  '5. **Example** He stumbled onto the answer while tidying his desk. Anh ấy tình cờ tìm ra câu trả lời khi đang dọn bàn làm việc.',
].join('\n');

const geminiBody = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

/** Word-aware Gemini stub: answers with the sense for the word the request carries. */
async function mockDictionary(context: BrowserContext): Promise<void> {
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = route.request().postData() ?? '';
    // Route on the {word} line — 'stumble' also appears inside serendipity's
    // {context} sentence, so a bare word match would answer with the wrong sense.
    const md = /Word\/phrase:\s*\\?"stumble/i.test(body) ? STUMBLE_MD : SERENDIPITY_MD;
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', body: geminiBody(md) });
  });
}

async function gotoArticle(page: Page): Promise<void> {
  await page.route('http://demo.reader/', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE_HTML }),
  );
  await page.goto('http://demo.reader/');
  await page.waitForTimeout(1_000); // let the content script boot + read settings
}

test.describe('media kit — screenshots (1280×800)', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_MEDIA_KIT=1 to (re)generate docs/media assets');

  test('select → Define bubble → result card', async ({ context, extensionId }) => {
    await mockDictionary(context);
    const page = await context.newPage();
    await page.setViewportSize(PAGE_SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { outputFormat: DEMO_OUTPUT_FORMAT });
    await gotoArticle(page);

    await selectWord(page, 'para', 'serendipity');
    await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('select-define') });

    await openTrigger(page);
    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('IPA', { timeout: 10_000 });
    await page.waitForTimeout(450); // let the sheet settle
    await page.screenshot({ path: shot('lookup-result') });
  });

  test('onboarding (first run)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize(PAGE_SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot('onboarding') });
  });

  test('settings page + section close-ups', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize(PAGE_SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { outputFormat: SHIPPED_OUTPUT_FORMAT, apiKey: 'AIza-demo' });
    await page.reload();
    const form = page.locator('settings-form');
    await form.waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot('settings') });

    const sections: Array<[string, string]> = [
      ['sec-conn', 'settings-connection'],
      ['sec-trans', 'settings-translation'],
      ['sec-look', 'settings-appearance'],
      ['sec-priv', 'settings-privacy'],
    ];
    for (const [id, name] of sections) {
      await form.locator(`section[aria-labelledby="${id}"]`).screenshot({ path: shot(name) });
    }
  });

  test('side panel with a focused lookup + history', async ({ context, extensionId }) => {
    await mockDictionary(context);
    const page = await context.newPage();
    await page.setViewportSize(PAGE_SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { outputFormat: DEMO_OUTPUT_FORMAT, saveHistory: true });
    await gotoArticle(page);

    // Two lookups so Recent shows real history (respect the 2s per-tab cooldown).
    await selectWord(page, 'para', 'stumble');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('stumble', {
      timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(2_100);
    await selectWord(page, 'para', 'serendipity');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('IPA', {
      timeout: 10_000,
    });
    await page.waitForTimeout(800); // let the lookup persist to history

    // Send the lookup to the side panel (primes the SW focus cache) so the panel
    // opens on the definition, not the empty state — the real user journey.
    await page.locator('lookup-card button[data-act="side-panel"]').click();
    await page.waitForTimeout(400);

    const panel = await context.newPage();
    await panel.setViewportSize(PANEL_SIZE);
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.locator('side-panel-view').waitFor({ state: 'attached', timeout: 5_000 });
    await expect(panel.locator('side-panel-view')).toContainText('fortunate accidents', {
      timeout: 5_000,
    });
    await panel.waitForTimeout(500);
    await panel.screenshot({ path: shot('side-panel') });
  });

  test('result card in every theme (sepia, dark, contrast)', async ({ context, extensionId }) => {
    await mockDictionary(context);
    for (const theme of ['sepia', 'dark', 'contrast'] as const) {
      const page = await context.newPage();
      await page.setViewportSize(PAGE_SIZE);
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: DEMO_OUTPUT_FORMAT, theme });
      await gotoArticle(page);
      await selectWord(page, 'para', 'serendipity');
      await openTrigger(page);
      const card = page.locator('bottom-sheet lookup-card');
      await expect(card).toContainText('IPA', { timeout: 10_000 });
      await expect(card).toHaveAttribute('data-ad-theme', theme);
      await page.waitForTimeout(400);
      await card.screenshot({ path: shot(`card-${theme}`) });
      await page.close();
    }
  });
});
