import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { seedSettings, mockGemini, selectWord, openTrigger } from './helpers';

/**
 * Serve the canonical one-paragraph fixture behind a real, strict Content-Security-Policy
 * response header — the thing a hostile real-world page ships to lock down ITS OWN inline
 * scripts/styles. `script-src 'none'; style-src 'none'` (nested inside `default-src 'none'`) is
 * about as restrictive as CSP gets; it forbids every inline `<script>`/`<style>` on the PAGE with
 * no nonce/hash escape hatch. The fixture also carries its own inline `<script>` that flips a
 * marker element's text — proof, inside the same test, that this CSP is genuinely enforced by
 * the browser (not a header the test merely sets and never checks).
 *
 * Deliberately local to this spec (not added to helpers.ts): unlike gotoFixture/gotoResetFixture,
 * this needs a custom response `headers` object AND an extra inline `<script>` in the body —
 * two new knobs neither existing spec needs, so parameterizing helpers.ts for a single caller
 * would just be speculative generality.
 */
async function gotoCspFixture(page: Page, paragraph: string): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'none'",
      },
      body:
        '<html><body>' +
        `<p id="t">${paragraph}</p>` +
        '<div id="page-script-marker">not-run</div>' +
        "<script>document.getElementById('page-script-marker').textContent = 'page-script-ran';</script>" +
        '</body></html>',
    }),
  );
  await page.goto('http://test.fixture/');
}

/**
 * Serve a fixture whose own inline `<script>` registers document-level `mouseup` and
 * `selectionchange` listeners that call `stopPropagation()`/`preventDefault()` on every event —
 * a real page (rich-text editor, custom context menu, image gallery) trying to own selection
 * handling for itself. `window.__hostileMouseupCount` lets the test prove the hostile listener
 * genuinely fired (not a dead/no-op script) before asserting the extension still works anyway.
 * Local for the same reason as gotoCspFixture: the extra inline `<script>` isn't a parameter any
 * existing spec needs.
 */
async function gotoHostileListenerFixture(page: Page, paragraph: string): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<html><body>' +
        `<p id="t">${paragraph}</p>` +
        '<script>' +
        'window.__hostileMouseupCount = 0;' +
        "document.addEventListener('mouseup', function (e) {" +
        '  window.__hostileMouseupCount++;' +
        '  e.stopPropagation();' +
        '  e.preventDefault();' +
        '});' +
        "document.addEventListener('selectionchange', function (e) {" +
        '  e.stopPropagation();' +
        '});' +
        '</script>' +
        '</body></html>',
    }),
  );
  await page.goto('http://test.fixture/');
}

test('a page-level CSP (script-src none, style-src none) does not block the extension content script', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoCspFixture(page, 'The bank by the river is steep.');
  await page.waitForTimeout(1_000);

  // Proof the CSP is genuinely enforced (not a header the browser silently ignores): the page's
  // OWN inline <script> is forbidden by its OWN `script-src 'none'` and never gets to run, so the
  // marker stays at its initial value.
  await expect(page.locator('#page-script-marker')).toHaveText('not-run');

  // The extension's content script is an isolated-world MV3 content script — Chrome does not
  // subject it to the hosting page's CSP (that exemption is exactly what this asserts, run for
  // real rather than assumed). Selection detection, the trigger, and the full Define workflow
  // must all still work against a page that forbids its own scripts outright.
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
  await expect.poll(() => calls.count).toBeGreaterThanOrEqual(1);
});

test('a page with its own stopPropagation/preventDefault mouseup+selectionchange listeners does not break selection detection', async ({
  context,
  extensionId,
}) => {
  await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoHostileListenerFixture(page, 'The bank by the river is steep.');
  await page.waitForTimeout(1_000);

  await selectWord(page, 't', 'bank');

  // Proof the hostile listener genuinely ran (not a dead script that never registered/fired):
  // selectWord's own document.dispatchEvent(new MouseEvent('mouseup', ...)) must have reached it.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __hostileMouseupCount: number }).__hostileMouseupCount,
      ),
    )
    .toBeGreaterThanOrEqual(1);

  // Why this passes rather than being starved by the page's stopPropagation()/preventDefault():
  // the extension's own selection listener is `DomSelectionSource.onSelection`
  // (packages/app/src/app/dom-selection-source.ts:46), which calls
  // `document.addEventListener('mouseup', handler)` with no `capture` option — i.e. bubble
  // phase, same as this hostile page's listener, and both sit on the SAME target (`document`).
  // The manifest registers content.js at `run_at: "document_idle"` (packages/extension-chrome/
  // manifest.json), which fires strictly after the page's own inline <script> (parsed during
  // HTML streaming, long before "idle"), so the extension's handler is always the LATER of the
  // two listeners on `document` for this event.
  // `stopPropagation()` only suppresses further propagation UP the DOM tree past the CURRENT
  // node — it does nothing to sibling listeners already registered on that SAME node for the
  // SAME event; only `stopImmediatePropagation()` (which this hostile page deliberately does
  // NOT call, matching the brief) skips subsequent same-target listeners. So the later-registered
  // extension handler still runs, and `preventDefault()` has no bearing here either (there is no
  // browser default action for a synthetic mouseup on a text selection to prevent). Verified
  // empirically during authoring: swapping the hostile listener to `stopImmediatePropagation()`
  // does starve the extension's listener and the trigger never appears — proving this assertion
  // is not vacuous and confirming the mechanism above, not just describing it.
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
});
