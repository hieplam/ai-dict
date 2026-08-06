import {
  registerSettingsForm,
  registerOnboarding,
  DEFAULT_OUTPUT_FORMAT,
  buildHistoryExport,
  buildAnkiTsv,
  buildAnkiCsv,
  buildAnkiMarkdown,
  hasKeyFor,
  configuredProvidersFor,
  FIX_KEY_PENDING_STORAGE_KEY,
  deriveShortcutRows,
  type ShortcutStatusRow,
  type Provider,
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
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  promptEnvelope: '',
  hasKey: false,
  configuredProviders: [],
  highlightSavedWords: true,
  apiKey: '',
  cacheEnabled: true,
  saveHistory: true,
  theme: 'sepia',
  provider: 'gemini',
  openaiApiKey: '',
  anthropicApiKey: '',
};

// Where C3's post-activation "Try it on a real page" button sends the user — the public landing
// page's practice section (docs/index.html's #try). Chrome-shell-only constant: the landing page
// URL is a store/build detail, not a portable-core concern, so it is not exported from @ai-dict/app.
const TRY_IT_URL = 'https://hieplam.github.io/ai-dict/#try';

async function load(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Settings };
  // Settings stored before the theme setting existed have no `theme` — DEFAULTS fills it.
  return settings ? { ...DEFAULTS, ...settings } : DEFAULTS;
}

async function send(msg: unknown): Promise<WireReply> {
  const reply: WireReply = await chrome.runtime.sendMessage(msg);
  return reply;
}

// Trigger a client-side file download from the options page (the SW has no DOM).
function download(filename: string, content: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** C9: read the current keyboard-shortcut assignment state and push it into the form. Direct
 * chrome.commands.getAll() call — the options page has its own chrome.* namespace, no SW round
 * trip needed (see the design spec §3.4). */
async function refreshShortcuts(form: SettingsForm): Promise<void> {
  const commands = await chrome.commands.getAll();
  (form as unknown as { shortcuts: ShortcutStatusRow[] }).shortcuts = deriveShortcutRows(commands);
}

// Map full Settings to the form value shape (SettingsFormValue has no hasKey).
function toFormValue(s: Settings): SettingsFormValue {
  return {
    provider: s.provider,
    apiKey: s.apiKey,
    openaiApiKey: s.openaiApiKey,
    anthropicApiKey: s.anthropicApiKey ?? '',
    targetLang: s.targetLang,
    outputFormat: s.outputFormat,
    promptEnvelope: s.promptEnvelope,
    cacheEnabled: s.cacheEnabled,
    saveHistory: s.saveHistory,
    highlightSavedWords: s.highlightSavedWords,
    theme: s.theme,
  };
}

/** Apply a provider + its pasted key onto `cur`, writing into the ONE field that provider owns
 * (apiKey/openaiApiKey/anthropicApiKey) and leaving the other two untouched — the card's "one key
 * activates" scope fence. `Provider`'s exhaustive 3-arm switch is why no `default` is needed. */
function applyProviderKey(
  cur: Settings,
  provider: Provider,
  apiKey: string,
  targetLang: string,
): Settings {
  const base = { ...cur, provider, targetLang };
  switch (provider) {
    case 'gemini':
      return { ...base, apiKey };
    case 'openai':
      return { ...base, openaiApiKey: apiKey };
    case 'anthropic':
      return { ...base, anthropicApiKey: apiKey };
  }
}

// ─── Settings screen (shown once a key exists) ──────────────────────────────────────────────

function mountSettings(initial: Settings, status?: string, opts?: { showTryIt?: boolean }): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  wireSettings(form);
  void refreshShortcuts(form);
  form.addEventListener('open-shortcuts-page', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => undefined);
  });
  // C9: the reader's most likely path back from chrome://extensions/shortcuts is refocusing this
  // tab — re-read on focus so a just-assigned shortcut flips to "Assigned" without a manual reload.
  window.addEventListener('focus', () => void refreshShortcuts(form));
  // C6: consume the one-shot invalid-key deep-link flag, if the reader arrived via the
  // INVALID_KEY card's "Fix key in Settings" button (see router.ts's open-options handler) or the
  // side panel's equivalent direct-storage path.
  void chrome.storage.local.get(FIX_KEY_PENDING_STORAGE_KEY).then((stored) => {
    if (!stored[FIX_KEY_PENDING_STORAGE_KEY]) return;
    void chrome.storage.local.remove(FIX_KEY_PENDING_STORAGE_KEY);
    form.enterFixKeyMode();
  });
  // Error-reporting consent lives in errlog KV (separate from settings). Reflect + control it here.
  void send({ type: 'errlog.status' }).then((r) => {
    if (r.ok && r.type === 'errlog') form.errorReporting = r.consent === 'granted';
  });
  form.addEventListener('error-reporting-change', (e) => {
    const { enabled } = (e as CustomEvent<{ enabled: boolean }>).detail;
    void send({ type: 'errlog.set-consent', state: enabled ? 'granted' : 'disabled' }).then(
      (r) =>
        form.setStatus(
          r.ok
            ? enabled
              ? 'Error reporting enabled'
              : 'Error reporting disabled'
            : 'Could not update error reporting',
          r.ok ? 'ok' : 'error',
        ),
      () => form.setStatus('Could not update error reporting', 'error'),
    );
  });
  if (status) form.setStatus(status);
  if (opts?.showTryIt) {
    form.tryIt = true;
    form.addEventListener('tryit-open', () => {
      void chrome.tabs.create({ url: TRY_IT_URL });
    });
  }
}

function wireSettings(form: SettingsForm): void {
  form.addEventListener('save', (e) => {
    const next = (e as CustomEvent<SettingsFormValue>).detail;
    const shouldRetest = form.consumeAutoRetest();
    const configured: Provider[] = [];
    if (next.apiKey) configured.push('gemini');
    if (next.openaiApiKey) configured.push('openai');
    if (next.anthropicApiKey) configured.push('anthropic');
    void load()
      .then((cur) =>
        chrome.storage.local.set({
          settings: { ...cur, ...next, hasKey: hasKeyFor(next), configuredProviders: configured },
        }),
      )
      .then(
        () => {
          // Re-stamp so the page itself reflects a theme change immediately on save.
          (form as unknown as HTMLElement).setAttribute('data-ad-theme', next.theme);
          if (shouldRetest) {
            // C6: the reader just corrected a rejected key — auto-run the same connection.test
            // round trip the manual "Test connection" button below already uses. See the design
            // spec §4 for why this one, save-triggered call satisfies constraint 4.
            form.setStatus('Testing your updated key…');
            void send({ type: 'connection.test' }).then(
              (r) =>
                r.ok
                  ? form.setStatus('Connection OK — your key is working')
                  : form.setStatus(r.error.message, 'error'),
              () => form.setStatus('Could not reach the service worker', 'error'),
            );
          } else {
            form.setStatus('Settings saved');
          }
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

  wireAnkiExport(form, 'export-anki-tsv', 'tsv');
  wireAnkiExport(form, 'export-anki-csv', 'csv');
  wireAnkiExport(form, 'export-anki-md', 'md');
}

type AnkiFormat = 'tsv' | 'csv' | 'md';

const ANKI_EXPORTERS: Record<
  AnkiFormat,
  {
    build: (entries: Parameters<typeof buildAnkiTsv>[0]) => { filename: string; content: string };
    mime: string;
    label: string;
  }
> = {
  tsv: { build: buildAnkiTsv, mime: 'text/tab-separated-values', label: 'TSV' },
  csv: { build: buildAnkiCsv, mime: 'text/csv', label: 'CSV' },
  md: { build: buildAnkiMarkdown, mime: 'text/markdown', label: 'Markdown' },
};

// B8: shared wiring for all three "export saved words" buttons — saved.list with no payload
// returns every saved word (saved-words-policy.ts's "full list, no pagination" contract).
function wireAnkiExport(form: SettingsForm, eventName: string, format: AnkiFormat): void {
  form.addEventListener(eventName, () => {
    void send({ type: 'saved.list' }).then(
      (r) => {
        if (!r.ok || r.type !== 'saved.list') {
          form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
          return;
        }
        if (r.entries.length === 0) {
          form.setStatus('No saved words to export');
          return;
        }
        const { build, mime, label } = ANKI_EXPORTERS[format];
        const { filename, content } = build(r.entries);
        download(filename, content, mime);
        form.setStatus(`Exported ${r.entries.length} saved words as ${label}`);
      },
      () => form.setStatus('Could not export saved words', 'error'),
    );
  });
}

// ─── Onboarding screen (shown until a key exists) ───────────────────────────────────────────

function mountOnboarding(initial: Settings): void {
  const view = document.createElement('onboarding-view') as unknown as OnboardingView;
  (view as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(view);
  (view as unknown as { value: OnboardingValue }).value = {
    provider: initial.provider ?? 'gemini',
    apiKey: '',
    targetLang: initial.targetLang,
  };
  view.addEventListener('save', (e) => {
    const { provider, apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
    view.setStatus('Testing your key…');
    let cur: Settings;
    void load()
      .then((c) => {
        cur = c;
        // C2: persist optimistically. connection.test always tests whatever key is CURRENTLY
        // in storage (sw.ts's getApiKey reads chrome.storage.local live, on every call) — this
        // is the only way to make the just-pasted, not-yet-stored key reachable to the
        // existing, unmodified connection.test path. See the design spec §2.
        const next = applyProviderKey(c, provider, apiKey, targetLang);
        return chrome.storage.local.set({
          settings: {
            ...next,
            hasKey: hasKeyFor(next),
            configuredProviders: configuredProvidersFor(next, { envGeminiKey: KEY_FROM_ENV }),
          },
        });
      })
      .then(() => send({ type: 'connection.test' }))
      .then(
        (r) => {
          if (r.ok) {
            void load().then((s) =>
              mountSettings(
                s,
                "You're all set. Highlight any word while reading and choose Define to look it up.",
                { showTryIt: true },
              ),
            );
            return;
          }
          // D1: a BILLING failure is itself proof the key is valid (the provider's own
          // 400/429 response required a genuine key to reach that check) — the key is
          // already persisted (optimistic-save above), so there's nothing left to save.
          // Go straight to Settings with the honest status instead of offering a
          // "Save anyway" button that would contradict "your key is already saved".
          if (r.error.code === 'BILLING') {
            void load().then((s) =>
              mountSettings(
                s,
                `${r.error.message} Your key is saved — run Test connection in Settings once billing is set up.`,
              ),
            );
            return;
          }
          // C2: persist only on pass — roll back to the exact pre-onboarding snapshot on any
          // other connection.test failure so a bad/unverified key never lingers silently.
          void chrome.storage.local.set({ settings: cur }).then(() => {
            view.setBusy(false);
            if (r.error.code === 'NETWORK') {
              view.setStatus(
                `${r.error.message} You can save without testing and verify later in Settings.`,
                'error',
              );
              view.showSaveAnyway(true);
            } else {
              view.setStatus(r.error.message, 'error');
            }
          });
        },
        () =>
          void chrome.storage.local.set({ settings: cur }).then(() => {
            view.setBusy(false);
            view.setStatus('Could not reach the extension. Try again.', 'error');
          }),
      );
  });

  // C2: the "Save anyway" escape hatch — a deliberate bypass of verification (NETWORK-class
  // failures only; the view only shows this button after such a failure). Persists directly,
  // no connection.test call, with a status that makes clear the key was NOT verified.
  view.addEventListener('save-anyway', (e) => {
    const { provider, apiKey, targetLang } = (e as CustomEvent<OnboardingValue>).detail;
    void load()
      .then((cur) => {
        const next = applyProviderKey(cur, provider, apiKey, targetLang);
        return chrome.storage.local.set({
          settings: {
            ...next,
            hasKey: hasKeyFor(next),
            configuredProviders: configuredProvidersFor(next, { envGeminiKey: KEY_FROM_ENV }),
          },
        });
      })
      .then(load)
      .then(
        (s) =>
          mountSettings(
            s,
            'Saved without testing — the connection could not be reached. Run Test connection ' +
              'in Settings once you’re back online.',
          ),
        () => {
          view.setBusy(false);
          view.setStatus('Could not save your key. Try again.', 'error');
        },
      );
  });
}

// Route once on load: no usable key → onboarding; otherwise the full settings screen.
void load().then((s) => {
  if (KEY_FROM_ENV || hasKeyFor(s)) mountSettings(s);
  else mountOnboarding(s);
});
