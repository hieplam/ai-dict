import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger } from './helpers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Theme setting end-to-end (Paperlight): the options page exposes Appearance → Theme (Sepia
// default), the saved value is stamped as a `data-ad-theme` attribute on every surface, and
// `system` is the only mode that follows the OS. The options form is deliberately neutral
// browser-chrome (§5.8), so its theme is observed via the computed `color-scheme` (Sepia &
// High Contrast are light; Dark is dark) rather than an --ad-* surface token. The in-page
// bubble/card DO carry the Paperlight palette, so those assert --ad-surface directly.
// Doubles as PR evidence capture (screenshots land in e2e-evidence/theme/).
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e-evidence/theme');
const shot = (name: string) => path.join(out, `${name}.png`);

const colorScheme = (form: import('@playwright/test').Locator) =>
  form.evaluate((el) => getComputedStyle(el).getPropertyValue('color-scheme').trim());

test('options page defaults to SEPIA even on a dark OS, and saving Dark flips it live', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' }); // a dark OS must NOT darken the page anymore
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page); // key present → settings screen; theme defaults to sepia
  await page.reload();
  const form = page.locator('settings-form');
  await form.waitFor();

  // Sepia default: stamped attribute + a LIGHT native color-scheme, despite the dark OS.
  await expect(form).toHaveAttribute('data-ad-theme', 'sepia');
  await expect(form.locator('#theme')).toHaveValue('sepia');
  expect(await colorScheme(form)).toContain('light');
  await page.screenshot({ path: shot('settings-sepia-default-on-dark-os') });

  // Choose Dark + Save → the page re-stamps itself immediately.
  await form.locator('#theme').selectOption('dark');
  await form.locator('#save').click();
  await expect(form).toHaveAttribute('data-ad-theme', 'dark');
  expect(await colorScheme(form)).toContain('dark');
  await page.screenshot({ path: shot('settings-dark-after-save') });

  // High Contrast is a light scheme too.
  await form.locator('#theme').selectOption('contrast');
  await form.locator('#save').click();
  await expect(form).toHaveAttribute('data-ad-theme', 'contrast');
  expect(await colorScheme(form)).toContain('light');

  // System follows the (emulated) dark OS…
  await form.locator('#theme').selectOption('system');
  await form.locator('#save').click();
  await expect(form).toHaveAttribute('data-ad-theme', 'system');
  expect(await colorScheme(form)).toContain('dark');
  await page.screenshot({ path: shot('settings-system-on-dark-os') });

  // …and the light OS.
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await colorScheme(form)).toContain('light');
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
  await expect(trigger).toHaveAttribute('data-ad-theme', 'dark');
  await trigger.screenshot({ path: shot('define-bubble-dark') });

  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(card).toHaveAttribute('data-ad-theme', 'dark');
  // The card carries the Paperlight palette — its dark surface token is applied.
  const surface = await card.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--ad-surface').trim(),
  );
  expect(surface).toContain('0.255');
  await card.screenshot({ path: shot('card-dark') });
});

test('stored sepia theme keeps the in-page card on warm paper', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(page, { apiKey: '', hasKey: false, theme: 'sepia' });
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  const card = page.locator('bottom-sheet lookup-card');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(card).toHaveAttribute('data-ad-theme', 'sepia');
  const surface = await card.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--ad-surface').trim(),
  );
  expect(surface).toContain('0.962');
  await card.screenshot({ path: shot('card-sepia') });
});
