import {
  registerSettingsForm,
  DEFAULT_TEMPLATE,
  buildHistoryExport,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type WireReply,
} from '@ai-dict/app';
registerSettingsForm();

const form = document.querySelector('settings-form')! as unknown as SettingsForm;
const DEFAULTS: Settings = {
  targetLang: 'vi',
  promptTemplate: DEFAULT_TEMPLATE,
  hasKey: false,
  apiKey: '',
  cacheEnabled: true,
  saveHistory: true,
  theme: 'light',
};

async function load(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  // Settings stored before the theme setting existed have no `theme` — DEFAULTS fills it.
  return settings ? { ...DEFAULTS, ...settings } : DEFAULTS;
}

void load().then((s) => {
  (form as unknown as HTMLElement).setAttribute('theme', s.theme);
  (form as unknown as { value: Settings }).value = s;
});

// Every action below ends in a visible status line so a click is never silent.
async function send(msg: unknown): Promise<WireReply> {
  const reply: WireReply = await browser.runtime.sendMessage(msg);
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
      browser.storage.local.set({ settings: { ...cur, ...next, hasKey: Boolean(next.apiKey) } }),
    )
    .then(
      () => {
        // Re-stamp so the page itself reflects a theme change immediately on save.
        (form as unknown as HTMLElement).setAttribute('theme', next.theme);
        form.setStatus('Settings saved');
      },
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
