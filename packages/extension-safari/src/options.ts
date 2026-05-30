import '@ai-dict/shared-ui/settings-form';
import { DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';

const form = document.querySelector('settings-form')!;
const DEFAULTS: Settings = { targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };

async function load(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? DEFAULTS;
}

void load().then((s) => { (form as unknown as { value: Settings }).value = s; });

form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<Partial<Settings>>).detail;
  void load().then((cur) => browser.storage.local.set({ settings: { ...cur, ...next } }));
});
form.addEventListener('clear-cache', () => { void browser.runtime.sendMessage({ type: 'cache.clear' }); });
form.addEventListener('clear-history', () => { void browser.runtime.sendMessage({ type: 'history.clear' }); });
form.addEventListener('test-connection', () => { void browser.runtime.sendMessage({ type: 'connection.test' }); });
