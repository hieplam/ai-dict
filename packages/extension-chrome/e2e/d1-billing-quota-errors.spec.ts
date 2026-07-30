import { test, expect } from './fixtures';
import { mockAnthropic, mockOpenAI } from './helpers';

test.describe('D1 billing/quota-exhaustion errors', () => {
  test('an Anthropic BILLING failure keeps the pasted key and lands directly on Settings with honest copy', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockAnthropic(context, {
      status: 400,
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
        },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-fake-key-for-e2e');
    await page.locator('onboarding-view #activate').click();

    // No "Save anyway" round trip — a BILLING failure already proved the key valid and it is
    // already persisted, so onboarding hands straight off to Settings (same shape as success).
    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #status')).toContainText('no credits or billing');
    await expect(page.locator('settings-form #status')).toContainText('Your key is saved');

    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { anthropicApiKey?: string };
      };
      return settings?.anthropicApiKey ?? '';
    });
    expect(stored).toBe('sk-ant-fake-key-for-e2e');
    expect(calls.count).toBe(1);
  });

  test('an OpenAI BILLING failure keeps the pasted key too (provider-agnostic fix)', async ({
    context,
    extensionId,
  }) => {
    await mockOpenAI(context, {
      status: 429,
      body: JSON.stringify({
        error: {
          message: 'You exceeded your current quota, please check your plan and billing details.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="openai"]').click();
    await page.locator('onboarding-view #key').fill('sk-openai-fake-key-for-e2e');
    await page.locator('onboarding-view #activate').click();

    await page.waitForSelector('settings-form', { timeout: 10_000 });
    await expect(page.locator('settings-form #status')).toContainText('no credits or billing');
    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { openaiApiKey?: string };
      };
      return settings?.openaiApiKey ?? '';
    });
    expect(stored).toBe('sk-openai-fake-key-for-e2e');
  });

  test('an INVALID_KEY failure still hard-rolls-back (regression guard, unaffected by D1)', async ({
    context,
    extensionId,
  }) => {
    await mockAnthropic(context, {
      status: 401,
      body: JSON.stringify({
        error: { type: 'authentication_error', message: 'API key is invalid.' },
      }),
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForSelector('onboarding-view');

    await page.locator('onboarding-view button[data-provider="anthropic"]').click();
    await page.locator('onboarding-view #key').fill('sk-ant-bad');
    await page.locator('onboarding-view #activate').click();

    await expect(page.locator('onboarding-view #status')).toContainText('rejected the API key', {
      timeout: 10_000,
    });
    await expect(page.locator('onboarding-view #save-anyway')).toBeHidden();
    const stored = await page.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { anthropicApiKey?: string };
      };
      return settings?.anthropicApiKey ?? '';
    });
    expect(stored).toBe('');
  });
});
