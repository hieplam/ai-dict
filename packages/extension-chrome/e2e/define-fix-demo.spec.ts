/**
 * Demo recording: proves the z-index fix on a page that has a positive-z stacking
 * context wrapping the selectable text (same shape as support.claude.com's `z-3`
 * heading container). Without the fix, the trigger paints behind the heading,
 * hit-testing returns the heading, capture-phase mousedown dismisses the bubble,
 * and the click never fires. With the fix, the trigger wins hit-testing, the
 * click event reaches the inner button, and the bottom sheet renders.
 *
 * Not part of the normal suite — intended to produce a Playwright trace + video
 * artifact for manual inspection. Run with:
 *   bunx playwright test e2e/define-fix-demo.spec.ts --headed
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { seedSettings, mockGemini } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const videoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.kanna/demos/define-fix',
);

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
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    });
    await use(context);
    await context.close();
  },
});

const FIXTURE_HTML = `
<html>
  <head><meta charset="utf-8" /><title>z-index regression fixture</title>
  <style>
    body { font: 16px/1.5 system-ui; margin: 0; padding: 0; }
    /* Reproduces the support.claude.com pattern: an article heading wrapped in a
       positive-z stacking context that would occlude any z:auto fixed overlay. */
    .stack-wrap { position: relative; z-index: 3; padding: 16px 24px; background: #fff; }
    h1 { margin: 0; padding: 24px 0; font-size: 28px; }
    p { padding: 16px 24px; }
  </style></head>
  <body>
    <div class="stack-wrap"><h1 id="t">Claude Cowork June 2026 usage promotion</h1></div>
    <p>Select a word in the heading above and click Define.</p>
  </body>
</html>`;

import { mkdir } from 'node:fs/promises';
const DEMO_DIR = videoDir;

test('z-index fix: Define click reaches the workflow on a page that wraps the heading in a z:3 stacking context', async ({
  context,
}) => {
  await mkdir(DEMO_DIR, { recursive: true });
  const calls = await mockGemini(context);
  const page = await context.newPage();
  // Seed settings via the options page so the workflow has a key (hits the network path).
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  await page.goto(`chrome-extension://${new URL(sw.url()).hostname}/options.html`);
  await seedSettings(page);

  // Fixture page reproducing the z-3 stacking context bug shape.
  await page.route('http://demo.fixture/', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML }),
  );
  await page.goto('http://demo.fixture/');
  await page.waitForTimeout(1_000); // let content scripts settle
  await page.screenshot({ path: `${DEMO_DIR}/01-page-loaded.png`, fullPage: false });

  // 1) Select "Claude" inside the heading wrapped by z-3 container.
  await page.evaluate(() => {
    const h = document.getElementById('t')!;
    const tn = h.firstChild!;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 6); // "Claude"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DEMO_DIR}/02-trigger-visible.png` });

  // 2) Confirm the trigger wins hit-testing (this is the assertion the fix is for).
  const atCenter = await page.evaluate(() => {
    const t = document.querySelector('lookup-trigger')!;
    const r = t.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
  });
  expect(atCenter).toBe('LOOKUP-TRIGGER');

  // 3) Click Define → bottom sheet renders the result.
  await page.locator('lookup-trigger').click();
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DEMO_DIR}/03-result-rendered.png` });

  await page.close();
});
