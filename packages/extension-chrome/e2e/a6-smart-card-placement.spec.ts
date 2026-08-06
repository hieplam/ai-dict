import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

test.describe('A6 smart card placement', () => {
  test('prefers directly below the selection when there is room', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await selectWord(page, 't', 'bank');
    const anchorRect = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const panelTop = await page.evaluate(() => {
      const panel = document.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel')!;
      return panel.getBoundingClientRect().top;
    });
    expect(panelTop).toBeGreaterThanOrEqual(anchorRect.bottom);
  });

  test('flips above the selection when there is not enough room below (viewport-clipped)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.id = 'spacer';
      spacer.style.height = '2000px';
      document.getElementById('t')!.before(spacer);
    });
    // Scroll so the paragraph's bottom sits a small, fixed margin above the viewport's bottom
    // edge, computed from the actual rendered rect — not a guessed pixel offset (avoids
    // CI font-metric flake).
    await page.evaluate(() => {
      const rect = document.getElementById('t')!.getBoundingClientRect();
      window.scrollBy(0, rect.bottom - (window.innerHeight - 40));
    });

    await selectWord(page, 't', 'bank');
    const anchorRect = await page.evaluate(() => {
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top };
    });
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const panelBottom = await page.evaluate(() => {
      const panel = document.querySelector('bottom-sheet')!.shadowRoot!.querySelector('.panel')!;
      return panel.getBoundingClientRect().bottom;
    });
    expect(panelBottom).toBeLessThanOrEqual(anchorRect.top);
  });

  test('never shifts the host page layout when the card opens', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);

    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'layout-marker';
      marker.style.height = '20px';
      document.body.append(marker);
    });
    const before = await page.evaluate(() =>
      document.getElementById('layout-marker')!.getBoundingClientRect().toJSON(),
    );

    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    const after = await page.evaluate(() =>
      document.getElementById('layout-marker')!.getBoundingClientRect().toJSON(),
    );
    expect(after).toEqual(before);
  });
});
