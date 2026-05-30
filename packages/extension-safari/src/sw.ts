import { mapError, DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';
import type { Runtime } from 'webextension-polyfill';
// Import directly (not via the barrel) to avoid pulling in DOM-heavy shared-ui into the SW bundle
import { GeminiLookupClient } from '@ai-dict/adapters-shared/gemini-lookup-client';
import { buildRouter, WriteQueue, SUPPRESS } from './router';
import { classifyInbound } from './inbound';
import { SafariKvStore } from './adapters/safari-kv-store';
import { SafariStorageStore } from './adapters/safari-storage-store';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? { targetLang: DEFAULT_TARGET, promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };
}

const router = buildRouter({
  client: new GeminiLookupClient({ fetch: (u, i) => fetch(u, i), getApiKey: async () => (await readFullSettings()).apiKey }),
  settings: new SafariStorageStore(browser.storage.local),
  kv: new SafariKvStore(browser.storage.local),
  readToggles: async () => { const s = await readFullSettings(); return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory }; },
  queue: new WriteQueue(),
});

// Use the async listener form (returns Promise<unknown>) so the channel stays open for
// router replies. When action is 'ignore', resolve undefined (no reply).
browser.runtime.onMessage.addListener((msg: unknown, sender: Runtime.MessageSender): Promise<unknown> => {
  const decision = classifyInbound(msg, sender.id, browser.runtime.id);
  if (decision.action === 'ignore') return Promise.resolve(undefined);
  if (decision.action === 'reject') return Promise.resolve(decision.reply);
  return router(decision.msg)
    .then((reply) => (reply !== SUPPRESS ? reply : undefined))
    .catch((e: unknown) => ({ ok: false, type: decision.msg.type, error: mapError({ kind: 'thrown', error: e }) }));
});
