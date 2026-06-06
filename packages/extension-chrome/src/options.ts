import {
  registerSettingsForm,
  DEFAULT_TEMPLATE,
  ENV_KEY_NOTICE,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
} from '@ai-dict/app';
registerSettingsForm();

const form = document.querySelector('settings-form')! as unknown as SettingsForm;

// When the extension was built with GEMINI_API_KEY in the env, the SW ignores
// the stored key. Lock the key field (same wording as the banner) so users
// don't think their input is broken, and keep a top banner for prominence.
if (__GEMINI_KEY_FROM_ENV__) {
  form.keyFromEnv = true;
  const notice = document.createElement('p');
  notice.textContent = ENV_KEY_NOTICE;
  notice.style.cssText =
    'margin:8px 12px;padding:8px 12px;border-left:3px solid #1a73e8;background:#e8f0fe;font:14px/1.5 system-ui;color:#202124';
  document.body.insertBefore(notice, document.body.firstChild);
}
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
