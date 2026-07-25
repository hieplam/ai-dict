import { test, expect } from './fixtures';
import { seedSettings, mockGemini } from './helpers';

test.describe('C9 setup health check', () => {
  test('API key rows reflect which providers are configured, with working fix buttons', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, {
      provider: 'gemini',
      apiKey: 'AIza-test',
      openaiApiKey: '',
      anthropicApiKey: '',
      configuredProviders: ['gemini'],
      hasKey: true,
    });
    await page.reload();
    await page.waitForSelector('settings-form');

    // Playwright's CSS locator engine pierces open shadow roots automatically (same convention
    // as every existing spec, e.g. options-actions.spec.ts's `'settings-form #test'`) — no `>>>`
    // needed.
    const geminiBadge = page.locator('settings-form #key-status-gemini-badge');
    const openaiBadge = page.locator('settings-form #key-status-openai-badge');
    await expect(geminiBadge).toHaveText('Configured');
    await expect(openaiBadge).toHaveText('Missing');

    const openaiFix = page.locator('settings-form #key-status-openai-fix');
    await expect(openaiFix).toBeVisible();
    await openaiFix.click();
    await expect(page.locator('settings-form #provider')).toHaveValue('openai');
    await expect(page.locator('settings-form #key')).toBeFocused();
  });

  test('shortcut rows show all commands unassigned out of the box', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page);
    await page.reload();
    await page.waitForSelector('settings-form');

    // manifest.json declares no suggested_key for any of its three named commands, and Chrome
    // deterministically prepends the implicit `_execute_action` command to
    // chrome.commands.getAll() for every MV3 extension with a browser action — 4 rows total. A
    // fresh profile in the bundled Chromium reports all four unassigned; no mocking needed
    // (design spec §3.5).
    const rows = page.locator('settings-form #shortcut-rows .health-row');
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      await expect(row.locator('.health-badge')).toHaveText('Not assigned');
    }
    await expect(page.locator('settings-form .health-url')).toHaveText(
      'chrome://extensions/shortcuts',
    );
  });

  test('the relocated connection-test row still reports Connection OK', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { apiKey: 'AIza-test', hasKey: true });
    await page.reload();
    await page.waitForSelector('settings-form');
    await page.locator('settings-form #test').click();
    await expect(page.locator('settings-form #status')).toHaveText('Connection OK');
  });
});
