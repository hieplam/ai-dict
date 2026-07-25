import { test, expect } from './fixtures';
import { mockGemini, mockOpenAI, mockAnthropic } from './helpers';

async function storedSettings(
  page: import('@playwright/test').Page,
): Promise<Record<string, unknown>> {
  const { settings } = (await page.evaluate(() => chrome.storage.local.get('settings'))) as {
    settings: Record<string, unknown>;
  };
  return settings;
}

test.describe('C4 any-provider onboarding', () => {
  test('activating with the default Gemini segment writes only the Gemini key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-gemini-real');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('gemini');
    expect(s['apiKey']).toBe('AIza-gemini-real');
    expect(s['openaiApiKey']).toBe('');
    expect(s['anthropicApiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test('switching to OpenAI and activating writes only the OpenAI key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockOpenAI(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-real-1234567890');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('openai');
    expect(s['openaiApiKey']).toBe('sk-openai-real-1234567890');
    expect(s['apiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test('switching to Anthropic and activating writes only the Anthropic key field', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockAnthropic(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-real-1234567890');
    await page.locator('onboarding-view #activate').click();
    await page.waitForSelector('settings-form', { timeout: 10_000 });

    const s = await storedSettings(page);
    expect(s['provider']).toBe('anthropic');
    expect(s['anthropicApiKey']).toBe('sk-ant-real-1234567890');
    expect(s['apiKey']).toBe('');
    expect(calls.count).toBe(1);
  });

  test("switching providers preserves each one's own typed key across a real DOM round trip", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #key').fill('AIza-stash-me');
    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await expect(page.locator('onboarding-view #key')).toHaveValue('');
    await page.locator('onboarding-view #key').fill('sk-stash-me');
    await page.locator('onboarding-view #provider button[data-provider="gemini"]').click();
    await expect(page.locator('onboarding-view #key')).toHaveValue('AIza-stash-me');
  });

  test('a rejected OpenAI key stays on onboarding and rolls back provider + key + hasKey', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockOpenAI(context, {
      status: 401,
      body: JSON.stringify({ error: { message: 'invalid api key' } }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view #provider button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-bad-1234567890');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText(
      'OpenAI rejected the API key.',
      { timeout: 10_000 },
    );
    expect(await page.locator('settings-form').count()).toBe(0);
    expect(calls.count).toBe(1);

    const s = await storedSettings(page);
    expect(s['hasKey']).toBe(false);
    expect(s['openaiApiKey']).toBe('');
  });
});
