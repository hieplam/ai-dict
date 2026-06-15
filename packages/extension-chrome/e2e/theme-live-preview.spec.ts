import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import { seedSettings } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_HEADLESS } from '../playwright.config';

// Issue #51 evidence: changing the Theme select must re-theme the settings page IMMEDIATELY
// (live preview), not only after Save. We record a video of the whole flow and capture
// before/after stills. This spec runs its own video-recording context (the shared fixture
// records no video) but loads the extension exactly like fixtures.ts.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e-evidence/issue-51');

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined,
      headless: false,
      args: [
        ...(E2E_HEADLESS ? ['--headless=new'] : []),
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
      ],
      recordVideo: { dir: out, size: { width: 1180, height: 820 } },
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    await use(new URL(sw.url()).hostname);
  },
});

test('theme select re-themes the settings page live, before Save', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { theme: 'sepia' });
  await page.reload();
  const form = page.locator('settings-form');
  await form.waitFor();

  // The neutral options form expresses its theme through the native color-scheme (§5.8),
  // so the live preview is observed there rather than on an --ad-* surface token.
  const scheme = () =>
    form.evaluate((el) => getComputedStyle(el).getPropertyValue('color-scheme').trim());

  // BEFORE: sepia default → light native scheme.
  await expect(form).toHaveAttribute('data-ad-theme', 'sepia');
  expect(await scheme()).toContain('light');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'before-sepia.png') });

  // Change the Theme select to Dark — and DO NOT click Save.
  await form.locator('#theme').selectOption('dark');
  await page.waitForTimeout(700);

  // AFTER: the page is already dark, with NO Save click. This is the bug fix.
  await expect(form).toHaveAttribute('data-ad-theme', 'dark');
  expect(await scheme()).toContain('dark'); // dark color-scheme applied live
  await page.screenshot({ path: path.join(out, 'after-dark-no-save.png') });

  // System tracks live too.
  await form.locator('#theme').selectOption('system');
  await expect(form).toHaveAttribute('data-ad-theme', 'system');
  await page.waitForTimeout(500);

  await page.close(); // flush the recorded video to disk
});
