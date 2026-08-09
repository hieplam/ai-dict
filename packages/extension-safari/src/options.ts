import {
  registerSettingsForm,
  DEFAULT_OUTPUT_FORMAT,
  buildHistoryExport,
  buildAnkiTsv,
  buildAnkiCsv,
  buildAnkiMarkdown,
  hasKeyFor,
  buildBackupExport,
  parseBackupFile,
  type Settings,
  type SettingsForm,
  type SettingsFormValue,
  type WireReply,
  type BackupImportRequest,
  type SavedWordEntry,
  type HistoryEntry,
  type Theme,
} from '@ai-dict/app';
registerSettingsForm();

const form = document.querySelector('settings-form')! as unknown as SettingsForm;
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
  glossMode: false,
};

async function load(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  // Settings stored before the theme setting existed have no `theme` — DEFAULTS fills it.
  return settings ? { ...DEFAULTS, ...settings } : DEFAULTS;
}

void load().then((s) => {
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', s.theme);
  (form as unknown as { value: Settings }).value = s;
});

// Every action below ends in a visible status line so a click is never silent.
async function send(msg: unknown): Promise<WireReply> {
  const reply: WireReply = await browser.runtime.sendMessage(msg);
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
function wireAnkiExport(eventName: string, format: AnkiFormat): void {
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

form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<SettingsFormValue>).detail;
  void load()
    .then((cur) =>
      browser.storage.local.set({ settings: { ...cur, ...next, hasKey: hasKeyFor(next) } }),
    )
    .then(
      () => {
        // Re-stamp so the page itself reflects a theme change immediately on save.
        (form as unknown as HTMLElement).setAttribute('data-ad-theme', next.theme);
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

form.addEventListener('backup-export', () => {
  void Promise.all([send({ type: 'saved.list' }), send({ type: 'history.list' }), load()]).then(
    ([savedReply, historyReply, settings]) => {
      if (!savedReply.ok || savedReply.type !== 'saved.list') {
        form.setStatus(savedReply.ok ? 'Unexpected reply' : savedReply.error.message, 'error');
        return;
      }
      if (!historyReply.ok || historyReply.type !== 'history') {
        form.setStatus(historyReply.ok ? 'Unexpected reply' : historyReply.error.message, 'error');
        return;
      }
      const { filename, json } = buildBackupExport(
        savedReply.entries,
        historyReply.entries,
        settings,
        () => Date.now(),
      );
      download(filename, json);
      form.setStatus(
        `Exported ${savedReply.entries.length} saved words and ${historyReply.entries.length} history entries`,
      );
    },
    () => form.setStatus('Could not export backup', 'error'),
  );
});

form.addEventListener('backup-import', (e) => {
  const { mode, file } = (e as CustomEvent<BackupImportRequest>).detail;
  void file
    .text()
    .then((text) => {
      const parsed = parseBackupFile(text);
      if (!parsed.ok) {
        form.setStatus(parsed.error, 'error');
        return;
      }
      form.setStatus('Importing…');
      void send({
        type: 'backup.import',
        mode,
        savedWords: parsed.savedWords as SavedWordEntry[],
        history: parsed.history as HistoryEntry[],
      }).then(
        (r) => {
          if (!r.ok || r.type !== 'backup-imported') {
            form.setStatus(r.ok ? 'Unexpected reply' : r.error.message, 'error');
            return;
          }
          const s = parsed.settings;
          void load()
            .then((cur) =>
              browser.storage.local.set({
                settings: {
                  ...cur,
                  ...(s.targetLang !== undefined ? { targetLang: s.targetLang } : {}),
                  ...(s.outputFormat !== undefined ? { outputFormat: s.outputFormat } : {}),
                  ...(s.promptEnvelope !== undefined ? { promptEnvelope: s.promptEnvelope } : {}),
                  ...(s.theme !== undefined ? { theme: s.theme as Theme } : {}),
                  ...(s.cacheEnabled !== undefined ? { cacheEnabled: s.cacheEnabled } : {}),
                  ...(s.saveHistory !== undefined ? { saveHistory: s.saveHistory } : {}),
                  ...(s.provider !== undefined ? { provider: s.provider } : {}),
                },
              }),
            )
            .then(load)
            .then((fresh) => {
              (form as unknown as HTMLElement).setAttribute('data-ad-theme', fresh.theme);
              (form as unknown as { value: Settings }).value = fresh;
              form.setStatus(
                `Imported ${r.savedWordsImported} saved words and ${r.historyImported} history entries`,
              );
            });
        },
        () => form.setStatus('Could not import backup', 'error'),
      );
    })
    .catch(() => form.setStatus('Could not read the selected file', 'error'));
});

wireAnkiExport('export-anki-tsv', 'tsv');
wireAnkiExport('export-anki-csv', 'csv');
wireAnkiExport('export-anki-md', 'md');
