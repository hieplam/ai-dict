import {
  mapError,
  DEFAULT_OUTPUT_FORMAT,
  type Settings,
  GeminiLookupClient,
  OpenAILookupClient,
  createLookupClientSelector,
  buildRouter,
  WriteQueue,
  SUPPRESS,
  classifyInbound,
  ErrorReporter,
} from '@ai-dict/app';
import { ChromeKvStore } from './adapters/chrome-kv-store';
import { ChromeStorageStore } from './adapters/chrome-storage-store';
import { Ga4TelemetrySink } from './adapters/ga4-telemetry-sink';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  return (
    settings ?? {
      targetLang: DEFAULT_TARGET,
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      hasKey: false,
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'sepia',
      provider: 'gemini',
      openaiApiKey: '',
    }
  );
}

// Build-time key (esbuild `define`) wins over the stored settings key. Lets you
// ship a personal build with GEMINI_API_KEY in the env and skip the options
// page entirely; empty string => fall through to whatever the user entered.
// Applies to the Gemini key only — OpenAI keys always come from settings.
const ENV_API_KEY = __GEMINI_API_KEY__;

function browserVersion(): string {
  const m = /Chrome\/[\d.]+/.exec(navigator.userAgent);
  return m ? m[0] : navigator.userAgent.slice(0, 80);
}

const errlogKv = new ChromeKvStore(chrome.storage.local);
const reporter = new ErrorReporter({
  kv: errlogKv,
  sink: new Ga4TelemetrySink(
    { measurementId: __GA4_MEASUREMENT_ID__, apiSecret: __GA4_API_SECRET__ },
    chrome.storage.local,
  ),
  now: () => Date.now(),
  meta: async () => ({
    extVersion: chrome.runtime.getManifest().version,
    browserVersion: browserVersion(),
    provider: (await readFullSettings()).provider ?? 'gemini',
  }),
});

const router = buildRouter({
  client: createLookupClientSelector({
    clients: {
      gemini: new GeminiLookupClient({
        fetch: (u, i) => fetch(u, i),
        getApiKey: async () => ENV_API_KEY || (await readFullSettings()).apiKey,
      }),
      openai: new OpenAILookupClient({
        fetch: (u, i) => fetch(u, i),
        getApiKey: async () => (await readFullSettings()).openaiApiKey ?? '',
      }),
    },
    // Settings stored before the provider field existed have no `provider` → Gemini.
    getProvider: async () => (await readFullSettings()).provider ?? 'gemini',
  }),
  settings: new ChromeStorageStore(chrome.storage.local),
  kv: new ChromeKvStore(chrome.storage.local),
  readToggles: async () => {
    const s = await readFullSettings();
    return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory };
  },
  queue: new WriteQueue(),
  // A content script can't open the options page itself; it sends `open-options` and we do it
  // here. This is the keyless reader's path from the in-page "Open Settings" button to setup.
  openOptions: () => chrome.runtime.openOptionsPage(),
  errlog: reporter,
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') {
    sendResponse(decision.reply);
    return true;
  }
  router(decision.msg)
    .then((reply) => {
      if (reply !== SUPPRESS) sendResponse(reply);
      if (reply !== SUPPRESS && reply.ok === false) {
        const url = decision.msg.type === 'lookup' ? decision.msg.req.url : undefined;
        const { code, message, retryable, retryAfterSec } = reply.error;
        void reporter.capture({
          source:
            reply.type === 'lookup' || reply.type === 'connection.test' ? reply.type : 'thrown',
          error: {
            code,
            message,
            ...(retryable !== undefined ? { retryable } : {}),
            ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
          },
          ...(url !== undefined ? { url } : {}),
        });
      }
    })
    .catch((e: unknown) => {
      const error = mapError({ kind: 'thrown', error: e });
      sendResponse({ ok: false, type: decision.msg.type, error });
      void reporter.capture({
        source: 'thrown',
        error: { code: error.code, message: error.message },
      });
    });
  return true; // async sendResponse → keep channel open
});

// Side panel: open only via toolbar click (§6.5); never the primary surface.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
