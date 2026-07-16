/**
 * Timeout error path e2e: a provider that never responds must not hang the lookup forever.
 * http-lookup-client.ts aborts the fetch after DEFAULT_TIMEOUT_MS (20s) with a TimeoutError,
 * which error-mapper.ts maps to the NETWORK message. The observable proof is that the error
 * card appears at all — without the abort, this spec would time out instead.
 *
 * Kept in its own file (and given an extended per-test timeout) because it genuinely waits
 * out the 20s client-side timer; Playwright runs spec files in parallel so the suite's
 * wall-clock absorbs it.
 */
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, GEMINI_GLOB } from './helpers';

test('a hung provider request times out into the network-error card', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60_000); // must outlive the 20s client timeout with margin

  // A route that never fulfills: the request stays pending until the client aborts it.
  const calls = { count: 0 };
  await context.route(GEMINI_GLOB, async () => {
    calls.count++;
    await new Promise(() => {}); // hold forever — the extension's timeout must fire
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('Network failed. Check connection and retry.', {
    timeout: 30_000, // 20s client timeout + margin
  });
  expect(calls.count).toBe(1);

  await page.close();
});
