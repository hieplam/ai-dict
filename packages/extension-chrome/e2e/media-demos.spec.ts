/**
 * Media kit — demo recordings: the side-panel/history walkthrough and the live
 * theme-switch walkthrough, recorded as Playwright videos and converted to the
 * mp4+gif pairs under docs/media/demos/. Not part of the normal suite — no
 * behavioural assertions beyond "the flow rendered" (the *.spec.ts siblings own
 * those). The hero videos (context-bank, define flow) come from
 * context-bank-demo.spec.ts and readme-demo.spec.ts.
 *
 * Each test drives its own recording context and saves the finished clip to a
 * stable path via video.saveAs():
 *   .kanna/demos/side-panel-demo.webm
 *   .kanna/demos/themes-demo.webm
 *
 * (Re)record with:
 *   PLAYWRIGHT_RUN_MEDIA_KIT=1 bunx playwright test e2e/media-demos.spec.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, expect, chromium, type Page } from '@playwright/test';
import { seedSettings, selectWord, openTrigger } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_MEDIA_KIT === '1';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const demosDir = path.resolve(here, '../../../.kanna/demos');

const launch = (videoDir: string, size: { width: number; height: number }) =>
  chromium.launchPersistentContext('', {
    headless: false,
    args: [
      ...(E2E_HEADLESS ? ['--headless=new'] : []),
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
    ],
    viewport: size,
    recordVideo: { dir: videoDir, size },
  });

// Same essay + word-aware stub as media-kit.spec.ts so all assets tell one story.
const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>The Quiet Art of Noticing</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #faf9f7; color: #1f2328;
         font: 18px/1.7 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 56px 28px 80px; }
  h1 { font-family: Georgia, serif; font-size: 40px; margin: 0 0 16px; }
  p { margin: 0 0 22px; }
</style></head>
<body><div class="wrap"><h1>The Quiet Art of Noticing</h1>
<p id="para">The best ideas often come from serendipity rather than from a careful plan: you go looking for one thing and stumble onto something far better, and the trick is simply to notice it when it happens.</p>
</div></body></html>`;

const SERENDIPITY_MD = [
  '1. **IPA** /ˌserənˈdɪpəti/',
  '2. **Part of Speech (POS)** Noun',
  '3. **Eng -> Eng** The finding of valuable or pleasant things by chance when you are not looking for them.',
  '4. **Eng -> vi** sự tình cờ may mắn; cơ duyên',
  '5. **Example** It was pure serendipity that we found such a great restaurant. Thật là một sự tình cờ may mắn khi chúng tôi tìm thấy một nhà hàng tuyệt vời như vậy.',
].join('\n');

const STUMBLE_MD = [
  '1. **IPA** /ˈstʌmbəl/',
  '2. **Part of Speech (POS)** Verb',
  '3. **Eng -> Eng** To find or discover something by chance, without planning or expecting to.',
  '4. **Eng -> vi** tình cờ gặp được; vô tình phát hiện ra',
  '5. **Example** He stumbled onto the answer while tidying his desk. Anh ấy tình cờ tìm ra câu trả lời khi đang dọn bàn làm việc.',
].join('\n');

const DEMO_OUTPUT_FORMAT = [
  '1. **IPA**',
  '2. **Part of Speech (POS)**',
  '3. **Eng -> Eng** (learner-style definition in simple English)',
  '4. **Eng -> {target_lang}** (translation)',
  '5. **Example** (one short sentence in English + its {target_lang} translation)',
].join('\n');

const SHIPPED_OUTPUT_FORMAT = [
  '1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).',
  '2. **Eng -> {target_lang}** — translate the full meaning into the selected language.',
].join('\n');

const geminiBody = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

const beat = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Synthetic cursor (headless Chromium doesn't paint the real pointer into recordings). */
async function addCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      background: 'rgba(20,20,20,.78)',
      boxShadow: '0 0 0 3px rgba(255,255,255,.85), 0 2px 8px rgba(0,0,0,.35)',
      transform: 'translate(240px, 320px)',
      transition: 'transform .55s cubic-bezier(.22,.61,.36,1)',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(c);
  });
}

async function moveCursorTo(page: Page, locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ x, y }) => {
      const c = document.getElementById('__demo_cursor');
      if (c) c.style.transform = `translate(${x}px, ${y}px)`;
    },
    { x: box.x + box.width / 2 - 10, y: box.y + box.height / 2 - 10 },
  );
  await beat(page, 700);
}

async function pulseCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.getElementById('__demo_cursor');
    if (c) {
      c.style.transition = 'transform .12s ease';
      c.style.transform += ' scale(.7)';
    }
  });
  await beat(page, 150);
  await page.evaluate(() => {
    const c = document.getElementById('__demo_cursor');
    if (c) c.style.transition = 'transform .55s cubic-bezier(.22,.61,.36,1)';
  });
}

test.describe('media kit — demo recordings', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_MEDIA_KIT=1 to (re)record docs/media demos');

  test('side panel: focused lookup, history recall, delete', async () => {
    const size = { width: 480, height: 760 };
    const context = await launch(path.join(demosDir, 'side-panel-raw'), size);
    try {
      await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
        const body = route.request().postData() ?? '';
        // The word is repeated in the request (it's in {word} AND the {context}
        // sentence), so route on the {word} line specifically: 'stumble' as the
        // looked-up word vs. merely appearing inside serendipity's context.
        const md = /Word\/phrase:\s*\\?"stumble/i.test(body) ? STUMBLE_MD : SERENDIPITY_MD;
        await route.fulfill({ status: 200, contentType: 'application/json', body: geminiBody(md) });
      });

      let sw = context.serviceWorkers()[0];
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      const extensionId = new URL(sw.url()).hostname;

      // Prep (off-camera page): seed settings and build two history entries.
      const prep = await context.newPage();
      await prep.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(prep, { outputFormat: DEMO_OUTPUT_FORMAT, saveHistory: true });
      await prep.route('http://demo.reader/', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE_HTML }),
      );
      await prep.goto('http://demo.reader/');
      await prep.waitForTimeout(1_000);
      await selectWord(prep, 'para', 'stumble');
      await openTrigger(prep);
      await expect(prep.locator('bottom-sheet lookup-card')).toContainText('stumble', {
        timeout: 10_000,
      });
      await prep.keyboard.press('Escape');
      await prep.evaluate(() => window.getSelection()?.removeAllRanges());
      await prep.waitForTimeout(2_100); // per-tab lookup cooldown
      await selectWord(prep, 'para', 'serendipity');
      await openTrigger(prep);
      await expect(prep.locator('bottom-sheet lookup-card')).toContainText('IPA', {
        timeout: 10_000,
      });
      await prep.waitForTimeout(800);
      await prep.close();

      // On-camera: the side panel itself.
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
      const view = panel.locator('side-panel-view');
      await view.waitFor({ state: 'attached', timeout: 5_000 });
      await expect(view).toContainText('serendipity', { timeout: 5_000 });
      await beat(panel, 1_800); // read the focused definition
      await addCursor(panel);

      // Recall the earlier word from Recent. Target by aria-label — serendipity's
      // row ALSO contains the word 'stumble' in its context snippet, so hasText
      // would match both rows.
      const stumbleItem = view.getByRole('button', { name: 'Show definition of stumble' });
      await stumbleItem.scrollIntoViewIfNeeded();
      await moveCursorTo(panel, stumbleItem);
      await pulseCursor(panel);
      await stumbleItem.click();
      await expect(view).toContainText('discover something by chance', { timeout: 5_000 });
      await beat(panel, 2_000); // the older lookup is back in focus

      // Delete it from history + cache with the per-row control.
      const del = view.getByRole('button', { name: 'Delete stumble from history and cache' });
      await moveCursorTo(panel, del);
      await pulseCursor(panel);
      await del.click();
      await expect(stumbleItem).toHaveCount(0);
      await beat(panel, 1_400);

      // saveAs must run after the page closes (video finalized) but BEFORE the
      // context closes — afterwards the artifact channel is gone.
      const video = panel.video();
      await panel.close();
      await mkdir(demosDir, { recursive: true });
      await video?.saveAs(path.join(demosDir, 'side-panel-demo.webm'));
    } finally {
      await context.close().catch(() => {});
    }
  });

  test('themes: live preview across sepia, dark, high contrast', async () => {
    const size = { width: 1180, height: 820 };
    const context = await launch(path.join(demosDir, 'themes-raw'), size);
    try {
      let sw = context.serviceWorkers()[0];
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      const extensionId = new URL(sw.url()).hostname;

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: SHIPPED_OUTPUT_FORMAT, apiKey: 'AIza-demo' });
      await page.reload();
      const form = page.locator('settings-form');
      await form.waitFor();
      await beat(page, 1_400); // take in the sepia settings page
      await addCursor(page);

      const seg = (pref: string) => form.locator(`#theme button[data-pref="${pref}"]`);
      await seg('dark').scrollIntoViewIfNeeded();
      await beat(page, 600);

      for (const pref of ['dark', 'contrast', 'sepia'] as const) {
        await moveCursorTo(page, seg(pref));
        await pulseCursor(page);
        await seg(pref).click();
        await expect(form).toHaveAttribute('data-ad-theme', pref);
        await beat(page, 1_500); // hold: the whole page re-themes live, before Save
      }

      const save = form.locator('#save');
      await moveCursorTo(page, save);
      await pulseCursor(page);
      await save.click();
      await beat(page, 1_100);

      const video = page.video();
      await page.close();
      await mkdir(demosDir, { recursive: true });
      await video?.saveAs(path.join(demosDir, 'themes-demo.webm'));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
