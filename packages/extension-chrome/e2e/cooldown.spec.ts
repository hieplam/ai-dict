/**
 * Cooldown e2e — a rapid second Define within the 2s window is blocked client-side (in the
 * content-script workflow) with a "slow down" message and never reaches Gemini. Regression
 * guard for the per-tab lookup cooldown. See
 * docs/superpowers/specs/2026-06-19-lookup-cooldown-design.md.
 *
 * Run: cd packages/extension-chrome && bunx playwright test cooldown.spec.ts
 */
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Gitignored (root .gitignore: e2e-evidence/) — keeps the PR evidence PNG out of the source tree.
const EVIDENCE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../e2e-evidence/cooldown');

test('rapid second Define within 2s is blocked with a "slow down" message and makes no extra Gemini call', async ({
  context,
  extensionId,
}) => {
  const calls = await mockGemini(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // gemini key present; 'river' is uncached so a non-blocked 2nd lookup WOULD hit Gemini
  await gotoFixture(page); // "The bank by the river is steep."
  await page.waitForTimeout(1_000); // let the content workflow initialise

  // 1) First lookup fires immediately, hits the faked Gemini once, renders the result.
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });

  // 2) Rapid second lookup of a DIFFERENT, uncached word, well within the 2s cooldown. Without
  //    the gate this would fire a second Gemini call; the cooldown blocks it client-side.
  await selectWord(page, 't', 'river');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText(
    'Slow down — wait a moment before the next lookup.',
    { timeout: 5_000 },
  );

  // 3) The blocked lookup never reached Gemini: still exactly one call total.
  await expect.poll(() => calls.count, { timeout: 2_000 }).toBe(1);

  // Evidence (gitignored): capture the "slow down" card after the rapid second Define.
  await page.screenshot({ path: `${EVIDENCE}/after-cooldown.png` });

  await page.close();
});
