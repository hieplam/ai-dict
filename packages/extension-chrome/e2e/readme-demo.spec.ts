/**
 * README demo recording: the canonical happy-path a new user sees — select a word
 * in an article, click the floating "Define" button, and read the definition card.
 *
 * Not part of the normal suite (no behavioural assertions beyond "the card renders").
 * Its job is to produce a watchable Playwright video that becomes the README's
 * looping GIF hero. Gemini is mocked (with a deliberate delay so the loading state
 * is visible) and the API key is seeded, i.e. "given the API key is set up" — so the
 * recording is deterministic and needs no real network call.
 *
 * Run with:
 *   bunx playwright test e2e/readme-demo.spec.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { seedSettings } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const videoDir = path.resolve(here, '../../../.kanna/demos/readme-define');

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

// A clean reading page so the demo looks like real-world use, with "serendipity"
// sitting in a single text node of #para (so the selection range is trivial).
const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>The Quiet Art of Noticing</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #faf9f7; color: #1f2328;
         font: 18px/1.7 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 60px 28px 80px; }
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

// Mocked Gemini markdown — mirrors the shipped default prompt's 5-section format and
// matches docs/screenshots/lookup-result.png exactly.
const SERENDIPITY_MD = [
  '1. **IPA** /ˌserənˈdɪpəti/',
  '2. **Part of Speech (POS)** Noun',
  '3. **Eng -> Eng** The finding of valuable or pleasant things by chance when you are not looking for them. It’s about fortunate accidents.',
  '4. **Eng -> vi** sự/ tình cờ may mắn; sự may mắn bất ngờ; cơ duyên',
  '5. **Example** It was pure serendipity that we found such a great restaurant. Thật là một sự tình cờ may mắn khi chúng tôi tìm thấy một nhà hàng tuyệt vời như vậy.',
].join('\n');
const GEMINI_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: SERENDIPITY_MD }] } }],
});

const beat = (page: import('@playwright/test').Page, ms: number) => page.waitForTimeout(ms);

test('readme demo: select serendipity, click Define, read the definition card', async ({
  context,
}) => {
  await mkdir(videoDir, { recursive: true });

  // Mock Gemini on the CONTEXT (the real fetch fires from the service worker) with a
  // ~1.1s delay so the loading state is visible in the recording.
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1_100));
    await route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_BODY });
  });

  // Seed a working key via the options page on a throwaway page → "given the API key
  // is set up correctly". Seeding here (then closing) keeps the recorded demo page
  // free of any options-page flash; it opens straight on the article.
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const seedPage = await context.newPage();
  await seedPage.goto(`chrome-extension://${new URL(sw.url()).hostname}/options.html`);
  await seedSettings(seedPage);
  await seedPage.close();

  const page = await context.newPage();
  await page.route('http://demo.reader/', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE_HTML }),
  );
  await page.goto('http://demo.reader/');
  await beat(page, 1_300); // let the reader take in the article

  // A synthetic cursor so "the user clicks Define" reads clearly in the video
  // (headless Chromium does not paint the real pointer into the recording).
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
      transform: 'translate(380px, 470px)',
      transition: 'transform .55s cubic-bezier(.22,.61,.36,1)',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(c);
  });

  // Select "serendipity" inside #para and raise mouseup so the trigger appears.
  await page.evaluate(() => {
    const p = document.getElementById('para')!;
    const node = p.firstChild!;
    const text = node.textContent ?? '';
    const start = text.indexOf('serendipity');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'serendipity'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const trigger = page.locator('lookup-trigger');
  await trigger.waitFor({ state: 'attached', timeout: 5_000 });
  await beat(page, 1_100); // viewer sees the highlight + the floating Define button

  // Glide the synthetic cursor onto the Define button, then click it.
  const box = await trigger.boundingBox();
  if (box) {
    await page.evaluate(
      ({ x, y }) => {
        const c = document.getElementById('__demo_cursor');
        if (c) c.style.transform = `translate(${x}px, ${y}px)`;
      },
      { x: box.x + box.width / 2 - 10, y: box.y + box.height / 2 - 10 },
    );
    await beat(page, 750);
    // brief click pulse
    await page.evaluate(() => {
      const c = document.getElementById('__demo_cursor');
      if (c) {
        c.style.transition = 'transform .12s ease';
        c.style.transform += ' scale(.7)';
      }
    });
    await beat(page, 160);
  }

  await trigger.click();

  // Loading state is on screen during the mocked delay.
  await beat(page, 900);

  // Result card renders the definition.
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('IPA', { timeout: 10_000 });
  await expect(card).toContainText('serendipity');

  await beat(page, 2_800); // hold on the payoff

  await page.close();
});
