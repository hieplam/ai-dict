import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

/** Repeats gotoFixture's default sentence deterministically so two lookups of "bank" in the
 * same test share an identical word+sentence+target cache key (see design spec §5.3). */
async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

/** Minimal local twin of side-panel.spec.ts's openPanelAndSender (not exported there) — opens
 * the panel plus a second extension page that can post {to:'side-panel', ...} messages to it. */
async function openPanelAndSender(context: BrowserContext, extensionId: string) {
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(sender);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  return { panel, sender };
}

test.describe('A9 instant cache hits', () => {
  test('a repeat lookup of the same word+sentence shows Cached and makes zero extra network calls', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: true });

    await doLookup(page); // miss — first time this word+sentence is looked up
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(1);

    await doLookup(page); // hit — identical word+sentence+target as above
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toContainText('Cached', {
      timeout: 10_000,
    });
    // The hard gate (design spec §2.2(1)): a cache hit makes ZERO additional network calls.
    expect(calls.count).toBe(1);
  });

  test('cacheEnabled:false never shows the badge and always hits the network', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(2); // no caching → two calls
  });

  test('the side panel shows the same Cached badge for a mirrored fromCache:true payload', async ({
    context,
    extensionId,
  }) => {
    const { panel, sender } = await openPanelAndSender(context, extensionId);
    await sender.evaluate(() =>
      chrome.runtime.sendMessage({
        to: 'side-panel',
        state: 'result',
        payload: {
          markdown: '## bank\nA financial institution.',
          word: 'bank',
          target: 'vi',
          fromCache: true,
        },
      }),
    );
    await expect(panel.locator('side-panel-view .cache-badge')).toContainText('Cached', {
      timeout: 5_000,
    });
  });

  test('wall-clock smoke check: repeat lookup renders the badge well under the CI-jitter margin', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: true });

    await doLookup(page); // miss, populates the cache
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');

    const t0 = Date.now();
    await openTrigger(page);
    await page.locator('bottom-sheet lookup-card .cache-badge').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    // NOT the product's real latency number — Playwright/CDP round trips and headless CI
    // scheduling add overhead unrelated to the extension's own code path (design spec §2.2(2)).
    // The actual guarantee is enforced structurally (zero extra network calls, asserted above);
    // this is a coarse tripwire against a gross regression only.
    expect(elapsed).toBeLessThan(500);
  });
});
