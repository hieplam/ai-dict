import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test, expect } from './fixtures';
import { seedSettings, getServiceWorker } from './helpers';
import type { BrowserContext, Page } from '@playwright/test';
import type { SavedWordEntry } from '@ai-dict/app';

/**
 * B3 e2e (spec §4.5): re-encounter highlighting end-to-end through a real Chromium tab.
 * NEVER fetches the live landing site — `b3-large.html` is a committed local fixture routed
 * through `page.route`, the same pattern `gotoFixture` in helpers.ts already uses for its inline
 * HTML, just reading from disk instead of a template literal.
 */
const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/b3-large.html',
);
const LARGE_FIXTURE_HTML = readFileSync(FIXTURE_PATH, 'utf8');

async function gotoLargeFixture(page: Page): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: LARGE_FIXTURE_HTML }),
  );
  await page.goto('http://test.fixture/');
}

/**
 * Seed `saved:bank` (status 'learning' — the only status the B3 matcher paints),
 * `saved:money` (status 'known' — must NEVER be highlighted) and `saved:index`, shaped exactly
 * per the E1 schema (mirrors saved-word.spec.ts's own read-back assertions on this shape).
 * Written straight to `chrome.storage.local` via the service worker, matching the shape
 * `savedWordUpsert` itself writes (JSON.stringify'd entry strings, a JSON.stringify'd index
 * array) — see packages/app/src/domain/saved-words-policy.ts.
 */
async function seedSavedWords(context: BrowserContext): Promise<void> {
  const sw = await getServiceWorker(context);
  const now = Date.now();
  const bank: SavedWordEntry = {
    word: 'bank',
    status: 'learning',
    savedAt: now,
    senses: [
      {
        definition: 'A financial institution.',
        translation: '',
        sentence: 'The bank by the river is steep.',
        url: 'http://test.fixture/',
        title: 'B3 large fixture',
      },
    ],
  };
  const money: SavedWordEntry = {
    word: 'money',
    status: 'known',
    savedAt: now,
    senses: [
      {
        definition: 'Currency used to buy things.',
        translation: '',
        sentence: 'He had no money.',
        url: 'http://test.fixture/',
        title: 'B3 large fixture',
      },
    ],
  };
  await sw.evaluate(
    ({ bank, money }) =>
      chrome.storage.local.set({
        'saved:bank': JSON.stringify(bank),
        'saved:money': JSON.stringify(money),
        'saved:index': JSON.stringify(['bank', 'money']),
      }),
    { bank, money },
  );
}

/** Read every painted range's text + whether it falls inside a forbidden (textarea/contenteditable)
 * subtree, straight out of the CSS Custom Highlight API registration the PageHighlighter paints. */
async function readHighlightRanges(
  page: Page,
): Promise<{ texts: string[]; insideForbidden: boolean }> {
  return page.evaluate(() => {
    const highlight = CSS.highlights.get('ad-saved-word');
    if (!highlight) return { texts: [], insideForbidden: false };
    const ranges = [...highlight];
    const texts = ranges.map((r) => r.toString().toLowerCase());
    const insideForbidden = ranges.some((r) => {
      const el = (r.startContainer as Node).parentElement;
      return el ? el.closest('textarea, [contenteditable]') !== null : false;
    });
    return { texts, insideForbidden };
  });
}

test.describe('B3 re-encounter highlighting (e2e)', () => {
  test('paints learning-status matches, skips known/textarea/contenteditable, scans fast', async ({
    context,
    extensionId,
  }) => {
    await seedSavedWords(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // highlightSavedWords key omitted -> exercises the `?? true` default
    await gotoLargeFixture(page);

    // Wait for the idle-chunked initial scan to finish: the scan's own performance.measure only
    // gets recorded once every pending chunk has drained (see PageHighlighter.runChunk), so
    // polling on its presence is the deterministic "scan settled" signal instead of a fixed sleep.
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('ad-highlight-scan').length), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    expect(await page.evaluate(() => CSS.highlights.has('ad-saved-word'))).toBe(true);

    // The fixture also plants 'bank'/'banks' occurrences INSIDE the <textarea> and the
    // contenteditable div (see b3-large.html) — on top of the 3 body-only matches (bank/banks/
    // banking). If the skip filter regressed (SHOW_ALL+nodeType or the isContentEditable-first
    // check in page-highlighter.ts), those extra occurrences would get painted too and this
    // exact-count assertion would fail — unlike a >=3 check, which the skip-block occurrences
    // could never violate even when broken.
    const { texts, insideForbidden } = await readHighlightRanges(page);
    expect(texts.length).toBe(3); // exactly the 3 body-only matches; skip-block occurrences excluded
    for (const t of texts) {
      expect(t.startsWith('bank')).toBe(true); // naive variants: bank/banks/banking all start with 'bank'
    }
    expect(texts).not.toContain('money'); // 'known' status must never be painted
    expect(insideForbidden).toBe(false); // never inside <textarea> or [contenteditable]

    const duration = await page.evaluate(
      () => performance.getEntriesByName('ad-highlight-scan')[0]?.duration,
    );
    expect(duration).toBeLessThan(50);
  });

  test('highlightSavedWords: false disables highlighting entirely', async ({
    context,
    extensionId,
  }) => {
    await seedSavedWords(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { highlightSavedWords: false });
    await gotoLargeFixture(page);
    // No positive signal to poll for (the whole point is nothing happens) — settle the same
    // fixed window doLookup()/other specs already use to let the content script's initial
    // settings.get() resolve before asserting.
    await page.waitForTimeout(1_000);

    expect(await page.evaluate(() => CSS.highlights.has('ad-saved-word'))).toBe(false);
  });

  test('no saved words at all: no-op path registers nothing and stays cheap', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page); // default highlightSavedWords (true); no saved:* keys seeded
    await gotoLargeFixture(page);
    await page.waitForTimeout(1_000);

    expect(await page.evaluate(() => CSS.highlights.has('ad-saved-word'))).toBe(false);

    const durations = await page.evaluate(() =>
      performance.getEntriesByName('ad-highlight-scan').map((e) => e.duration),
    );
    expect(durations.every((d) => d < 50)).toBe(true);
  });
});
