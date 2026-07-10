/**
 * B2 before/after evidence: a storage-dump screenshot proving the saved entry's `translation`
 * field is populated with real content (not '') after the save flow, while
 * definition/sentence/url/title stay correctly populated (regression-safe vs B1). This is a
 * data-completeness fix, not a new visible interaction — the star/save UI is pixel-identical to
 * B1 — so the evidence is a screenshot of the actual persisted JSON, not a UI-flow video.
 * Not part of the normal suite. (Re)record with:
 *   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after B2_OUT_DIR=/abs/path \
 *     bunx playwright test b2-evidence
 * Capture BEFORE from a `master` build (no TRANSLATION parsing exists — translation stays '')
 * and AFTER from the branch build (translation is real text), then host the .png per the
 * private-repo rule (pr-assets branch + same-origin github.com/.../raw URLs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { test, chromium } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_OK_BODY } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.B2_OUT_DIR ?? '.';
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');
const SIZE = { width: 900, height: 700 };

// AFTER only: a mock response with a real TRANSLATION line — what the branch's new
// {translation_instruction} prompt actually elicits from a compliant model. BEFORE uses the
// plain default body (no signal lines at all), accurately representing what master returns and
// stores today (master has no TRANSLATION parsing to strip the line even if it were present).
const GEMINI_WITH_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'DEFINED_AS: "bank" | literal\nTRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.',
          },
        ],
      },
    },
  ],
});

test.describe('B2 rich context capture — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)record B2 before/after screenshots');

  test(`select → Define → star → Saved, storage dump (${LABEL})`, async () => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
      ],
      viewport: SIZE,
    });
    try {
      const body = LABEL === 'after' ? GEMINI_WITH_TRANSLATION_BODY : GEMINI_OK_BODY;
      await context.route('https://generativelanguage.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body }),
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
      await page.waitForTimeout(1_000);

      await page.locator('bottom-sheet lookup-card .save-btn').click();
      await page.waitForTimeout(800);

      const dump: Record<string, unknown> = await worker.evaluate(
        () => chrome.storage.local.get(null) as Promise<Record<string, unknown>>,
      );
      const entry: unknown = dump['saved:bank'] ? JSON.parse(dump['saved:bank'] as string) : null;

      await page.evaluate(
        (json) => {
          const pre = document.createElement('pre');
          pre.id = 'b2-evidence-dump';
          pre.textContent = json;
          pre.style.cssText =
            'position:fixed;top:0;left:0;right:0;bottom:0;margin:0;background:#fdf6e3;' +
            'color:#3b3b3b;padding:32px;font:16px/1.6 ui-monospace,monospace;z-index:999999;' +
            'white-space:pre-wrap;overflow:auto;box-sizing:border-box';
          document.body.appendChild(pre);
        },
        JSON.stringify({ 'saved:bank': entry }, null, 2),
      );
      await page.waitForTimeout(300);

      await mkdir(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `b2-${LABEL}.png`) });
    } finally {
      await context.close().catch(() => {});
    }
  });
});
