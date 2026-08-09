import type { BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  selectWordInCard,
  openTrigger,
  GEMINI_GLOB,
  sseFrame,
} from './helpers';

/** Route Gemini with a different canned definition per requested word, matched on the exact
 * `Word/phrase: "<word>"` line the prompt always contains (default-template.ts). Handles BOTH the
 * streaming (`:streamGenerateContent`, text/event-stream) and non-streaming JSON transports, like
 * lookup.spec.ts. Canned bodies are plain sentences (no `##` headings) so the only <h2> in the card
 * is the headword. Chain: spelunking -> caves -> chambers -> underground (depth cap). */
async function mockChainedGemini(context: BrowserContext) {
  const calls = { count: 0 };
  await context.route(GEMINI_GLOB, async (route) => {
    // postData() is the raw JSON HTTP body, so the prompt's own embedded quotes come back
    // backslash-escaped (`\"caves\"`) — parse it first and match against the DECODED prompt
    // text (mirrors b13-related-words.spec.ts / idiom-expansion.spec.ts), never the raw string.
    const raw = route.request().postData() ?? '';
    let prompt = '';
    try {
      const parsed = JSON.parse(raw) as { contents?: { parts?: { text?: string }[] }[] };
      prompt = parsed.contents?.[0]?.parts?.[0]?.text ?? '';
    } catch {
      /* non-JSON body: fall through with an empty prompt, matches the default branch below */
    }
    let text: string;
    if (prompt.includes('Word/phrase: "chambers"')) {
      text = 'Enclosed spaces or rooms, often underground.';
    } else if (prompt.includes('Word/phrase: "caves"')) {
      text = 'Natural underground chambers, often formed in limestone.';
    } else if (prompt.includes('Word/phrase: "bank"')) {
      text = 'A financial institution beside the river.';
    } else {
      text = 'The hobby of exploring caves, popular among adventurers.';
    }
    calls.count++;
    const json = JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
    const isStream = route.request().url().includes(':streamGenerateContent');
    if (isStream) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseFrame(json),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: json });
  });
  return calls;
}

test('selecting a word inside the card recurses; Back walks up the chain with no re-fetch; depth caps at 3', async ({
  context,
  extensionId,
}) => {
  const calls = await mockChainedGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'She loved spelunking on weekends.');
  await page.waitForTimeout(1_000);
  const card = page.locator('bottom-sheet lookup-card');

  // Depth 1: outer lookup — no parent yet.
  await selectWord(page, 't', 'spelunking');
  await openTrigger(page);
  await expect(card).toContainText('exploring caves', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0);

  // Depth 2: select "caves" inside the definition.
  await page.waitForTimeout(2_100); // clear the shared cooldown (A2: no special bypass, design §3)
  await selectWordInCard(page, 'caves');
  await openTrigger(page);
  await expect(card).toContainText('limestone', { timeout: 10_000 });
  await expect(card.locator('h2').first()).toHaveText('caves');
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // Depth 3: select "chambers" inside THAT definition.
  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'chambers');
  await openTrigger(page);
  await expect(card).toContainText('underground', { timeout: 10_000 });
  await expect(card.locator('h2').first()).toHaveText('chambers');
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // Depth cap: at depth 3, selecting a word inside the definition offers NO trigger.
  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'underground');
  await page.waitForTimeout(500);
  await expect(page.locator('lookup-trigger')).toHaveCount(0);

  const callsBeforeBack = calls.count;

  // Back walks up the chain: chambers -> caves -> spelunking, no new network calls.
  await card.locator('.back-btn').click();
  await expect(card.locator('h2').first()).toHaveText('caves', { timeout: 5_000 });
  await card.locator('.back-btn').click();
  await expect(card.locator('h2').first()).toHaveText('spelunking', { timeout: 5_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0); // back at the root

  expect(calls.count).toBe(callsBeforeBack); // Back never re-fetches
});

test('selecting elsewhere on the page while a nested lookup is open resets the chain', async ({
  context,
  extensionId,
}) => {
  await mockChainedGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await gotoFixture(page, 'She loved spelunking near the bank of the river.');
  await page.waitForTimeout(1_000);
  const card = page.locator('bottom-sheet lookup-card');

  await selectWord(page, 't', 'spelunking');
  await openTrigger(page);
  await expect(card).toContainText('exploring caves', { timeout: 10_000 });

  await page.waitForTimeout(2_100);
  await selectWordInCard(page, 'caves');
  await openTrigger(page);
  await expect(card.locator('h2').first()).toHaveText('caves', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(1);

  // A fresh page selection (not inside the card) resets the chain — today's existing behavior.
  await page.waitForTimeout(2_100);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(card.locator('h2').first()).toHaveText('bank', { timeout: 10_000 });
  await expect(card.locator('.back-btn')).toHaveCount(0); // fresh chain, no parent
});

test('the side panel mirrors a recursive result but shows no Back button of its own', async ({
  context,
  extensionId,
}) => {
  await mockChainedGemini(context);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(options);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');

  const tab = await context.newPage();
  await gotoFixture(tab, 'She loved spelunking on weekends.');
  await tab.waitForTimeout(1_000);

  await selectWord(tab, 't', 'spelunking');
  await openTrigger(tab);
  await expect(panel.locator('side-panel-view')).toContainText('exploring caves', {
    timeout: 10_000,
  });

  await tab.waitForTimeout(2_100);
  await selectWordInCard(tab, 'caves');
  await openTrigger(tab);
  await expect(panel.locator('side-panel-view h2').first()).toHaveText('caves', {
    timeout: 10_000,
  });

  // The in-page card DOES show a Back button (recursive chain, depth 2)...
  await expect(tab.locator('bottom-sheet lookup-card .back-btn')).toHaveCount(1);
  // ...but the panel — a persistent mirror, not the transient in-page card — never does.
  await expect(panel.locator('side-panel-view .back-btn')).toHaveCount(0);
});
