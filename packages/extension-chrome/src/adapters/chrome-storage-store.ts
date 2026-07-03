import {
  DEFAULT_OUTPUT_FORMAT,
  hasKeyFor,
  normalizeTheme,
  configuredProvidersFor,
  type SettingsStore,
  type PublicSettings,
  type Settings,
} from '@ai-dict/app';
import type { StorageAreaLike } from './chrome-kv-store';

const DEFAULT_TARGET = 'vi';
function defaults(): Settings {
  return {
    targetLang: DEFAULT_TARGET,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
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

export class ChromeStorageStore implements SettingsStore {
  // envGeminiKey: a build-time Gemini key (Chrome env define) makes Gemini configured
  // even with no stored key — so hasKey and configuredProviders reflect the baked-in key.
  constructor(
    private readonly area: StorageAreaLike,
    private readonly envGeminiKey = false,
  ) {}

  private async read(): Promise<Settings | undefined> {
    const { settings } = (await this.area.get('settings')) as { settings?: Settings };
    return settings;
  }

  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey,
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configuredProvidersFor(s ?? {}, { envGeminiKey: this.envGeminiKey }),
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
