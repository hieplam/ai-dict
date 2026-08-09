import type { Page, BrowserContext, Worker } from '@playwright/test';

export const GEMINI_GLOB = 'https://generativelanguage.googleapis.com/**';

/** Default OK Gemini body for the canonical "bank" fixture. */
export const GEMINI_OK_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '## bank\nA financial institution.' }] } }],
});

/**
 * A5: an OK Gemini body that carries a TRANSLATION signal line, so the parsed LookupResult's
 * `translation` field is populated (see domain/translation-line.ts) — the gloss bubble only
 * renders when a translation is present. Same envelope shape as GEMINI_OK_BODY; mockGemini
 * auto-detects the streaming endpoint and wraps this as an SSE frame when needed.
 */
export const GEMINI_TRANSLATION_BODY = JSON.stringify({
  candidates: [
    {
      content: {
        parts: [{ text: 'TRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.' }],
      },
    },
  ],
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
  /** B3: paint saved learning-status words on pages. Omit to exercise the `?? true` default. */
  highlightSavedWords?: boolean;
  /** A5: opt-in compact gloss render mode. Omit to exercise the default-off path. */
  glossMode?: boolean;
  /** A14: opt-in double-click-to-define. Omit to exercise the default-off path. */
  doubleClickLookup?: boolean;
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
 * Wrap a pre-serialized JSON payload as ONE server-sent-events frame, byte-identical to what
 * `generativelanguage.googleapis.com/…:streamGenerateContent?alt=sse` puts on the wire: the frame
 * terminator is CRLF CRLF (`\r\n\r\n` — bytes `0d 0a 0d 0a` in a hexdump of a live response), not
 * the bare `\n\n` these mocks used until the SSE-framing fix. Every Gemini streaming mock in the
 * e2e suite MUST build frames through this helper — hand-rolled `\n\n` framing is what let a
 * parser that only recognized `\n\n` pass the whole suite while failing 100% of real lookups.
 */
export function sseFrame(json: string): string {
  return `data: ${json}\r\n\r\n`;
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
    const status = opts.status ?? 200;
    const body = opts.body ?? GEMINI_OK_BODY;
    const isStream = route.request().url().includes(':streamGenerateContent');
    if (isStream && status < 400) {
      await route.fulfill({
        status,
        contentType: 'text/event-stream',
        headers: opts.headers ?? {},
        body: sseFrame(body),
      });
      return;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: opts.headers ?? {},
      body,
    });
  });
  return calls;
}

export const GEMINI_STREAM_GLOB = '**/*:streamGenerateContent*';

/**
 * A1: fulfills Gemini's SSE streaming endpoint with `events` joined into real CRLF-terminated
 * frames via `sseFrame` (each `event` a pre-serialized JSON string, e.g. the same shape
 * mockGemini's OK body uses per chunk). Routes on the CONTEXT (not the page), same reasoning
 * mockGemini already documents — the fetch originates in the service worker.
 */
export async function mockGeminiStream(
  context: BrowserContext,
  events: string[],
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(GEMINI_STREAM_GLOB, async (route) => {
    calls.count++;
    const body = events.map(sseFrame).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
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

/**
 * A2: make a deterministic selection over `word` inside the currently-open lookup-card's
 * definition body (`.lookup-answer`), then dispatch mouseup — drives a recursive in-definition
 * lookup exactly like `selectWord` drives an ordinary page selection.
 */
export async function selectWordInCard(page: Page, word: string): Promise<void> {
  await page.evaluate((word) => {
    const root = document.querySelector('lookup-card .lookup-answer');
    if (!root) throw new Error('no .lookup-answer found — is a result card open?');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    let idx = -1;
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const i = (n.textContent ?? '').indexOf(word);
      if (i >= 0) {
        node = n;
        idx = i;
        break;
      }
    }
    if (!node) throw new Error(`"${word}" not found inside .lookup-answer`);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + word.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, word);
}

/** Move the real mouse to the center of `word`'s first occurrence inside `#${id}`, then nudge it
 * by 1px so a throttled/rAF-gated first tick is never lost. Two calls (not one) so the
 * controller's mousemove handler always sees at least one event after settling on the target
 * coordinates — matches how a real hover gesture arrives as a short burst, not a single point. */
export async function hoverWord(page: Page, id: string, word: string): Promise<void> {
  const point = await page.evaluate(
    ({ id, word }) => {
      const p = document.getElementById(id)!;
      const textNode = p.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { id, word },
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.move(point.x + 1, point.y);
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

/**
 * A14: like selectWord, but dispatches the synthetic mouseup ON the container element (not
 * document) with detail: 2 — the UI Events click-count value a real double-click's second
 * mouseup carries. Dispatching on the container (not document) means `event.target` is that
 * element, so DomSelectionSource's `isGuardedTarget(ev.target)` check exercises the real guard
 * list against whatever element actually contains the word.
 */
export async function dblclickWord(page: Page, id: string, word: string): Promise<void> {
  await page.evaluate(
    ({ id, word }) => {
      const container = document.getElementById(id)!;
      const textNode = container.firstChild!;
      const text = textNode.textContent ?? '';
      const start = text.indexOf(word);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 2 }));
    },
    { id, word },
  );
}

/**
 * A14: like gotoFixture, but the page also ships a `<div id="edit" contenteditable="true">`
 * region — the guarded-target e2e proves the double-click bypass never fires inside it even
 * with the feature switched on.
 */
export async function gotoEditableFixture(
  page: Page,
  paragraph = 'The bank by the river is steep.',
  editableText = 'Edit this bank statement.',
): Promise<void> {
  await page.route('http://test.fixture/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p id="t">${paragraph}</p><div id="edit" contenteditable="true">${editableText}</div></body></html>`,
    }),
  );
  await page.goto('http://test.fixture/');
}
