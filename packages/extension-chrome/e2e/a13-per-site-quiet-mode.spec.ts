import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  getServiceWorker,
  relayCommand,
} from './helpers';

/** Read the `quiet:index` raw JSON value via the service worker (only extension contexts have
 * the `chrome` global — the content page's main world does not, same reasoning as
 * saved-word.spec.ts's swStorageDump). */
async function quietIndex(
  sw: Awaited<ReturnType<typeof getServiceWorker>>,
): Promise<string | undefined> {
  const dump = (await sw.evaluate(() => chrome.storage.local.get('quiet:index'))) as Record<
    string,
    string
  >;
  return dump['quiet:index'];
}

test.describe('A13 per-site quiet mode', () => {
  test('a muted site never shows the trigger bubble on selection', async ({
    context,
    extensionId,
  }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['test.fixture']) }),
    );

    const page = await context.newPage();
    await gotoFixture(page);
    await page.waitForTimeout(1_000); // let content.ts's loadQuiet() resolve before selecting
    await selectWord(page, 't', 'bank');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('the A4 keyboard shortcut still fires a lookup on a muted site with no bubble ever visible', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['test.fixture']) }),
    );

    const page = await context.newPage();
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);

    await relayCommand(sw, 'define-selection');
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
  });

  test('the card\'s "Mute this site" action mutes the current site; the next selection stays silent', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);

    const page = await context.newPage();
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    // Collapse the leftover "river bank" selection before the mute click. DomSelectionSource
    // re-fires on ANY document mouseup while a selection is live (dom-selection-source.ts), so the
    // mute button's own mouseup would otherwise mount a fresh trigger from the stale selection —
    // a pre-existing race (Close/star buttons do the same; not introduced by A13, and it
    // self-heals on the next interaction). Collapsing here isolates the assertion below to its
    // real intent: the NEXT genuine selection ("steep") stays silent once the site is muted.
    // Matches the removeAllRanges idiom in lookup.spec.ts / selection.spec.ts / a15.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.locator('bottom-sheet lookup-card button[data-act="mute-site"]').click();

    const sw = await getServiceWorker(context);
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['test.fixture']));

    // content.ts's chrome.storage.onChanged listener re-fetches asynchronously; give it a beat.
    await page.waitForTimeout(500);
    await selectWord(page, 't', 'steep');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('settings page lists, removes, and adds quiet sites', async ({ context, extensionId }) => {
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['example.com', 'other.com']) }),
    );

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    await options.reload();
    await options.waitForSelector('settings-form');

    const rows = options.locator('settings-form #quiet-list li');
    await expect(rows).toHaveCount(2);

    await options
      .locator('settings-form #quiet-list li', { hasText: 'other.com' })
      .locator('button')
      .click();
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['example.com']));

    await options.locator('settings-form #quiet-domain').fill('third.com');
    await options.locator('settings-form #quiet-add').click();
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['example.com', 'third.com']));
  });
});
