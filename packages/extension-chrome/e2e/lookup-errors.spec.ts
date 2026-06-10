import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { MockGeminiOpts, SettingsOverrides } from './helpers';

interface Case {
  name: string;
  settings?: SettingsOverrides;
  mock?: MockGeminiOpts;
  expected: string;
}

// NOTE: the no-key case is intentionally NOT here — it is no longer a plain error message but a
// setup invite with an "Open Settings" action, covered in full by onboarding.spec.ts.
const CASES: Case[] = [
  {
    name: 'offline / aborted',
    mock: { abort: true },
    expected: 'Network failed. Check connection and retry.',
  },
  { name: 'HTTP 401', mock: { status: 401, body: '{}' }, expected: 'Google rejected the API key.' },
  {
    name: 'HTTP 400 INVALID_ARGUMENT',
    mock: { status: 400, body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }) },
    expected: 'Google rejected the API key.',
  },
  { name: 'HTTP 429', mock: { status: 429, body: '{}' }, expected: 'Hit Gemini rate limit.' },
  { name: 'HTTP 500', mock: { status: 500, body: '{}' }, expected: 'Gemini server error. Retry.' },
  {
    name: 'malformed body',
    mock: { status: 200, body: 'not json' },
    expected: 'Gemini returned unexpected output.',
  },
];

for (const c of CASES) {
  test(`error: ${c.name} → "${c.expected}"`, async ({ context, extensionId }) => {
    if (c.mock) await mockGemini(context, c.mock);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, c.settings);
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText(c.expected, {
      timeout: 10_000,
    });
  });
}
