import { DEFAULT_TEMPLATE, type SettingsStore, type PublicSettings, type Settings } from '@ai-dict/core';
import type { StorageAreaLike } from './safari-kv-store';

const DEFAULT_TARGET = 'vi';
function defaults(): Settings {
  return { targetLang: DEFAULT_TARGET, promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };
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
      promptTemplate: s?.promptTemplate ?? DEFAULT_TEMPLATE,
      hasKey: Boolean(s?.apiKey),
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
