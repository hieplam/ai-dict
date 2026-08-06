import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord } from './helpers';
// Deep-imported (not from '@ai-dict/app' / '../src/adapters/chrome-floating-trigger') on purpose:
// both of those entry points run registerContentElements() at module load, which calls
// `customElements.define` — a browser-only API. This e2e file runs in Node (the Playwright test
// process), so importing either barrel would crash at import time with "HTMLElement is not
// defined." dom-selection-source.ts and trigger-marks.ts have zero such side effects (verified: a
// dry run of this exact spec against the built extension is what caught the crash and produced
// this fix — see the design spec §3).
import { SELECTION_FIRED_MARK } from '../../app/src/app/dom-selection-source';
import { TRIGGER_SHOWN_MARK } from '../src/adapters/trigger-marks';
import type { CDPSession } from '@playwright/test';

// A15: the CI ceiling deliberately sits above the 50ms product budget (design spec §4) to absorb
// headless-CI timing noise without masking a real regression.
const CI_LATENCY_CEILING_MS = 150;
const TRIALS = 5;
// A15 design spec §6: guard band for the real interaction — well below a genuine forced-reflow
// thrash (30+ per the calibration test below) and just above the observed real-path ceiling (1).
const LAYOUT_GUARD = 2;

interface CdpMetrics {
  LayoutCount: number;
  RecalcStyleCount: number;
}

async function metrics(session: CDPSession): Promise<CdpMetrics> {
  const { metrics: raw } = (await session.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const map = Object.fromEntries(raw.map((m) => [m.name, m.value]));
  return { LayoutCount: map.LayoutCount ?? 0, RecalcStyleCount: map.RecalcStyleCount ?? 0 };
}

test.describe('A15 trigger latency budget', () => {
  test('calibration: the LayoutCount signal detects a synthetic forced-reflow loop on this Chromium build', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page);
    await page.waitForTimeout(500);

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    const before = await metrics(session);
    await page.evaluate(() => {
      const p = document.getElementById('t') as HTMLElement;
      for (let i = 0; i < 30; i++) {
        p.style.marginLeft = `${i}px`;
        void p.offsetWidth; // deliberately forces a synchronous layout every iteration
      }
    });
    const after = await metrics(session);
    expect(after.LayoutCount - before.LayoutCount).toBeGreaterThanOrEqual(20);
  });

  test('trigger latency stays under the CI budget and shows zero forced reflow, across 5 selection cycles', async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await gotoFixture(page, 'The bank by the river is steep.');
    await page.waitForTimeout(500);

    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');

    const samples: { durationMs: number; layoutDelta: number; recalcDelta: number }[] = [];

    for (let i = 0; i < TRIALS; i++) {
      // Collapse before re-selecting, mirroring selection.spec.ts's proven "dismiss then
      // re-select" pattern (packages/extension-chrome/e2e/selection.spec.ts:37-58).
      await page.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.evaluate(
        ({ sel, shown }) => {
          performance.clearMarks(sel);
          performance.clearMarks(shown);
          performance.clearMeasures();
        },
        { sel: SELECTION_FIRED_MARK, shown: TRIGGER_SHOWN_MARK },
      );

      const before = await metrics(session);
      await selectWord(page, 't', 'bank');
      await page.waitForFunction(
        (name) => performance.getEntriesByName(name).length > 0,
        TRIGGER_SHOWN_MARK,
        { timeout: 3_000 },
      );
      const after = await metrics(session);

      const durationMs = await page.evaluate(
        ({ sel, shown }) => {
          performance.measure('ai-dict:trigger-latency', sel, shown);
          return performance.getEntriesByName('ai-dict:trigger-latency').at(-1)!.duration;
        },
        { sel: SELECTION_FIRED_MARK, shown: TRIGGER_SHOWN_MARK },
      );

      samples.push({
        durationMs,
        layoutDelta: after.LayoutCount - before.LayoutCount,
        recalcDelta: after.RecalcStyleCount - before.RecalcStyleCount,
      });
    }

    await testInfo.attach('a15-samples.json', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });

    for (const [i, s] of samples.entries()) {
      expect(s.durationMs, `trial ${i} latency`).toBeLessThan(CI_LATENCY_CEILING_MS);
      expect(s.layoutDelta, `trial ${i} LayoutCount delta`).toBeLessThanOrEqual(LAYOUT_GUARD);
      expect(s.recalcDelta, `trial ${i} RecalcStyleCount delta`).toBeLessThanOrEqual(LAYOUT_GUARD);
    }
  });
});
