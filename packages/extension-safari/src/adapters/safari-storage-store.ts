import {
  DEFAULT_OUTPUT_FORMAT,
  hasKeyFor,
  normalizeTheme,
  configuredProvidersFor,
  resolvePromptEnvelope,
  type SettingsStore,
  type PublicSettings,
  type Settings,
} from '@ai-dict/app';
import type { StorageAreaLike } from './safari-kv-store';

const DEFAULT_TARGET = 'vi';
function defaults(): Settings {
  return {
    targetLang: DEFAULT_TARGET,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    promptEnvelope: '',
    hasKey: false,
    configuredProviders: [],
    apiKey: '',
    cacheEnabled: true,
    saveHistory: true,
    theme: 'sepia',
    provider: 'gemini',
    openaiApiKey: '',
    anthropicApiKey: '',
  };
}

export class SafariStorageStore implements SettingsStore {
  constructor(private readonly area: StorageAreaLike) {}

  private async read(): Promise<Settings | undefined> {
    const { settings } = (await this.area.get('settings')) as { settings?: Settings };
    return settings;
  }

  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      // Read-time legacy resolution: a stored custom `promptTemplate` (pre-#63) becomes the
      // envelope override; a shipped default or absent value → '' (built-in). No write migration.
      // (A legacy stored object still carries `promptTemplate` at runtime even though `Settings`
      // no longer declares it — `resolvePromptEnvelope` reads it structurally.)
      promptEnvelope: resolvePromptEnvelope(s ?? {}),
      hasKey: hasKeyFor(s ?? {}),
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}),
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
