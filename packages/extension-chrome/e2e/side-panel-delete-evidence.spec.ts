/**
 * Capture-only spec: drives the REAL extension in Chromium and writes the screenshots + video
 * used as the PR's After evidence for the side-panel "delete from Recent" feature. No
 * behavioural assertions beyond what the capture needs — side-panel-delete.spec.ts owns those.
 *
 * Run with:
 *   bunx playwright test e2e/side-panel-delete-evidence.spec.ts
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import { E2E_HEADLESS } from '../playwright.config';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../e2e-evidence/side-panel-delete',
);
const shot = (name: string) => path.join(out, `${name}.png`);

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
      viewport: { width: 480, height: 800 },
      recordVideo: { dir: out, size: { width: 480, height: 800 } },
    });
    await use(context);
    await context.close();
  },
});

test('evidence: delete a Recent word, then the same selection re-fetches fresh', async ({
  context,
}) => {
  await mkdir(out, { recursive: true });
  const calls = await mockGemini(context);

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(sw.url()).hostname;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(() => chrome.storage.local.clear());
  await seedSettings(page);

  // Two lookups so Recent shows a small list.
  for (const word of ['bank', 'river']) {
    await gotoFixture(page);
    await page.waitForTimeout(800);
    await selectWord(page, 't', word);
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
  }

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 480, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  await expect(panel.locator('side-panel-view .recent-row')).toHaveCount(2);
  await panel.waitForTimeout(600);
  await panel.screenshot({ path: shot('after-recent-with-delete') });

  // Hover state on the row about to be deleted.
  const riverDel = panel.getByRole('button', { name: 'Delete river from history and cache' });
  await riverDel.hover();
  await panel.waitForTimeout(400);
  await panel.screenshot({ path: shot('after-delete-hover') });

  await riverDel.click();
  await expect(panel.locator('side-panel-view .recent-row')).toHaveCount(1);
  await panel.waitForTimeout(600);
  await panel.screenshot({ path: shot('after-row-deleted') });

  // Re-select the deleted word: cache misses, Gemini is queried again (fresh template applies).
  const callsBefore = calls.count;
  await gotoFixture(page);
  await page.waitForTimeout(800);
  await selectWord(page, 't', 'river');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(callsBefore + 1);
  await panel.waitForTimeout(800);
});
