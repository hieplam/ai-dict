import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('A10 TTS pronunciation', () => {
  test('a lookup result renders a labeled speak button; a forced click never breaks the card', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    // speechSynthesis itself is always defined in Chromium (headless included), so the button
    // node always exists — only its `hidden` state depends on this machine's installed TTS
    // voices, which this suite does not control and must not assert on (design spec §6.1).
    const speakBtn = page.locator('bottom-sheet lookup-card .speak-btn');
    await expect(speakBtn).toHaveCount(1);
    await expect(speakBtn).toHaveAttribute('aria-label', 'Say "bank" aloud');

    // force: true bypasses Playwright's visibility wait — the click must be harmless whether or
    // not this machine has a usable local voice (renderSpeakButton's click handler re-checks
    // voice availability itself and no-ops if none remain, design spec §2.3 step 5).
    await speakBtn.click({ force: true });
    await page.waitForTimeout(200);
    expect(pageErrors).toEqual([]);
  });
});
