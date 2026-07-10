/**
 * B1 before/after evidence: a short recorded flow showing select → Define → tap the star →
 * "Saved" confirmation. Not part of the normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B1_OUT_DIR=/abs/path \
 *     bunx playwright test b1-evidence
 * Capture BEFORE from a `master` build (no star exists on the card) and AFTER from the branch
 * build, then host the .webm per the private-repo rule (pr-assets branch + same-origin
 * github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B1_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

test.describe('B1 save word — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B1 before/after video');

  test(`select → Define → star → Saved (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `b1-${LABEL}-raw`);
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
        route.fulfill({ status: 200, contentType: 'application/json', body: GEMINI_OK_BODY }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page);
      await gotoFixture(page);
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'bank');
      await openTrigger(page);
      await page.waitForTimeout(1_400); // hold on the rendered definition

      const star = page.locator('bottom-sheet lookup-card .save-btn');
      if (await star.count()) await star.click(); // no-op on `before` (no star exists)
      await page.waitForTimeout(1_800); // hold on the "Saved" confirmation

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `b1-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
