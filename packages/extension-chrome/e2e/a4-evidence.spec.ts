/**
 * A4 before/after evidence: a short recorded flow demonstrating the keyboard commands.
 * Not part of the normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after A4_OUT_DIR=/abs/path \
 *     bunx playwright test a4-evidence
 * Capture BEFORE from a `master` build (no chrome.commands wiring) and AFTER from the branch
 * build, then host the .webm per the private-repo rule (pr-assets branch + same-origin
 * github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium, type Page } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, getServiceWorker, relayCommand } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.A4_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 560 };

/** On-screen caption so a headless recording can visually mark the instant a simulated
 * chrome.commands relay fires (there is no real key-press to show — same honesty technique as
 * media-demos.spec.ts's synthetic cursor overlay for a pointer headless Chromium doesn't paint). */
async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    let el = document.getElementById('__a4_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__a4_caption';
      Object.assign(el.style, {
        position: 'fixed',
        top: '16px',
        left: '16px',
        zIndex: '2147483647',
        font: '600 15px/1.4 -apple-system, sans-serif',
        background: '#1f2328',
        color: '#fff',
        padding: '8px 14px',
        borderRadius: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,.3)',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

test.describe('A4 keyboard-only flow — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record A4 before/after video');

  test(`keyboard-only define + dismiss (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `a4-${LABEL}-raw`);
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: SIZE,
      recordVideo: { dir: videoDir, size: SIZE },
    });
    try {
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
          }),
        }),
      );

      const sw = await getServiceWorker(context);
      const extensionId = new URL(sw.url()).hostname;

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: 'Define {word}' });
      await gotoFixture(page, 'The river bank is steep here.');
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'river bank');
      await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
      await caption(page, '⌨ define-selection');
      await page.waitForTimeout(500);
      await relayCommand(sw, 'define-selection');
      await page.waitForTimeout(1_800); // hold on the outcome (card on `after`, nothing on `before`)

      await caption(page, '⌨ dismiss-lookup');
      await page.waitForTimeout(500);
      await relayCommand(sw, 'dismiss-lookup');
      await page.waitForTimeout(1_200);

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `a4-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
