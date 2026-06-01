import { mapError, DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';
// Import directly (not via the barrel) to avoid pulling in DOM-heavy shared-ui into the SW bundle
import { GeminiLookupClient } from '@ai-dict/adapters-shared/gemini-lookup-client';
import { buildRouter, WriteQueue, SUPPRESS } from './router';
import { classifyInbound } from './inbound';
import { ChromeKvStore } from './adapters/chrome-kv-store';
import { ChromeStorageStore } from './adapters/chrome-storage-store';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? { targetLang: DEFAULT_TARGET, promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };
}

const router = buildRouter({
  client: new GeminiLookupClient({ fetch: (u, i) => fetch(u, i), getApiKey: async () => (await readFullSettings()).apiKey }),
  settings: new ChromeStorageStore(chrome.storage.local),
  kv: new ChromeKvStore(chrome.storage.local),
  readToggles: async () => { const s = await readFullSettings(); return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory }; },
  queue: new WriteQueue(),
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const decision = classifyInbound(msg, sender.id, chrome.runtime.id);
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') { sendResponse(decision.reply); return true; }
  router(decision.msg)
    .then((reply) => { if (reply !== SUPPRESS) sendResponse(reply); })
    .catch((e: unknown) => sendResponse({ ok: false, type: decision.msg.type, error: mapError({ kind: 'thrown', error: e }) }));
  return true; // async sendResponse → keep channel open
});

// Side panel: open only via toolbar click (§6.5); never the primary surface.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
