import { test, expect } from './fixtures';
import { seedSettings, mockGemini, selectWord, openTrigger } from './helpers';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = process.env.PLAYWRIGHT_RUN_STORE_SHOTS === '1';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/store/chrome/screenshots',
);
const SIZE = { width: 1280, height: 800 };

// A realistic article body and a rich, deterministic definition for a polished listing shot.
// NOTE: "serendipity" is plain text in #t (no child element) so selectWord can select it.
const ARTICLE = `<!doctype html><meta charset="utf8"><title>The Atlas</title>
<style>body{margin:0;background:#faf7f0;color:#1c2b24;font:18px/1.7 Georgia,serif}
main{max-width:680px;margin:0 auto;padding:64px 28px}h1{font-size:34px;margin:0 0 18px}</style>
<main><h1>A Voyage of the Unplanned</h1>
<p id="t">It was a fortunate stroke of serendipity that the two researchers, chasing unrelated questions, met in the same dim archive and changed each other's work forever.</p></main>`;

const RICH = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              '## serendipity\n/ˌsɛr.ənˈdɪp.ɪ.ti/ · noun\n\n' +
              '**English** — the occurrence of events by chance in a happy or beneficial way.\n\n' +
              '**Tiếng Việt** — sự tình cờ may mắn.\n\n' +
              '*Example:* "A fortunate stroke of serendipity brought them together." — ' +
              '"Một sự tình cờ may mắn đã đưa họ đến với nhau."',
          },
        ],
      },
    },
  ],
});

test.describe('store screenshots (1280×800)', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_STORE_SHOTS=1 to (re)generate store assets');

  test('result card on an article', async ({ context, extensionId }) => {
    await mockGemini(context, { body: RICH });
    const page = await context.newPage();
    await page.setViewportSize(SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { hasKey: true, apiKey: 'AIza-demo', targetLang: 'vi' });

    await page.route('http://article.test/', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE }),
    );
    await page.goto('http://article.test/');
    await selectWord(page, 't', 'serendipity');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('serendipity', {
      timeout: 10_000,
    });
    await page.waitForTimeout(400); // let the card settle
    await page.screenshot({ path: `${OUT}/01-result-card.png` });
  });

  test('options / settings page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize(SIZE);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { hasKey: true, apiKey: 'AIza-demo', provider: 'gemini' });
    await page.reload();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/02-options.png` });
  });

  test('side panel with a lookup', async ({ context, extensionId }) => {
    await mockGemini(context, { body: RICH });
    const seed = await context.newPage();
    await seed.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(seed, { hasKey: true, apiKey: 'AIza-demo', saveHistory: true });
    await seed.route('http://article.test/', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE }),
    );
    await seed.goto('http://article.test/');
    await selectWord(seed, 't', 'serendipity');
    await openTrigger(seed);
    await seed.waitForTimeout(800); // let the lookup persist to history

    const panel = await context.newPage();
    await panel.setViewportSize(SIZE);
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.locator('side-panel-view').waitFor({ state: 'attached', timeout: 5_000 });
    await panel.waitForTimeout(400);
    await panel.screenshot({ path: `${OUT}/03-side-panel.png` });
  });
});
