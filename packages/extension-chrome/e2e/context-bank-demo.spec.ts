/**
 * README hero demo: the extension's headline strength — it reads the *sentence*,
 * not just the word. The same word "bank" is looked up in two different sentences
 * and comes back with two different, correct senses (riverside vs. money business),
 * each translated to Vietnamese.
 *
 * Not part of the normal suite (no behavioural assertions beyond "each card renders
 * the right sense"). Its job is to produce a watchable Playwright video that becomes
 * the README's looping GIF. Gemini is mocked — but *context-aware*: the stub reads
 * the outgoing request body and returns the riverside sense only when the request
 * carries the river sentence, the money sense only when it carries the loan
 * sentence. So the recording faithfully shows context driving the result, with no
 * real network call. This mirrors e2e/readme-demo.spec.ts.
 *
 * Run with:
 *   bunx playwright test e2e/context-bank-demo.spec.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { seedSettings } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const videoDir = path.resolve(here, '../../../.kanna/demos/context-bank');

const VIEWPORT = { width: 1200, height: 720 };

// Override the standard fixture to enable recordVideo on the persistent context.
const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: VIEWPORT,
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    await use(context);
    await context.close();
  },
});

// A custom Card format (the only user-editable piece). buildPrompt wraps it in the
// code-owned envelope, which always injects {word} AND {context}, so the surrounding
// sentence reaches the model — the whole point being demonstrated. Seeding it means the
// request body carries the sentence, which the context-aware mock routes on.
const DEMO_OUTPUT_FORMAT = [
  '1. **IPA**',
  '2. **Part of Speech (POS)**',
  '3. **Eng -> Eng** (learner-style definition in simple English)',
  '4. **Eng -> {target_lang}** (translation)',
  '5. **Example** (one short sentence in English + its {target_lang} translation)',
].join('\n');

// A clean reading page: the same word "bank" sits in two sentences with opposite
// senses, each in its own <p> so the selection range is trivial and the extracted
// context sentence is unambiguous.
const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>A Day by the Water</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #faf9f7; color: #1f2328;
         font: 19px/1.75 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 56px 28px 80px; }
  .eyebrow { letter-spacing: .14em; text-transform: uppercase; font-size: 12px;
             color: #8a8f98; font-weight: 600; margin: 0 0 14px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 38px; line-height: 1.15;
       margin: 0 0 16px; letter-spacing: -.01em; }
  .byline { color: #6b7280; font-size: 14px; margin: 0 0 34px; }
  p { margin: 0 0 24px; }
</style></head>
<body>
  <div class="wrap">
    <p class="eyebrow">Memoir</p>
    <h1>A Day by the Water</h1>
    <p class="byline">By A. Reader &middot; 4 min read</p>
    <p id="para-river">I sit on the grassy bank of the river all afternoon, watching the light break apart on the water and listening to it move over the stones.</p>
    <p id="para-money">The next day the bank approved my loan, and the little house at the end of the lane was finally, impossibly, ours.</p>
  </div>
</body></html>`;

// Mocked Gemini markdown — the shipped 5-section default format. Two senses of "bank".
const RIVER_MD = [
  '1. **IPA** /bæŋk/',
  '2. **Part of Speech (POS)** Noun',
  '3. **Eng -> Eng** The land along the side of a river or lake; the sloping ground at the water’s edge.',
  '4. **Eng -> vi** bờ (sông, hồ); bờ đất ven nước',
  '5. **Example** We spread a blanket on the grassy bank of the river. Chúng tôi trải một tấm chăn trên bờ sông đầy cỏ.',
].join('\n');
const MONEY_MD = [
  '1. **IPA** /bæŋk/',
  '2. **Part of Speech (POS)** Noun',
  '3. **Eng -> Eng** A business that keeps people’s money safe and lends it out, and provides other financial services.',
  '4. **Eng -> vi** ngân hàng',
  '5. **Example** The bank approved my loan the next day. Ngân hàng đã phê duyệt khoản vay của tôi vào ngày hôm sau.',
].join('\n');

const geminiBody = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

const beat = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Drop a synthetic cursor into the page (headless Chromium doesn't paint the real one). */
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
      transform: 'translate(360px, 470px)',
      transition: 'transform .55s cubic-bezier(.22,.61,.36,1)',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(c);
  });
}

async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const c = document.getElementById('__demo_cursor');
      if (c) c.style.transform = `translate(${x}px, ${y}px)`;
    },
    { x, y },
  );
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

/** Select `word` inside `#${id}` and raise mouseup so the floating trigger appears. */
async function selectWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const p = document.getElementById(id)!;
      const node = p.firstChild!;
      const text = node.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { id, word },
  );
}

/** The one reusable beat: glide onto Define, click, wait for the card to render `expect`. */
async function lookup(page: Page, id: string, expectText: string): Promise<void> {
  await selectWord(page, id, 'bank');
  const trigger = page.locator('lookup-trigger');
  await trigger.waitFor({ state: 'attached', timeout: 5_000 });
  await beat(page, 1_000); // viewer sees the highlight + the floating Define button

  const box = await trigger.boundingBox();
  if (box) {
    await moveCursor(page, box.x + box.width / 2 - 10, box.y + box.height / 2 - 10);
    await beat(page, 700);
    await pulseCursor(page);
  }
  await trigger.click();

  await beat(page, 850); // loading state during the mocked delay
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText(expectText, { timeout: 10_000 });
  await beat(page, 2_600); // hold on the payoff
}

test('context demo: same word "bank", two sentences, two correct senses', async ({ context }) => {
  await mkdir(videoDir, { recursive: true });

  // Context-aware Gemini mock: read the outgoing request and answer with the sense
  // that matches the sentence the extension actually sent. A ~1.1s delay keeps the
  // loading state on screen.
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = route.request().postData() ?? '';
    // Route on words unique to the river SENTENCE — not "water", which also appears in
    // the page title ("A Day by the Water") now wired into the prompt and would then
    // match the money request too.
    const isRiver = /river|grassy/i.test(body);
    await new Promise((r) => setTimeout(r, 1_100));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: geminiBody(isRiver ? RIVER_MD : MONEY_MD),
    });
  });

  // Seed a working key + the default (context-injecting) template on a throwaway page,
  // then close it so the recorded page opens straight on the article.
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const seedPage = await context.newPage();
  await seedPage.goto(`chrome-extension://${new URL(sw.url()).hostname}/options.html`);
  await seedSettings(seedPage, { outputFormat: DEMO_OUTPUT_FORMAT, targetLang: 'vi' });
  await seedPage.close();

  const page = await context.newPage();
  await page.route('http://demo.reader/', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE_HTML }),
  );
  await page.goto('http://demo.reader/');
  await beat(page, 1_200); // let the reader take in the page
  await addCursor(page);

  // 1) "bank" in the RIVER sentence → riverside sense (Bờ sông).
  await lookup(page, 'para-river', 'bờ');

  // Dismiss the card with Esc, as the README tells users to.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await beat(page, 900);

  // 2) The SAME word "bank" in the MONEY sentence → financial sense (Ngân hàng).
  await lookup(page, 'para-money', 'ngân hàng');

  await beat(page, 800);
  await page.close();
});
