import { test, expect } from './fixtures';

// Open side-panel.html as a normal tab, then post {to:'side-panel', state, payload} from a
// SECOND extension page. chrome.runtime.sendMessage broadcasts to other extension contexts;
// side-panel.ts accepts it (sender.id === runtime.id) and maps it onto the card.
async function openPanelAndSender(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('lookup-card');
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/options.html`);
  return { panel, sender };
}

test('renders a result delivered via runtime message', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## bank\nA financial institution.', word: 'bank', target: 'vi' },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('financial institution', {
    timeout: 5_000,
  });
});

test('renders the loading state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() => chrome.runtime.sendMessage({ to: 'side-panel', state: 'loading' }));
  await expect(panel.locator('lookup-card')).toContainText('Looking up', { timeout: 5_000 });
});

test('renders an error state', async ({ context, extensionId }) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'error',
      payload: {
        code: 'NO_KEY',
        message: 'Add your Gemini API key in Settings.',
        retryable: false,
      },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('Add your Gemini API key in Settings.', {
    timeout: 5_000,
  });
});

test('ignores a malformed result payload (guard) and keeps prior content', async ({
  context,
  extensionId,
}) => {
  const { panel, sender } = await openPanelAndSender(context, extensionId);
  // First a valid result, then a malformed one — the card must keep the valid content.
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({
      to: 'side-panel',
      state: 'result',
      payload: { markdown: '## ok\nFirst valid content.', word: 'ok', target: 'vi' },
    }),
  );
  await expect(panel.locator('lookup-card')).toContainText('First valid content.', {
    timeout: 5_000,
  });
  await sender.evaluate(() =>
    chrome.runtime.sendMessage({ to: 'side-panel', state: 'result', payload: { not: 'a result' } }),
  );
  // Give the listener a tick; content must NOT change.
  await panel.waitForTimeout(300);
  await expect(panel.locator('lookup-card')).toContainText('First valid content.');
});
