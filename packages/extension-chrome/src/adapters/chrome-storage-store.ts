import {
  DEFAULT_OUTPUT_FORMAT,
  hasKeyFor,
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
    apiKey: '',
    cacheEnabled: true,
    saveHistory: true,
    theme: 'light',
    provider: 'gemini',
    openaiApiKey: '',
  };
}

export class ChromeStorageStore implements SettingsStore {
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
      hasKey: hasKeyFor(s ?? {}),
      // Settings stored before the theme setting existed have no `theme` — default light.
      theme: s?.theme ?? 'light',
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
