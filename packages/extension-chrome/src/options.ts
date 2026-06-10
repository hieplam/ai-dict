import {
  registerSettingsForm,
  registerOnboarding,
  DEFAULT_TEMPLATE,
  buildHistoryExport,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type OnboardingView,
  type OnboardingValue,
  type WireReply,
} from '@ai-dict/app';
registerSettingsForm();
registerOnboarding();

// Extension pages run under `style-src 'self'` (no inline styles); a constructable stylesheet is
// the CSP-safe way to drop the default body margin so the mounted full-height surface fills the page.
const reset = new CSSStyleSheet();
reset.replaceSync('html,body{margin:0}');
document.adoptedStyleSheets = [...document.adoptedStyleSheets, reset];

const app = document.querySelector('#app')!;

// When the build baked in GEMINI_API_KEY the SW ignores the stored key and the extension works
// with nothing entered — so it counts as set up and onboarding is skipped entirely.
const KEY_FROM_ENV = __GEMINI_KEY_FROM_ENV__;

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

// Map full Settings to the form value shape (SettingsFormValue has no hasKey).
function toFormValue(s: Settings): SettingsFormValue {
  return {
    apiKey: s.apiKey,
    targetLang: s.targetLang,
    promptTemplate: s.promptTemplate,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
  };
}

// ─── Settings screen (shown once a key exists) ──────────────────────────────────────────────

function mountSettings(initial: Settings, status?: string): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  wireSettings(form);
  if (status) form.setStatus(status);
}

function wireSettings(form: SettingsForm): void {
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
}

// ─── Onboarding screen (shown until a key exists) ───────────────────────────────────────────

function mountOnboarding(initial: Settings): void {
  const view = document.createElement('onboarding-view') as unknown as OnboardingView;
  app.replaceChildren(view);
  (view as unknown as { value: OnboardingValue }).value = {
    apiKey: '',
    targetLang: initial.targetLang,
  };
  view.addEventListener('save', (e) => {
    const { apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
    void load()
      .then((cur) =>
        chrome.storage.local.set({
          settings: { ...cur, apiKey, targetLang, hasKey: Boolean(apiKey) },
        }),
      )
      .then(load)
      .then(
        (s) =>
          mountSettings(
            s,
            "You're all set. Highlight any word while reading and choose Define to look it up.",
          ),
        () => view.setStatus('Could not save your key. Try again.', 'error'),
      );
  });
}

// Route once on load: no usable key → onboarding; otherwise the full settings screen.
void load().then((s) => {
  if (KEY_FROM_ENV || Boolean(s.apiKey)) mountSettings(s);
  else mountOnboarding(s);
});
