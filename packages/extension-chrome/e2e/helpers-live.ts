import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { seedSettings } from './helpers';
import { classifyCardText, type LiveOutcome } from '../../app/src/domain/live-outcome';

/** How long a real Gemini call may take end to end. Generous: gemini-2.5-flash spends thinking
 * tokens before emitting text (a trivial prompt reported thoughtsTokenCount 251), and CI runners
 * are slower than a laptop, where the same flow measured 7.9s. */
export const LIVE_TIMEOUT_MS = 60_000;

/**
 * Point this test at the REAL Gemini API. Seeds the key into chrome.storage exactly the way a
 * user typing it into the options page would, so the key never enters the built bundle
 * (build-guard.ts rejects a dist built with GEMINI_API_KEY set).
 *
 * Skips the test with a warning when no key is configured, so a contributor without one is not
 * blocked. That skip is why ci.yml MUST map the secret into the job — an unmapped secret would
 * silently turn every live test into a skip, and CI would stay green while proving nothing.
 */
export async function useLiveGemini(page: Page): Promise<void> {
  const key = process.env.GEMINI_API_KEY ?? '';
  if (key === '') {
    test.info().annotations.push({
      type: 'warning',
      description: 'GEMINI_API_KEY unset — live coverage did NOT run',
    });
    test.skip(true, 'GEMINI_API_KEY unset');
    return;
  }
  await seedSettings(page, { apiKey: key, hasKey: true, provider: 'gemini' });
}

/**
 * Wait for the card to settle, then classify what it rendered.
 *
 * "Settled" means either a definition long enough to pass the threshold, or one of the known
 * error messages. A still-streaming card is neither, so polling on that condition reads the
 * final text rather than a half-painted chunk — the reason a fixed wait is not used here.
 */
export async function readLiveOutcome(page: Page): Promise<LiveOutcome> {
  const card = page.locator('lookup-card');

  const settledText = async (): Promise<string | null> => {
    if ((await card.count()) === 0) return null;
    const text = await card.innerText();
    // 'ok' means past the length threshold; any error kind carries a matched message. Both are
    // terminal. Only a short, message-free card ("still streaming") keeps us polling — that is
    // the one contract verdict produced by length alone, so it must not settle early.
    const outcome = classifyCardText(text);
    const stillStreaming = outcome.kind === 'contract' && !text.includes('unexpected output');
    return stillStreaming ? null : text;
  };

  try {
    await expect.poll(settledText, { timeout: LIVE_TIMEOUT_MS }).not.toBeNull();
  } catch {
    // Never settled. An absent or still-empty card is a transport symptom, not drift — claiming
    // drift here would raise a false alarm every time Gemini is merely slow.
    return {
      kind: 'transport',
      detail: `card never settled within ${LIVE_TIMEOUT_MS}ms`,
    };
  }

  return classifyCardText(await card.innerText());
}

/**
 * Apply the agreed ladder. Red on contract drift and on setup failure; warning-and-return on
 * transport, so a Google outage cannot redden an unrelated pull request.
 */
export async function expectLiveLookup(page: Page, opts: { word: string }): Promise<void> {
  const outcome = await readLiveOutcome(page);

  if (outcome.kind === 'transport') {
    test.info().annotations.push({
      type: 'warning',
      description: `live Gemini transport failure (not a contract break): ${outcome.detail}`,
    });
    return;
  }
  if (outcome.kind === 'setup') {
    throw new Error(
      `Live Gemini setup failure: ${outcome.detail}. The GEMINI_API_KEY secret is missing, ` +
        'expired, or rejected — fix the secret; do NOT silence this test.',
    );
  }
  if (outcome.kind === 'contract') {
    throw new Error(
      `Gemini CONTRACT DRIFT: ${outcome.detail}. Gemini answered but the client could not ` +
        'parse it — this is the failure mode that broke every lookup on 2026-08-09. ' +
        'Capture the raw response before changing this test.',
    );
  }

  // Red rungs 3 and 6. Rung 5 (body length) is already enforced inside classifyCardText, which
  // returns `contract` below MIN_DEFINITION_CHARS — asserting it again here would be dead code.
  await expect(page.locator('lookup-card h2').first()).toHaveText(opts.word);
  // Rung 6: lookup-client-selector.ts silently falls back to another configured provider, so
  // without this a Gemini break on a machine holding an OpenAI key would still pass green.
  await expect(page.locator('lookup-card .prov-badge')).toHaveText('Gemini');

  // Warning rung 8: whether the model still obeys the prompt template is a property of the
  // model, not of our wire handling, so it annotates and never fails.
  const body = await page.locator('lookup-card').innerText();
  if (!body.includes('TRANSLATION')) {
    test.info().annotations.push({
      type: 'warning',
      description: 'no translation line rendered — model may have stopped obeying the template',
    });
  }
}
