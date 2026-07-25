import { test, expect } from './fixtures';
import { mockGemini, selectWord, openTrigger } from './helpers';

// C3: after a VERIFIED activation, the settings screen shows a "Try it now" CTA whose button
// opens the public landing page's practice section (docs/index.html's #try) in a new tab, where
// the real lookup pipeline runs against the reader's own key. The unverified "Save anyway" bypass
// (C2) must never show this CTA, since it never verified the key actually works.

const TRY_IT_URL = 'https://hieplam.github.io/ai-dict/#try';

// A LOCAL stand-in for the landing page's #try section. Served via page.route in place of the
// live site (R6.5 / C10: the e2e suite must NEVER fetch https://hieplam.github.io). selectWord
// (helpers.ts) scans the paragraph's first child text node, so the target word is plain text
// with no nested <mark> around it.
const TRY_IT_FIXTURE_HTML = `<!doctype html><html><body>
  <p id="try-sentence">Finding that cafe was pure serendipity.</p>
</body></html>`;

test.describe('C3 guided first lookup', () => {
  test('activating with a verified key shows the try-it CTA; clicking it targets the landing page, where the real lookup runs', async ({
    context,
    extensionId,
  }) => {
    const gemini = await mockGemini(context);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #tryit-cta')).toBeVisible();
    await expect(page.locator('settings-form .tryit-cta-caption')).toContainText('uses your key', {
      ignoreCase: true,
    });

    // Capture the CTA's chrome.tabs.create target WITHOUT opening a real tab. Playwright cannot
    // intercept an extension-opened tab's very-first main-frame navigation, so an actually-opened
    // tab would fetch the live production landing page — forbidden by R6.5 / C10. Stubbing the API
    // records the exact URL the product asks the browser to open, which is precisely the contract.
    await page.evaluate(() => {
      (window as unknown as { __tryItUrl?: string }).__tryItUrl = undefined;
      chrome.tabs.create = ((opts: { url?: string }) => {
        (window as unknown as { __tryItUrl?: string }).__tryItUrl = opts.url;
        return Promise.resolve({} as chrome.tabs.Tab);
      }) as typeof chrome.tabs.create;
    });
    await page.locator('settings-form #tryit-open').click();
    const targetUrl = await page.evaluate(
      () => (window as unknown as { __tryItUrl?: string }).__tryItUrl,
    );
    expect(targetUrl).toBe(TRY_IT_URL);

    // Prove the real select → Define → card pipeline runs on that landing-page URL, using a LOCAL
    // stand-in served by page.route (no live fetch — the fixture is fulfilled at the real URL so
    // the content script sees the exact origin/path the CTA targets). The content script covers it
    // under <all_urls> exactly as it covers the live landing page.
    const landing = await context.newPage();
    await landing.route('https://hieplam.github.io/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: TRY_IT_FIXTURE_HTML }),
    );
    const beforeLookup = gemini.count;
    await landing.goto(TRY_IT_URL);
    await selectWord(landing, 'try-sentence', 'serendipity');
    await openTrigger(landing);
    await expect(landing.locator('bottom-sheet lookup-card')).toContainText(
      'financial institution',
      {
        timeout: 10_000,
      },
    );
    // The lookup made exactly one new (mocked) provider call — the real pipeline, the user's key.
    expect(gemini.count).toBe(beforeLookup + 1);
  });

  test('the "Save anyway" (unverified) path never shows the try-it CTA', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { abort: true });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');
    await page.locator('onboarding-view #key').fill('AIza-activated');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('onboarding-view #save-anyway', { state: 'visible' });
    await page.locator('onboarding-view #save-anyway').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });
    // The CTA <section> is always present in settings-form's markup (toggled via [hidden]), so
    // toHaveCount(0) never holds — assert on visibility instead.
    await expect(page.locator('settings-form #tryit-cta')).toBeHidden();
  });
});
