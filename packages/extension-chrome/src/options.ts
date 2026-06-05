import {
  registerSettingsForm,
  DEFAULT_TEMPLATE,
  type Settings,
  type SettingsFormValue,
} from '@ai-dict/app';
registerSettingsForm();

const form = document.querySelector('settings-form')!;
const DEFAULTS: Settings = {
  targetLang: 'vi',
  promptTemplate: DEFAULT_TEMPLATE,
  hasKey: false,
  apiKey: '',
  cacheEnabled: true,
  saveHistory: true,
};

async function load(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? DEFAULTS;
}

// Map full Settings to the form value shape (SettingsFormValue has no hasKey)
function toFormValue(s: Settings): SettingsFormValue {
  return {
    apiKey: s.apiKey,
    targetLang: s.targetLang,
    promptTemplate: s.promptTemplate,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
  };
}

void load().then((s) => {
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(s);
});

form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<SettingsFormValue>).detail;
  void load().then((cur) =>
    chrome.storage.local.set({ settings: { ...cur, ...next, hasKey: Boolean(next.apiKey) } }),
  );
});
form.addEventListener('clear-cache', () => {
  void chrome.runtime.sendMessage({ type: 'cache.clear' });
});
form.addEventListener('clear-history', () => {
  void chrome.runtime.sendMessage({ type: 'history.clear' });
});
form.addEventListener('test-connection', () => {
  void chrome.runtime.sendMessage({ type: 'connection.test' });
});
