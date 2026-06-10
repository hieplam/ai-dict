import type { Page, BrowserContext } from '@playwright/test';

export const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';

/** Default OK Gemini body for the canonical "bank" fixture. */
export const GEMINI_OK_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

export interface SettingsOverrides {
  targetLang?: string;
  promptTemplate?: string;
  apiKey?: string;
  cacheEnabled?: boolean;
  saveHistory?: boolean;
  hasKey?: boolean;
  theme?: 'light' | 'dark' | 'system';
}

/** Write a full settings object to storage. Overrides merge onto sensible defaults. */
export async function seedSettings(page: Page, overrides: SettingsOverrides = {}): Promise<void> {
  await page.evaluate((o) => {
    return chrome.storage.local.set({
      settings: {
        targetLang: 'vi',
        promptTemplate: 'Define {word}',
        apiKey: 'AIza-test',
        cacheEnabled: true,
        saveHistory: true,
        hasKey: true,
        theme: 'light',
        ...o,
      },
    });
  }, overrides);
}

/** Read the entire extension storage as a plain object. */
export async function storageDump(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => chrome.storage.local.get(null) as Promise<Record<string, unknown>>);
}

export interface MockGeminiOpts {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  abort?: boolean; // route.abort('failed') to simulate offline
}

/**
 * Fake the Gemini endpoint and count hits. Routes on the CONTEXT (not the page) because the
 * real fetch originates in the extension's service worker, which page.route cannot intercept.
 * Returns a live counter object: read `.count` after the flow completes.
 */
export async function mockGemini(
  context: BrowserContext,
  opts: MockGeminiOpts = {},
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(GEMINI_GLOB, async (route) => {
    calls.count++;
    if (opts.abort) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body: opts.body ?? GEMINI_OK_BODY,
    });
  });
  return calls;
}

/** Navigate to a synthetic http page so the content script injects on <all_urls>. */
export async function gotoFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p id="t">${paragraph}</p></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}

/**
 * Like gotoFixture, but the page ships a hostile normalize-style reset — zeroed button/p
 * margins, stripped button chrome, inherited text-align — the real-world page CSS that used
 * to override the card's normal ::slotted() declarations and shove the setup CTA off-centre.
 */
export async function gotoResetFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
): Promise<void> {
  const reset =
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'button{margin:0;padding:0;border:0;background:none;font:inherit;text-align:inherit;appearance:none}' +
    'p,h1,h2,h3,svg{margin:0}';
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><head><style>${reset}</style></head><body><p id="t">${paragraph}</p></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}

/** Make a deterministic, non-collapsed selection over `word` inside `#${id}` and dispatch mouseup. */
export async function selectWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const p = document.getElementById(id)!;
      const textNode = p.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { id, word },
  );
}

/** Wait for the floating trigger and click it. */
export async function openTrigger(page: Page): Promise<void> {
  await page.locator('lookup-trigger').waitFor({ state: 'attached', timeout: 5_000 });
  await page.locator('lookup-trigger').click();
}
