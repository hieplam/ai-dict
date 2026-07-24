import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  gotoResetFixture,
  selectWord,
  openTrigger,
  mockGemini,
} from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Capture-only spec: drives the REAL extension in Chromium and writes screenshots used as the
// PR's Before/After evidence. No behavioural assertions — the *.spec.ts siblings own those.
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../e2e-evidence/onboarding',
);
const shot = (name: string) => path.join(out, `${name}.png`);

test('evidence: onboarding screen (light, dark, narrow, key-entered)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');
  await page.screenshot({ path: shot('onboarding-light') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: shot('onboarding-dark') });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('onboarding-view #key').fill('AIza-example-key');
  await page.screenshot({ path: shot('onboarding-key-entered') });

  await page.setViewportSize({ width: 390, height: 860 });
  await page.locator('onboarding-view #key').fill('');
  await page.screenshot({ path: shot('onboarding-narrow') });
});

test('evidence: settings screen after activating from onboarding', async ({
  context,
  extensionId,
}) => {
  // C2: activation now runs a real connection.test before swapping to settings — mock the
  // provider (200 OK) so the test passes and the screen advances, mirroring onboarding.spec.ts.
  await mockGemini(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('onboarding-view');
  await page.locator('onboarding-view #key').fill('AIza-activated');
  await page.locator('onboarding-view #activate').click();
  await page.waitForSelector('settings-form');
  await page.screenshot({ path: shot('settings-after-activation') });
});

test('evidence: BEFORE — old no-key card dead-end (simulated old render)', async ({
  context,
  extensionId,
}) => {
  // The card chrome is unchanged by this PR — only the no-key *content* changed. We reproduce the
  // OLD render (a red "Lookup failed" + the bare message, no action) inside the real card so the
  // Before/After comparison is faithful and like-for-like.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => {
    const el = document.querySelector('bottom-sheet lookup-card')!;
    const h = document.createElement('h2');
    h.textContent = 'Lookup failed';
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = 'Add your Gemini API key in Settings.';
    el.replaceChildren(h, p);
  });
  await page.waitForTimeout(150);
  await card.screenshot({ path: shot('card-no-key-BEFORE') });
});

test('evidence: no-key Define card setup invite (light + dark)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(200);
  await card.screenshot({ path: shot('card-no-key-light') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(150);
  await card.screenshot({ path: shot('card-no-key-dark') });
});

test('evidence: no-key side panel setup invite (light + dark)', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  await expect(panel.locator('side-panel-view')).toContainText('Set up AI Dictionary', {
    timeout: 10_000,
  });
  await panel.screenshot({ path: shot('side-panel-no-key-light') });

  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.waitForTimeout(150);
  await panel.screenshot({ path: shot('side-panel-no-key-dark') });
});

// ——— Evidence for the settings-reachability PR: centered setup invite on hostile-reset pages
// and the new header Settings gear (card + side panel). ———
const navOut = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../e2e-evidence/settings-nav',
);
const navShot = (name: string) => path.join(navOut, `${name}.png`);

test('evidence: no-key card on a hostile-reset page (light + dark)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false });
  await gotoResetFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('Set up AI Dictionary', { timeout: 10_000 });
  await page.waitForTimeout(200);
  await card.screenshot({ path: navShot('card-no-key-reset-light') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(150);
  await card.screenshot({ path: navShot('card-no-key-reset-dark') });
});

test('evidence: result card with the header Settings gear', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page);
  await mockGemini(context);
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await expect(card).toContainText('bank', { timeout: 10_000 });
  await page.waitForTimeout(200);
  await card.screenshot({ path: navShot('card-result-header-gear') });
});

test('evidence: side panel with the header Settings gear', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: navShot('side-panel-header-gear') });
});

// ——— Evidence for the provider-selection PR: the Connection section gains an AI-provider
// picker; the key row morphs per provider; both keys survive switching. ———
const providerOut = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../e2e-evidence/provider-selection',
);
const providerShot = (name: string) => path.join(providerOut, `${name}.png`);

test('evidence: settings with the AI provider picker (gemini + openai views)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: 'AIza-example', openaiApiKey: 'sk-example' });
  await page.reload();
  await page.waitForSelector('settings-form');
  await page.screenshot({ path: providerShot('settings-provider-gemini-AFTER') });

  await page.locator('settings-form #provider').selectOption('openai');
  await page.waitForTimeout(150);
  await page.screenshot({ path: providerShot('settings-provider-openai-AFTER') });

  // Close-up of the Connection section in the OpenAI state for the PR table.
  const section = page.locator('settings-form section[aria-labelledby="sec-conn"]');
  await section.screenshot({ path: providerShot('connection-openai-AFTER') });
  await page.locator('settings-form #provider').selectOption('gemini');
  await page.waitForTimeout(150);
  await section.screenshot({ path: providerShot('connection-gemini-AFTER') });
});
