import { mapError, DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';
// Import directly (not via the barrel) to avoid pulling in DOM-heavy shared-ui into the SW bundle
import { GeminiLookupClient } from '@ai-dict/adapters-shared/gemini-lookup-client';
import { buildRouter, WriteQueue, SUPPRESS } from './router';
import { classifyInbound } from './inbound';
import { SafariKvStore } from './adapters/safari-kv-store';
import { SafariStorageStore } from './adapters/safari-storage-store';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  return (
    settings ?? {
      targetLang: DEFAULT_TARGET,
      promptTemplate: DEFAULT_TEMPLATE,
      hasKey: false,
      apiKey: '',
      cacheEnabled: true,
      saveHistory: true,
    }
  );
}

const router = buildRouter({
  client: new GeminiLookupClient({
    fetch: (u, i) => fetch(u, i),
    getApiKey: async () => (await readFullSettings()).apiKey,
  }),
  settings: new SafariStorageStore(browser.storage.local),
  kv: new SafariKvStore(browser.storage.local),
  readToggles: async () => {
    const s = await readFullSettings();
    return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory };
  },
  queue: new WriteQueue(),
});

// Uses the sendResponse + return true idiom (the WebExtensions runtime.onMessage contract Safari implements).
// SUPPRESS leaves channel open, never replies — return true keeps it open without calling sendResponse.
// The cast is required because @types/webextension-polyfill's OnMessageListenerCallback only allows
// literal `true` as return type, but the WebExtensions spec permits `false` to synchronously close
// the channel (ignore path). The runtime behavior is correct; the types are overly strict here.
type OnMsgListener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => boolean;
(browser.runtime.onMessage.addListener as (fn: OnMsgListener) => void)(
  (msg, sender, sendResponse) => {
    const decision = classifyInbound(msg, sender.id, browser.runtime.id);
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
    return true; // async sendResponse → keep channel open (SUPPRESS leaves it open, never replies)
  },
);
