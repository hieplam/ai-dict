import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Theme setting end-to-end: the options page exposes Appearance → Theme (light default),
// the saved value is stamped as a `theme` attribute on every surface, and `system` is the
// only mode that follows the OS. Doubles as the evidence capture for the PR
// (screenshots land in e2e-evidence/theme/).
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e-evidence/theme');
const shot = (name: string) => path.join(out, `${name}.png`);

test('options page defaults to LIGHT even on a dark OS, and saving Dark flips it live', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' }); // a dark OS must NOT darken the page anymore
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present → settings screen; theme defaults to light
  await page.reload();
  const form = page.locator('settings-form');
  await form.waitFor();

  // Light default: stamped attribute + the light near-white surface, despite the dark OS.
  await expect(form).toHaveAttribute('theme', 'light');
  await expect(form.locator('#theme')).toHaveValue('light');
  const surface = () =>
    form.evaluate((el) => getComputedStyle(el).getPropertyValue('--ad-surface').trim());
  expect(await surface()).toContain('0.992');
  await page.screenshot({ path: shot('settings-light-default-on-dark-os') });

  // Choose Dark + Save → the page re-stamps itself immediately.
  await form.locator('#theme').selectOption('dark');
  await form.locator('#save').click();
  await expect(form).toHaveAttribute('theme', 'dark');
  expect(await surface()).toContain('0.285');
  await page.screenshot({ path: shot('settings-dark-after-save') });

  // System follows the (emulated) dark OS…
  await form.locator('#theme').selectOption('system');
  await form.locator('#save').click();
  await expect(form).toHaveAttribute('theme', 'system');
  expect(await surface()).toContain('0.285');
  await page.screenshot({ path: shot('settings-system-on-dark-os') });

  // …and the light OS.
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await surface()).toContain('0.992');
});

test('saved dark theme reaches the in-page bubble and card as a stamped attribute', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false, theme: 'dark' });
  await gotoFixture(page);
  await page.waitForTimeout(1_000); // let the content script seed the theme via settings.get

  await selectWord(page, 't', 'bank');
  const trigger = page.locator('lookup-trigger');
  await trigger.waitFor({ state: 'attached' });
  await expect(trigger).toHaveAttribute('theme', 'dark');
  await trigger.screenshot({ path: shot('define-bubble-dark') });

  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(card).toHaveAttribute('theme', 'dark');
  await card.screenshot({ path: shot('card-dark') });
});

test('stored light theme keeps the in-page card light', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false, theme: 'light' });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(card).toHaveAttribute('theme', 'light');
  await card.screenshot({ path: shot('card-light') });
});
