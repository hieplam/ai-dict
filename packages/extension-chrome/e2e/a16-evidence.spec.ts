import { test } from './fixtures';
import { seedSettings } from './helpers';

// A16 before/after evidence generator. Skipped in CI; run explicitly with:
//   PLAYWRIGHT_RUN_EVIDENCE=1 SHOT_LABEL=after A16_OUT_DIR=/abs/path \
//     bunx playwright test a16-evidence
// Capture BEFORE from a `master` build of the extension and AFTER from the branch build,
// then host the PNGs per the private-repo rule (pr-assets branch + github.com/.../raw URLs).
const RUN = process.env.PLAYWRIGHT_RUN_EVIDENCE === '1';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = process.env.A16_OUT_DIR ?? '.';

// The narrow popup / side-panel width where the form is taller than the viewport — the exact
// condition A16 targets (Save button otherwise stranded at the bottom).
const NARROW = { width: 400, height: 640 };

// The shipped default multi-line Card format, so the Translation section renders at real height
// and the whole form reliably overflows the short viewport.
const DEFAULT_CARD_FORMAT =
  '1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).\n' +
  '2. **Eng -> {target_lang}** — translate the full meaning into the selected language.';

test.describe('A16 sticky save bar — evidence', () => {
  test.skip(!RUN, 'set PLAYWRIGHT_RUN_EVIDENCE=1 to (re)generate A16 before/after shots');

  test(`settings save bar at narrow width (${LABEL})`, async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize(NARROW);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, {
      hasKey: true,
      apiKey: 'AIza-demo-key',
      provider: 'gemini',
      targetLang: 'vi',
      outputFormat: DEFAULT_CARD_FORMAT,
    });
    await page.reload();
    await page.waitForSelector('settings-form');
    await page.waitForTimeout(250);

    // Scroll to the TOP of the long form: this is where a reader edits, and where the old
    // (non-sticky) Save button is off-screen. The AFTER build keeps the bar pinned here.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/a16-${LABEL}-01-top-clean.png` });

    // Make a real edit to a top-of-form field (Target language) → fires change → marks the form
    // dirty in the AFTER build. In the BEFORE build this changes nothing visible (no cue, no
    // sticky bar). Target language is chosen because the Gemini key field can be env-locked.
    await page.locator('#target').selectOption('en');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/a16-${LABEL}-02-top-dirty.png` });
  });
});
