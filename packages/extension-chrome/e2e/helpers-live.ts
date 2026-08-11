import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { seedSettings } from './helpers';
// Deep-imported (not from '@ai-dict/app') on purpose: the barrel re-exports the UI web
// components, which run registerContentElements() at module load and call
// `customElements.define` — a browser-only API. This e2e file runs in Node (the Playwright test
// process), so importing the barrel would crash at import time with "HTMLElement is not
// defined." packages/app/src/domain/live-outcome.ts has zero such side effects.
import {
  classifyCardText,
  classifyPoll,
  classifyTimeout,
  type LiveOutcome,
} from '../../app/src/domain/live-outcome';

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
 * "Settled" means either one of the known error messages, or a terminal (non-streaming)
 * definition. A still-streaming card is neither, so polling on that condition reads the final
 * text rather than a half-painted chunk — the reason a fixed wait is not used here.
 *
 * Text length alone is NOT a safe settle signal for the 'ok' case: inline-bottom-sheet-renderer.ts's
 * renderPartial() repeatedly repaints CardState `{kind:'streaming'}` while the model is still
 * talking, and lookup-card.ts's `renderCardState` only calls `renderMetaRow` (which creates
 * `.prov-badge`) from the terminal 'result' branch — the 'streaming' branch never renders it. A
 * real definition can cross MIN_DEFINITION_CHARS well before the stream finishes, so settling on
 * length alone would let expectLiveLookup's h2/`.prov-badge` assertions race the live stream with
 * only Playwright's default ~5s expect timeout, not this file's 60s LIVE_TIMEOUT_MS. `data-streaming`
 * is the fix: it is cleared by the SAME synchronous call that produces the terminal DOM
 * (renderResult/renderError in inline-bottom-sheet-renderer.ts), so its absence is the real
 * "renderMetaRow has run" signal, checked only once the text is long enough to matter.
 *
 * This function performs ONLY I/O (reading the card's text and its `data-streaming` attribute);
 * every settle/timeout decision is delegated to the pure `classifyPoll`/`classifyTimeout` in
 * packages/app/src/domain/live-outcome.ts, per pure-core.md — the edge stays thin and
 * decision-free, and the decisions themselves are unit-tested without a browser.
 */
export async function readLiveOutcome(page: Page): Promise<LiveOutcome> {
  const card = page.locator('lookup-card');
  // Set the instant a poll observes `data-streaming` true. classifyTimeout uses this to tell a
  // hung render (bytes arrived, terminal state never followed) apart from a transport symptom
  // (nothing ever arrived) — see classifyTimeout's doc comment for why that distinction matters.
  let sawStreaming = false;

  const settledText = async (): Promise<string | null> => {
    if ((await card.count()) === 0) return null;
    const text = await card.innerText();
    // The DOM attribute is only relevant once the text itself reads 'ok' (classifyPoll ignores
    // `isStreaming` for every other outcome kind), so avoid the extra DOM read otherwise.
    const isStreaming =
      classifyCardText(text).kind === 'ok'
        ? await card.evaluate((el) => el.hasAttribute('data-streaming'))
        : false;
    if (isStreaming) sawStreaming = true;
    return classifyPoll(text, isStreaming) === 'poll' ? null : text;
  };

  try {
    await expect.poll(settledText, { timeout: LIVE_TIMEOUT_MS }).not.toBeNull();
  } catch {
    return classifyTimeout(sawStreaming, LIVE_TIMEOUT_MS);
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

  // Rung 8 ("a translation line rendered") is deliberately NOT checked here, for the same reason
  // rung 7 is not implemented above: this spec drives the full-card path (glossMode unset,
  // defaulting off — see helpers.ts). translation-line.ts's parseTranslation unconditionally
  // strips the raw `TRANSLATION: "..."` signal line out of the body before it ever reaches the
  // renderer, and inline-bottom-sheet-renderer.ts only reads the PARSED `r.translation` inside
  // the gloss-bubble branch (guarded by `!cardOpen && glossMode && hasGloss`), which lookup-card's
  // full-card 'result' state never surfaces at all (grep confirms lookup-card.ts never reads
  // `translation`). So a body/text search for the literal string 'TRANSLATION' can never be true
  // on this code path regardless of model behavior — checking it here would be a warning that
  // fires unconditionally on every run, which is worse than no check at all.
}
