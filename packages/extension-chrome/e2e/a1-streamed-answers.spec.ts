import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGeminiStream,
  GEMINI_STREAM_GLOB,
} from './helpers';

function chunk(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

test.describe('A1 streamed answers', () => {
  test('a Gemini lookup hits the streaming endpoint and renders the fully-accumulated answer', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGeminiStream(context, [
      chunk('DEFINED_AS: "bank" | literal\n'),
      chunk('TRANSLATION: "bờ sông"\n\n'),
      chunk('The land '),
      chunk('alongside a river.'),
    ]);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, {});
    await gotoFixture(page, 'She sat on the bank of the river.');
    await selectWord(page, 't', 'bank');
    await openTrigger(page);

    await expect(page.locator('lookup-card h2').first()).toHaveText('bank', { timeout: 10_000 });
    await expect(page.locator('lookup-card')).toContainText('The land alongside a river.', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('selecting a second word mid-stream cancels the first and shows only the second definition', async ({
    context,
    extensionId,
  }) => {
    // The first request never completes (no final chunk closes cleanly before the second lookup
    // fires) — proves the abort path, not a race on which response wins. Every Gemini lookup on
    // this Chrome build streams (sw.ts always supplies onLookupChunk, Task 8), so BOTH words hit
    // GEMINI_STREAM_GLOB; a single route handler counts requests and only fulfills the second.
    let requestCount = 0;
    await context.route(GEMINI_STREAM_GLOB, async (route) => {
      requestCount++;
      if (requestCount === 1) {
        // Never fulfills — simulates a still-streaming request that gets cancelled.
        await new Promise(() => {});
        return;
      }
      const body = `data: ${chunk('A bound volume of printed pages.')}\n\n`;
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, {});
    await gotoFixture(page, 'She sat on the bank of the river, reading a book.');
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    // Clear the per-tab Define-spam cooldown (workflow.ts's COOLDOWN_MS = 2000) so the second
    // click below fires a real second lookup instead of being blocked client-side as spam —
    // cooldown.spec.ts covers the spam-blocked case; this spec's whole point is the cancel path.
    await page.waitForTimeout(2_100);
    await selectWord(page, 't', 'book');
    await openTrigger(page);

    await expect(page.locator('lookup-card h2').first()).toHaveText('book', { timeout: 10_000 });
    await expect(page.locator('lookup-card')).toContainText('A bound volume of printed pages.', {
      timeout: 10_000,
    });
    expect(requestCount).toBe(2);
  });
});
