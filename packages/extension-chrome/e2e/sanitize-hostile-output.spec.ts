/**
 * S4 e2e proof (rule-sanitize-model-output): model output is attacker-influenceable and
 * must never reach the DOM raw. The unit layer proves sanitizeMarkdown() in isolation;
 * this spec proves the whole shipped pipeline — mocked hostile Gemini response → service
 * worker → content script → rendered card in a real page — leaves the payload inert.
 *
 * The canonical MV3 vectors: <script> (inert under innerHTML by spec, but must be absent),
 * and <img onerror> (DOES execute under innerHTML — the attack that matters). Both write a
 * window flag on success, so execution is observable from the page's main world.
 */
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

const HOSTILE_MD =
  '## bank\n' +
  '<script>window.__pwned = 1;</script>' +
  '<img src="x" onerror="window.__pwned = 2;">' +
  '**bold survives** and [evil](javascript:window.__pwned=3) plus [ok](https://example.com/)';

const HOSTILE_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: HOSTILE_MD }] } }],
});

test('hostile model output renders inert in the card (S4)', async ({ context, extensionId }) => {
  await mockGemini(context, { body: HOSTILE_BODY });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  // The benign markdown around the payload still renders — sanitization, not suppression.
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('bold survives', { timeout: 10_000 });

  // Neither vector executed in the page's main world.
  const pwned = await page.evaluate(() => (window as { __pwned?: number }).__pwned);
  expect(pwned).toBeUndefined();

  // The hostile elements never reached the DOM (locators pierce shadow roots).
  await expect(card.locator('script')).toHaveCount(0);
  await expect(card.locator('img')).toHaveCount(0);

  // The javascript: href was stripped; the https link survived the allowlist.
  const hrefs = await card.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).not.toContain('javascript:window.__pwned=3');
  expect(hrefs).toContain('https://example.com/');

  await page.close();
});
