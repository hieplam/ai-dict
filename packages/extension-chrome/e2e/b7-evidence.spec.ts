/**
 * B7 before/after evidence: a short recorded flow showing three lookups of the same word, the
 * repeat-offender nudge appearing on the 3rd, and tapping its Save button. Not part of the
 * normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B7_OUT_DIR=/abs/path \
 *     bunx playwright test b7-evidence
 * Capture BEFORE from a `master` build (no nudge ever appears, however many times you look the
 * word up) and AFTER from the branch build, then host the .webm per the private-repo rule
 * (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B7_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

test.describe('B7 repeat-offender nudge — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B7 before/after video');

  test(`3x lookup → nudge → Save (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `b7-${LABEL}-raw`);
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
      await seedSettings(page, { cacheEnabled: false });

      for (let i = 0; i < 3; i++) {
        await gotoFixture(page);
        await page.waitForTimeout(600);
        await selectWord(page, 't', 'bank');
        await openTrigger(page);
        await page.waitForTimeout(1_200); // hold on the rendered definition
      }

      await page.waitForTimeout(800); // hold on the nudge banner (3rd lookup)
      const nudgeSave = page.locator('bottom-sheet lookup-card .nudge-row__save-btn');
      if (await nudgeSave.count()) await nudgeSave.click(); // no-op on `before` (no nudge exists)
      await page.waitForTimeout(1_800); // hold on the "Saved" confirmation

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `b7-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
