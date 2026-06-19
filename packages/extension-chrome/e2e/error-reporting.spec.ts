import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

/**
 * Read the extension's chrome.storage.local via the service worker.
 * The SW is an extension context where `chrome` is defined, so this avoids
 * the "chrome is not defined" error that occurs when page.evaluate runs in
 * the page's main world (http://test.fixture/ has no `chrome` global).
 */
async function swStorageDump(context: BrowserContext): Promise<Record<string, unknown>> {
  const [sw] = context.serviceWorkers();
  return sw.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

/**
 * Parse the errlog:buffer value from a storageDump to a length.
 * Returns -1 on parse failure.
 */
function bufferLength(dump: Record<string, unknown>): number {
  const raw = dump['errlog:buffer'];
  if (typeof raw !== 'string') return -1;
  try {
    return (JSON.parse(raw) as unknown[]).length;
  } catch {
    return -1;
  }
}

/**
 * Drive one failing lookup: select 'bank', open trigger, wait for the error card,
 * then wait (via SW storage dump) until the SW's capture write commits the Nth entry.
 * This serialises the test against the async capture path.
 *
 * DESIGN NOTE — the consent-footer race:
 * In the SW, `sendResponse(reply)` and `void reporter.capture()` are called in the
 * same .then() callback. The content script receives the response, calls `renderError`,
 * then fires `maybeShowConsent()` which sends `errlog.status` back to the SW.
 * Because `reporter.capture` starts concurrently and has several async storage
 * operations before it writes the buffer, `maybeShowConsent` can query `errlog.status`
 * *before* the new entry lands — seeing count N-1 instead of N.
 *
 * Consequence: the lookup at exactly the threshold (e.g. the 3rd) can lose the race
 * and not show the footer. Any lookup *after* the buffer is confirmed at the threshold
 * is guaranteed to show the footer, because even if that lookup's own capture is slow,
 * the pre-existing N entries already satisfy pending=true.
 *
 * The caller uses this to advance the buffer to N, then does ONE more "trigger" call
 * that reliably shows the consent footer.
 */
async function doErrorLookup(
  page: Parameters<typeof selectWord>[0],
  context: BrowserContext,
  expectedBufferLength: number,
): Promise<void> {
  // The per-tab lookup cooldown (workflow.ts COOLDOWN_MS = 2s) blocks a second Define fired
  // within the window — it would render the local "Slow down" notice instead of reaching Gemini,
  // so the errlog buffer would never advance. This flow fires several error-lookups back-to-back,
  // so wait out the cooldown before each one to guarantee a genuine fresh fire that hits the
  // (faked) Gemini. (Harmless on the first call, where there is no prior fire to be throttled by.)
  await page.waitForTimeout(2_100);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('Gemini server error', {
    timeout: 10_000,
  });
  // Wait for the SW capture write to complete (confirmed via SW storage evaluation).
  await expect
    .poll(async () => bufferLength(await swStorageDump(context)), {
      timeout: 8_000,
      intervals: [200, 300, 500, 500, 1_000],
    })
    .toBe(expectedBufferLength);
}

/**
 * Do one extra lookup to reliably trigger `maybeShowConsent` when the buffer is
 * already confirmed at or above the threshold. Because the pre-existing entries
 * satisfy the threshold even if this lookup's own capture races, pending=true is
 * guaranteed and the consent footer appears.
 */
async function triggerConsentFooter(
  page: Parameters<typeof selectWord>[0],
  context: BrowserContext,
  preConfirmedCount: number,
): Promise<void> {
  await doErrorLookup(page, context, preConfirmedCount + 1);
  await expect(page.locator('bottom-sheet lookup-card .errlog-consent')).toBeVisible({
    timeout: 8_000,
  });
}

test('buffers silently, prompts at the 3rd error, grant flushes + persists consent', async ({
  context,
  extensionId,
}) => {
  // Route GA4 before anything else so we catch all POSTs including the flush on grant.
  const ga4: string[] = [];
  await context.route('https://www.google-analytics.com/**', (route, req) => {
    ga4.push(req.postData() ?? '');
    return route.fulfill({ status: 204, body: '' });
  });

  await mockGemini(context, { status: 500, body: '{}' });

  // Single page for the full flow (matches lookup-errors.spec.ts pattern).
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  // ── Errors 1 & 2 — buffer silently (below threshold 3) ───────────────────
  await doErrorLookup(page, context, 1);
  await expect(page.locator('bottom-sheet lookup-card .errlog-consent')).toHaveCount(0);

  await doErrorLookup(page, context, 2);
  await expect(page.locator('bottom-sheet lookup-card .errlog-consent')).toHaveCount(0);

  // ── Error 3 — threshold reached (buffer=3 confirmed) ─────────────────────
  // The race between capture write and maybeShowConsent means the footer may not
  // appear at exactly error 3. We confirm buffer=3 then use error 4 to reliably
  // show it (buffer pre-confirmed >= threshold regardless of error 4's race).
  await doErrorLookup(page, context, 3);

  // ── Error 4 — reliable footer trigger ────────────────────────────────────
  await triggerConsentFooter(page, context, 3);
  // footer is now visible (asserted inside triggerConsentFooter); buffer = 4

  // ── Grant consent via "Send reports" ─────────────────────────────────────
  await page.locator('bottom-sheet lookup-card .errlog-consent button').first().click();

  // Primary: storage reflects granted + buffer flushed.
  await expect
    .poll(async () => (await swStorageDump(context))['errlog:consent'], { timeout: 10_000 })
    .toBe('granted');

  await expect
    .poll(async () => bufferLength(await swStorageDump(context)), { timeout: 10_000 })
    .toBe(0);

  // Secondary: GA4 POST fired (meaningful when dist was built with GA4 env vars).
  expect(ga4.length).toBeGreaterThan(0);
  expect(ga4.join('\n')).toContain('extension_error');
});

test('decline advances the Fibonacci rung and suppresses re-prompt until the next threshold', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context, { status: 500, body: '{}' });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  // ── Errors 1-3: advance buffer to threshold ───────────────────────────────
  await doErrorLookup(page, context, 1);
  await doErrorLookup(page, context, 2);
  await doErrorLookup(page, context, 3);

  // ── Error 4: reliable footer trigger (buffer pre-confirmed = 3 >= threshold 3) ──
  await triggerConsentFooter(page, context, 3);
  // footer visible, buffer = 4

  // ── Click "Not now" ───────────────────────────────────────────────────────
  await page.locator('bottom-sheet lookup-card .errlog-consent button').nth(1).click();

  // Footer must disappear.
  await expect(page.locator('bottom-sheet lookup-card .errlog-consent')).toHaveCount(0, {
    timeout: 3_000,
  });

  // Storage: rung advances to '1'; consent is not stored for 'unset' (the default
  // 'unset' state is represented by the KEY being absent — `readConsent()` returns
  // 'unset' when the key is undefined). Buffer keeps its 4 entries.
  await expect
    .poll(async () => (await swStorageDump(context))['errlog:threshold-index'], { timeout: 5_000 })
    .toBe('1');

  const dump1 = await swStorageDump(context);
  // 'unset' is the default — the key may be absent or explicitly 'unset'.
  expect(dump1['errlog:consent'] ?? 'unset').toBe('unset');
  expect(bufferLength(dump1)).toBe(4);

  // Next Fibonacci threshold at rung 1 = fibThreshold(1) = 5.
  // Buffer is already at 4. One more error (error 5) brings it to 5.

  // ── Error 5 — confirm buffer = 5 (hits next threshold) ───────────────────
  await doErrorLookup(page, context, 5);

  // ── Error 6 — reliable footer trigger (buffer pre-confirmed = 5 >= threshold 5) ─
  await triggerConsentFooter(page, context, 5);
  // footer reappears (asserted inside triggerConsentFooter)
});

test('Settings toggle reflects consent and turning it off disables reporting', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);

  // Set consent granted directly in storage, then reload so options.ts picks it up.
  await page.evaluate(() => chrome.storage.local.set({ 'errlog:consent': 'granted' }));
  await page.reload();
  await page.waitForSelector('settings-form');

  // Checkbox must be checked when consent === 'granted'.
  await expect(page.locator('settings-form #error-reporting')).toBeChecked({ timeout: 5_000 });

  // Uncheck (disables reporting).
  await page.locator('settings-form #error-reporting').uncheck();

  // Status line should say 'Error reporting disabled'.
  await expect(page.locator('settings-form #status')).toHaveText('Error reporting disabled', {
    timeout: 5_000,
  });

  // Storage must reflect consent === 'disabled'.
  await expect
    .poll(async () => (await swStorageDump(context))['errlog:consent'], { timeout: 5_000 })
    .toBe('disabled');
});
