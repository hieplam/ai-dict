import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';

async function doLookup(
  page: import('@playwright/test').Page,
  paragraph: string,
  word: string,
): Promise<void> {
  await gotoFixture(page, paragraph);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', word);
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

test.describe('A7 pin cards', () => {
  test('pinning detaches the card: it survives Escape, click-elsewhere, and scroll', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page, 'The bank by the river is steep.', 'bank');

    await page.locator('bottom-sheet lookup-card .pin-btn').click();
    await expect(page.locator('bottom-sheet')).toHaveCount(0);
    await expect(page.locator('floating-pin')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('floating-pin')).toBeVisible();

    await page.mouse.click(5, 5); // click far from the pinned card
    await expect(page.locator('floating-pin')).toBeVisible();

    await page.mouse.wheel(0, 400);
    await expect(page.locator('floating-pin')).toBeVisible();
  });

  test('dragging the title bar moves the floating-pin host by a comparable delta', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page, 'The bank by the river is steep.', 'bank');

    await page.locator('bottom-sheet lookup-card .pin-btn').click();
    const pin = page.locator('floating-pin');
    await expect(pin).toBeVisible();

    const before = await pin.boundingBox();
    expect(before).not.toBeNull();

    // The card's shadow-DOM title bar — `.bar` — is the drag handle, but `.bar` also contains the
    // action buttons (side-panel/settings/close), right-aligned via `justify-content:space-between`
    // — the bar's own geometric CENTER can land inside that button cluster depending on the brand
    // text's rendered width, and a pointerdown on a button never starts a drag (by design — see
    // onBar/onButton in floating-pin.ts). Use the `.brand` element's center instead — definitively
    // empty-of-buttons bar surface, on the opposite side from the action buttons.
    const brandBox = await page.evaluate(() => {
      const host = document.querySelector('floating-pin')!;
      const card = host.querySelector('lookup-card')!;
      const brand = card.shadowRoot!.querySelector('.brand')!;
      const r = brand.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    const startX = brandBox.x + brandBox.width / 2;
    const startY = brandBox.y + brandBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 5 });
    await page.mouse.up();

    const after = await pin.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x - before!.x).toBeGreaterThan(40);
    expect(after!.y - before!.y).toBeGreaterThan(20);
  });

  test("clicking the pinned copy's Close button removes it", async ({ context, extensionId }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page, 'The bank by the river is steep.', 'bank');

    await page.locator('bottom-sheet lookup-card .pin-btn').click();
    await expect(page.locator('floating-pin')).toBeVisible();

    await page.locator('floating-pin button[aria-label="Close"]').click();
    await expect(page.locator('floating-pin')).toHaveCount(0);
  });

  test('pinning 3 lookups then starting a 4th disables its pin button at the max-3 cap', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);

    // A single page load carrying 4 distinct words — gotoFixture NAVIGATES, which would kill every
    // existing pin (design spec §2.8: pins die on page nav). All 4 lookups run against this ONE
    // load, matching the same-page multi-lookup pattern in cooldown.spec.ts (the Gemini mock's body
    // doesn't vary by word, so "financial institution" is the expected result text regardless).
    await gotoFixture(page, 'The steady bank managed a quiet garden calmly.');
    await page.waitForTimeout(1_000);

    for (const word of ['steady', 'bank', 'quiet']) {
      // The client-side cooldown (domain/workflow.ts, COOLDOWN_MS = 2000) blocks a lookup fired
      // within 2s of the previous one — wait it out so each of these is a real, unblocked lookup.
      await page.waitForTimeout(2_200);
      await selectWord(page, 't', word);
      await openTrigger(page);
      await expect(page.locator('bottom-sheet lookup-card')).toContainText(
        'financial institution',
        { timeout: 10_000 },
      );
      await page.locator('bottom-sheet lookup-card .pin-btn').click();
    }

    await expect(page.locator('floating-pin')).toHaveCount(3);

    await page.waitForTimeout(2_200);
    await selectWord(page, 't', 'garden');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
    const fourthPinBtn = page.locator('bottom-sheet lookup-card .pin-btn');
    await expect(fourthPinBtn).toBeDisabled();
    await expect(fourthPinBtn).toHaveAttribute('aria-label', /max 3/);
    await expect(page.locator('floating-pin')).toHaveCount(3);
  });

  test('navigating to a fresh page after pinning leaves zero floating-pin elements', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page, 'The bank by the river is steep.', 'bank');

    await page.locator('bottom-sheet lookup-card .pin-btn').click();
    await expect(page.locator('floating-pin')).toBeVisible();

    await gotoFixture(page, 'A brand new page with fresh words.');
    await expect(page.locator('floating-pin')).toHaveCount(0);
  });

  test('a fast single-sample drag flick still moves the card and leaves no ghost drag', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await doLookup(page, 'The bank by the river is steep.', 'bank');

    await page.locator('bottom-sheet lookup-card .pin-btn').click();
    const pin = page.locator('floating-pin');
    await expect(pin).toBeVisible();
    const before = await pin.boundingBox();
    expect(before).not.toBeNull();

    const brandBox = await page.evaluate(() => {
      const host = document.querySelector('floating-pin')!;
      const brand = host.querySelector('lookup-card')!.shadowRoot!.querySelector('.brand')!;
      const r = brand.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const startX = brandBox.x + brandBox.width / 2;
    const startY = brandBox.y + brandBox.height / 2;

    // A single large jump (steps:1) — an ordinary fast flick. This is the case that silently died
    // when the deferred bring-to-front released pointer capture mid-gesture (card never moved,
    // `dragging` stuck true).
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 240, startY + 40, { steps: 1 });
    await page.mouse.up();

    const after = await pin.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x - before!.x).toBeGreaterThan(120); // the flick actually moved it (not ~0)

    // No ghost drag: with the button released, moving the cursor must NOT drag the card further.
    await page.mouse.move(startX + 500, startY + 300);
    const after2 = await pin.boundingBox();
    expect(Math.abs(after2!.x - after!.x)).toBeLessThan(5);
    expect(Math.abs(after2!.y - after!.y)).toBeLessThan(5);
  });
});
