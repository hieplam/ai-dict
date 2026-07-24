import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  storageDump,
} from './helpers';
import type { Page } from '@playwright/test';

async function doLookup(page: Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
}

test.describe('C6 invalid-key recovery', () => {
  test('rejected key → Fix key in Settings → focused + causes → corrected key auto-retests OK', async ({
    context,
    extensionId,
  }) => {
    // 1. The current key is rejected (HTTP 400 INVALID_ARGUMENT — same shape as
    //    lookup-errors.spec.ts's own case).
    await mockGemini(context, {
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-bad-key' });
    await doLookup(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Google rejected the API key.', { timeout: 10_000 });
    const cta = card.locator('.setup-cta');
    await expect(cta).toHaveText('Fix key in Settings');

    // 2. Clicking it opens (or focuses) the options tab, in fix-key mode. Close any already-open
    //    options tab first so openOptionsPage()'s dedup can't focus a stale tab and starve the
    //    'page' event (same robustness idiom as onboarding.spec.ts).
    for (const p of context.pages()) {
      if (p.url().includes('options.html')) await p.close();
    }
    const optionsPagePromise = context.waitForEvent('page');
    await cta.click();
    const optionsPage = await optionsPagePromise;
    await optionsPage.waitForLoadState();
    expect(optionsPage.url()).toContain('options.html');
    await optionsPage.waitForSelector('settings-form');

    const form = optionsPage.locator('settings-form');
    await expect(form.locator('#status')).toContainText('rejected', { timeout: 10_000 });
    await expect(form.locator('#key')).toBeFocused();

    // 3. Fixing the key and saving auto-retests — no manual "Test connection" click.
    await mockGemini(context, { status: 200 }); // most-recently-registered route wins (Playwright)
    await form.locator('#key').fill('AIza-good-key');
    await form.locator('#save').click();
    await expect(form.locator('#status')).toContainText('Connection OK', { timeout: 10_000 });

    const dump = await storageDump(optionsPage);
    const settings = dump['settings'] as { apiKey: string };
    expect(settings.apiKey).toBe('AIza-good-key');
  });

  test('the NO_KEY setup invite still shows the plain, unfocused Open Settings CTA (regression guard)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: '', hasKey: false, configuredProviders: [] });
    await doLookup(page);
    const cta = page.locator('bottom-sheet lookup-card .setup-cta');
    await expect(cta).toHaveText('Open Settings');
  });
});
