import { test, expect } from './fixtures';
import { gotoFixture, selectWord, openTrigger } from './helpers';
import { useLiveGemini, expectLiveLookup, LIVE_TIMEOUT_MS } from './helpers-live';

/**
 * The app's primary journey, against the REAL Gemini API — no mock anywhere in this file
 * (enforced by scripts/hard-rule/check-live-e2e-purity.mjs).
 *
 * Exists because on 2026-08-09 every lookup in production failed while 1,054 unit tests and 224
 * e2e tests stayed green: every mock hand-rolled '\n\n' SSE framing, while Google sends
 * '\r\n\r\n'. No mocked test can catch that class of failure, by construction.
 */
test.describe('primary lookup flow (live Gemini)', () => {
  test('select → Define → card → real Gemini → rendered definition', async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(LIVE_TIMEOUT_MS + 30_000);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await useLiveGemini(page);

    await gotoFixture(page, 'She sat on the bank of the river.');
    await selectWord(page, 't', 'bank');

    // Rung 1: the Define bubble appears from the selection alone — pure UI, no network yet.
    await expect(page.locator('lookup-trigger')).toBeAttached({ timeout: 5_000 });
    await openTrigger(page);

    // Rung 2: the card mounts.
    await expect(page.locator('lookup-card')).toBeAttached({ timeout: 10_000 });

    // Rungs 3-8, including the transport/contract verdict.
    await expectLiveLookup(page, { word: 'bank' });
  });
});
