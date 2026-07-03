import {
  DEFAULT_OUTPUT_FORMAT,
  hasKeyFor,
  normalizeTheme,
  type Provider,
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
    const configured: Provider[] = [];
    if (s?.apiKey) configured.push('gemini');
    if (s?.openaiApiKey) configured.push('openai');
    if (s?.anthropicApiKey) configured.push('anthropic');
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      outputFormat: s?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      hasKey: hasKeyFor(s ?? {}),
      // Coerce: settings stored before the theme setting existed have no `theme`, and
      // pre-Paperlight settings hold the legacy 'light' value → both normalise to 'sepia'.
      theme: normalizeTheme(s?.theme),
      configuredProviders: configured,
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
