import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  gotoResetFixture,
  selectWord,
  openTrigger,
  mockGemini,
} from './helpers';

// Regression guard for the off-centre setup invite: on a page with a normalize-style reset
// (button/p margins zeroed, button chrome stripped) the slotted invite nodes must stay centered
// and styled — the card's !important ::slotted() declarations beat the page reset.
test('no-key setup invite stays centered on a page with a hostile CSS reset', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false });
  await gotoResetFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('Set up AI Dictionary', { timeout: 10_000 });
  const cta = card.locator('.setup-cta');
  await expect(cta).toHaveText('Open Settings');

  const cardBox = (await card.boundingBox())!;
  const ctaBox = (await cta.boundingBox())!;
  const offCentre = Math.abs(ctaBox.x + ctaBox.width / 2 - (cardBox.x + cardBox.width / 2));
  expect(offCentre).toBeLessThan(2);
  // The reset must not strip the button chrome either: padding survives, so the CTA is a
  // real button, not a bare text run hugging the left edge.
  expect(ctaBox.height).toBeGreaterThanOrEqual(30);
});

// The header gear is the always-available path to settings once a key exists — no more
// extension-menu → Options spelunking. Same wire route as the setup CTA.
test('card header Settings gear opens the options page', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await mockGemini(context);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);

  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('bank', { timeout: 10_000 });

  const optionsPagePromise = context.waitForEvent('page');
  await card.locator('[data-act="settings"]').click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();
  expect(optionsPage.url()).toContain('options.html');
});

// The side panel is a trusted extension page: its header gear calls openOptionsPage directly.
test('side panel header Settings gear opens the options page', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const optionsPagePromise = context.waitForEvent('page');
  await panel.locator('side-panel-view .settings').click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();
  expect(optionsPage.url()).toContain('options.html');
});
