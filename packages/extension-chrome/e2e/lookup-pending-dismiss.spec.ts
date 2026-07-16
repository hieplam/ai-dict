/**
 * In-flight dismissal e2e: dismissing the sheet while a lookup is still pending must stick —
 * the late-arriving result must not resurrect the card (no orphaned render). Uses the
 * delayed-mock option so the response lands well after the dismiss command.
 */
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGemini,
  getServiceWorker,
  relayCommand,
} from './helpers';

test('dismiss during a pending lookup leaves no orphaned card when the result lands', async ({
  context,
  extensionId,
}) => {
  const gemini = await mockGemini(context, { delayMs: 3_000 });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { cacheEnabled: false });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  // The sheet is up in its loading state; the mocked response is still 3s away.
  await expect(page.locator('bottom-sheet')).toHaveCount(1, { timeout: 5_000 });

  const sw = await getServiceWorker(context);
  await relayCommand(sw, 'dismiss-lookup');
  await expect(page.locator('bottom-sheet')).toHaveCount(0);

  // Let the delayed response arrive — the dismissed sheet must not come back.
  await expect.poll(() => gemini.count, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(1_000);
  await expect(page.locator('bottom-sheet')).toHaveCount(0);

  await page.close();
});
