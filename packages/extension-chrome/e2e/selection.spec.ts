import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test('Define click reaches the workflow when the selection sits inside a positive z-index stacking context', async ({
  context,
  extensionId,
}) => {
  // Reproduces support.claude.com's pattern: a heading wrapped in a positive-z stacking
  // context, which used to occlude the trigger's hit-testing and swallow the click.
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<html><head><style>.stack-wrap{position:relative;z-index:3}</style></head>' +
        '<body><div class="stack-wrap"><h1 id="t">Claude Cowork usage promotion</h1></div></body></html>',
    }),
  );
  await page.goto('http://test.fixture/');
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'Claude');
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

  // The trigger must win hit-testing despite the z:3 ancestor — this is the fix under test.
  const hitTag = await page.evaluate(() => {
    const t = document.querySelector('lookup-trigger')!;
    const r = t.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
  });
  expect(hitTag).toBe('LOOKUP-TRIGGER');

  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count).toBeGreaterThanOrEqual(1);
});

test('a collapsed selection shows no trigger', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  // Collapse the caret and dispatch mouseup — content script returns early for isCollapsed.
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('lookup-trigger')).toHaveCount(0);
});

test('a multi-word phrase selection shows a trigger and renders a result', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'The river bank is steep here.');
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'river bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});

test('dismiss then re-select shows the trigger again', async ({ context, extensionId }) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'bank');
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });

  // Collapse to dismiss, then re-select.
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});
