import type { Page, BrowserContext, Worker } from '@playwright/test';

export const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';

/** Default OK Gemini body for the canonical "bank" fixture. */
export const GEMINI_OK_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

export const OPENAI_GLOB = 'https://api.openai.com/**';

/** Default OK OpenAI chat-completions body for the canonical "bank" fixture. */
export const OPENAI_OK_BODY = JSON.stringify({
  choices: [{ message: { content: '## bank\nA financial institution (via OpenAI).' } }],
});

export const ANTHROPIC_GLOB = 'https://api.anthropic.com/**';

/** Default OK Anthropic messages body for the canonical "bank" fixture. */
export const ANTHROPIC_OK_BODY = JSON.stringify({
  content: [{ type: 'text', text: '## bank\nA financial institution (via Claude).' }],
});

export interface SettingsOverrides {
  targetLang?: string;
  outputFormat?: string;
  promptEnvelope?: string;
  apiKey?: string;
  cacheEnabled?: boolean;
  saveHistory?: boolean;
  hasKey?: boolean;
  theme?: 'sepia' | 'dark' | 'contrast' | 'system';
  provider?: 'gemini' | 'openai' | 'anthropic';
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

/** Write a full settings object to storage. Overrides merge onto sensible defaults. */
export async function seedSettings(page: Page, overrides: SettingsOverrides = {}): Promise<void> {
  await page.evaluate((o) => {
    return chrome.storage.local.set({
      settings: {
        targetLang: 'vi',
        outputFormat: 'Define {word}',
        promptEnvelope: '',
        apiKey: 'AIza-test',
        cacheEnabled: true,
        saveHistory: true,
        hasKey: true,
        theme: 'sepia',
        provider: 'gemini',
        openaiApiKey: '',
        anthropicApiKey: '',
        configuredProviders: ['gemini'],
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
  delayMs?: number; // hold the response this long before fulfilling (in-flight/race specs)
  onRequest?: (postData: string) => void; // observe the outbound request body (e.g. assert the prompt)
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
    opts.onRequest?.(route.request().postData() ?? '');
    if (opts.abort) {
      await route.abort('failed');
      return;
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body: opts.body ?? GEMINI_OK_BODY,
    });
  });
  return calls;
}

/**
 * Fake the OpenAI chat-completions endpoint and count hits. Routes on the CONTEXT for the
 * same reason as mockGemini: the fetch originates in the extension's service worker.
 */
export async function mockOpenAI(
  context: BrowserContext,
  opts: MockGeminiOpts = {},
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(OPENAI_GLOB, async (route) => {
    calls.count++;
    if (opts.abort) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body: opts.body ?? OPENAI_OK_BODY,
    });
  });
  return calls;
}

/**
 * Fake the Anthropic messages endpoint and count hits. Routes on the CONTEXT for the
 * same reason as mockGemini: the fetch originates in the extension's service worker.
 */
export async function mockAnthropic(
  context: BrowserContext,
  opts: MockGeminiOpts = {},
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(ANTHROPIC_GLOB, async (route) => {
    calls.count++;
    if (opts.abort) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: opts.status ?? 200,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body: opts.body ?? ANTHROPIC_OK_BODY,
    });
  });
  return calls;
}

/**
 * Navigate to a synthetic http page so the content script injects on <all_urls>.
 * An optional `title` sets the page's <title> (i.e. document.title), which the
 * lookup wires into the prompt — used by the {title}/PII-redaction specs.
 */
export async function gotoFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
  title?: string,
): Promise<void> {
  const head = title === undefined ? '' : `<head><title>${title}</title></head>`;
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html>${head}<body><p id="t">${paragraph}</p></body></html>`,
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

/** Resolve the extension's service worker handle, waiting for registration if needed. */
export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return sw;
}

/**
 * Simulate a chrome.commands keyboard shortcut firing (A4). Playwright/CDP cannot synthesize a
 * real OS-level extension shortcut (Chrome intercepts it before any JS sees a keydown), so this
 * calls chrome.tabs.sendMessage directly from the service worker — the literal call the
 * onCommand listener makes — exercising every line downstream of that (Chrome-owned) listener.
 * Mirrors sw.ts's own `.catch(() => undefined)` on that call: when there is no content-script
 * listener registered for the tab (e.g. relaying against a build that predates this feature,
 * as the before/after evidence spec does), sendMessage rejects with "Could not establish
 * connection" — swallowed here the same way production swallows it, rather than failing the test.
 */
export async function relayCommand(
  sw: Worker,
  command: 'define-selection' | 'dismiss-lookup' | 'send-to-panel',
): Promise<void> {
  await sw.evaluate(async (cmd) => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab?.id) throw new Error('no active tab found for command relay');
    await chrome.tabs.sendMessage(tab.id, { type: 'command', command: cmd }).catch(() => undefined);
  }, command);
}
