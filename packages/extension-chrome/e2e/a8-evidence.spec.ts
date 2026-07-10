/**
 * A8 before/after evidence: a short recorded flow showing the idiom label appear on the card
 * and the "Show literal word" button switch it to the literal reading. Not part of the normal
 * suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after A8_OUT_DIR=/abs/path \
 *     bunx playwright test a8-evidence
 * Capture BEFORE from a `master` build (no DEFINED_AS wiring — the mocked response is shown
 * as-is, with no label or button) and AFTER from the branch build, then host the .webm per the
 * private-repo rule (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.A8_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 620 };

const IDIOM_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              'DEFINED_AS: "kick the bucket" | idiom\n\n' +
              '## kick the bucket\nAn informal way of saying someone has died.',
          },
        ],
      },
    },
  ],
});

const LITERAL_BODY = JSON.stringify({
  candidates: [
    { content: { parts: [{ text: 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.' }] } },
  ],
});

test.describe('A8 phrase & idiom expansion — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record A8 before/after video');

  test(`idiom label + force-literal toggle (${LABEL})`, async () => {
    const videoDir = path.join(OUT, `a8-${LABEL}-raw`);
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
        route.fulfill({ status: 200, contentType: 'application/json', body: IDIOM_BODY }),
      );

      const page = await context.newPage();
      const [sw] = context.serviceWorkers();
      const worker = sw ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
      const extensionId = new URL(worker.url()).hostname;

      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await seedSettings(page, { outputFormat: 'Define {word}' });
      await gotoFixture(page, 'He kicked the bucket last week.');
      await page.waitForTimeout(800);

      await selectWord(page, 't', 'bucket');
      await openTrigger(page);
      await page.waitForTimeout(1_800); // hold on the idiom card (label+button on `after`, plain on `before`)

      // Swap to the literal response, then click the button (a no-op on `before`: no button exists).
      await context.unroute('https://generativelanguage.googleapis.com/**');
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: LITERAL_BODY }),
      );
      const btn = page.locator('bottom-sheet lookup-card .defined-as__literal-btn');
      if (await btn.count()) await btn.click();
      await page.waitForTimeout(1_800); // hold on the literal outcome

      const video = page.video();
      await page.close();
      await mkdir(OUT, { recursive: true });
      await video?.saveAs(path.join(OUT, `a8-${LABEL}.webm`));
    } finally {
      await context.close().catch(() => {});
    }
  });
});
