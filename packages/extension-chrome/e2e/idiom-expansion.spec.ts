import { test, expect } from './fixtures';
import { seedSettings, mockGemini, gotoFixture, selectWord, openTrigger } from './helpers';

const IDIOM_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [
          {
            text:
              'DEFINED_AS: "kick the bucket" | idiom\n\n' +
              '## kick the bucket\nAn informal way of saying someone has died.',
          },
        ],
      },
    },
  ],
});

const LITERAL_BODY = JSON.stringify({
  candidates: [
    {
      content: { parts: [{ text: 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.' }] },
    },
  ],
});

const NO_TAG_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bucket\nA container for carrying liquid.' }] } }],
});

test.describe('A8 phrase & idiom expansion', () => {
  test('idiom selection renders the defined-as label and the Show literal word button', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Defined as "kick the bucket" (idiom)', { timeout: 10_000 });
    await expect(card.locator('.defined-as__literal-btn')).toHaveText('Show literal word');
  });

  test('the outbound prompt carries the idiom-detection instruction', async ({
    context,
    extensionId,
  }) => {
    let sentPrompt = '';
    await mockGemini(context, {
      body: IDIOM_BODY,
      onRequest: (postData) => {
        const parsed = JSON.parse(postData) as { contents: { parts: { text: string }[] }[] };
        sentPrompt = parsed.contents[0]?.parts[0]?.text ?? '';
      },
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('kick the bucket', {
      timeout: 10_000,
    });

    expect(sentPrompt).toContain('DEFINED_AS:');
    expect(sentPrompt).toContain('is part of an idiom');
  });

  test('the Show literal word button re-runs the lookup and switches to the literal reading', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('Defined as "kick the bucket" (idiom)', { timeout: 10_000 });

    // Swap the mock to the literal response before the button re-fires the request.
    await context.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(context, { body: LITERAL_BODY });

    await card.locator('.defined-as__literal-btn').click();
    await expect(card).toContainText('A pail.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0); // literal result shows no label
    expect(calls.count).toBeGreaterThanOrEqual(1); // first mock's own counter; swapped mock re-counts separately
  });

  test('a literal-tagged response renders no defined-as row', async ({ context, extensionId }) => {
    await mockGemini(context, { body: LITERAL_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'Pass me the bucket, please.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A pail.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0);
  });

  test('a response with no DEFINED_AS line degrades gracefully (no label, no error)', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: NO_TAG_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'Pass me the bucket, please.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);

    const card = page.locator('bottom-sheet lookup-card');
    await expect(card).toContainText('A container for carrying liquid.', { timeout: 10_000 });
    await expect(card.locator('.defined-as')).toHaveCount(0);
    await expect(card.locator('.err')).toHaveCount(0);
  });

  test('the side panel mirror shows the idiom result WITHOUT the Show literal word button', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context, { body: IDIOM_BODY });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await panel.waitForSelector('side-panel-view');

    await gotoFixture(page, 'He kicked the bucket last week.');
    await page.waitForTimeout(800);
    await selectWord(page, 't', 'bucket');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('kick the bucket', {
      timeout: 10_000,
    });

    // The mirrored panel shows the definition text but, per design §10, never the
    // idiom label/button — resultToFocus deliberately omits definedAs (same precedent as the
    // provider picker, which the panel also omits).
    await expect(panel.locator('side-panel-view')).toContainText('died', { timeout: 5_000 });
    await expect(panel.locator('side-panel-view .defined-as')).toHaveCount(0);
  });
});
