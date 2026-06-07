import {
  registerSettingsForm,
  DEFAULT_TEMPLATE,
  ENV_KEY_NOTICE,
  buildHistoryExport,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type WireReply,
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

// Every action below ends in a visible status line so a click is never silent.
async function send(msg: unknown): Promise<WireReply> {
  const reply: WireReply = await chrome.runtime.sendMessage(msg);
  return reply;
}

// Trigger a client-side file download from the options page (the SW has no DOM).
function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<SettingsFormValue>).detail;
  void load()
    .then((cur) =>
      chrome.storage.local.set({ settings: { ...cur, ...next, hasKey: Boolean(next.apiKey) } }),
    )
    .then(
      () => form.setStatus('Settings saved'),
      () => form.setStatus('Could not save settings', 'error'),
    );
});

form.addEventListener('clear-cache', () => {
  void send({ type: 'cache.clear' }).then(
    (r) => (r.ok ? form.setStatus('Cache cleared') : form.setStatus(r.error.message, 'error')),
    () => form.setStatus('Could not clear cache', 'error'),
  );
});

form.addEventListener('clear-history', () => {
  void send({ type: 'history.clear' }).then(
    (r) => (r.ok ? form.setStatus('History cleared') : form.setStatus(r.error.message, 'error')),
    () => form.setStatus('Could not clear history', 'error'),
  );
});

form.addEventListener('test-connection', () => {
  form.setStatus('Testing connection…');
  void send({ type: 'connection.test' }).then(
    (r) => (r.ok ? form.setStatus('Connection OK') : form.setStatus(r.error.message, 'error')),
    () => form.setStatus('Could not reach the service worker', 'error'),
  );
});

form.addEventListener('export-history', () => {
  // history.list with no limit returns every entry (history-policy default).
  void send({ type: 'history.list' }).then(
    (r) => {
      if (!r.ok || r.type !== 'history') {
        form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
        return;
      }
      if (r.entries.length === 0) {
        form.setStatus('No history to export');
        return;
      }
      const { filename, json } = buildHistoryExport(r.entries);
      download(filename, json);
      form.setStatus(`Exported ${r.entries.length} entries`);
    },
    () => form.setStatus('Could not export history', 'error'),
  );
});
