import {
  mapError,
  DEFAULT_TEMPLATE,
  type Settings,
  GeminiLookupClient,
  buildRouter,
  WriteQueue,
  SUPPRESS,
  classifyInbound,
} from '@ai-dict/app';
import { ChromeKvStore } from './adapters/chrome-kv-store';
import { ChromeStorageStore } from './adapters/chrome-storage-store';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  return (
    settings ?? {
      targetLang: DEFAULT_TARGET,
      promptTemplate: DEFAULT_TEMPLATE,
      hasKey: false,
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
      theme: 'light',
    }
  );
}

// Build-time key (esbuild `define`) wins over the stored settings key. Lets you
// ship a personal build with GEMINI_API_KEY in the env and skip the options
// page entirely; empty string => fall through to whatever the user entered.
const ENV_API_KEY = __GEMINI_API_KEY__;

const router = buildRouter({
  client: new GeminiLookupClient({
    fetch: (u, i) => fetch(u, i),
    getApiKey: async () => ENV_API_KEY || (await readFullSettings()).apiKey,
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
    })
    .catch((e: unknown) =>
      sendResponse({
        ok: false,
        type: decision.msg.type,
        error: mapError({ kind: 'thrown', error: e }),
      }),
    );
  return true; // async sendResponse → keep channel open
});

// Side panel: open only via toolbar click (§6.5); never the primary surface.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
