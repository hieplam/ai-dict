import type { Storage } from '@ai-dict/core';
import type { Browser } from 'webextension-polyfill';

type StorageAreaLike = Pick<Browser.Storage.StorageArea, 'get' | 'set' | 'remove'>;

// Thin Storage over browser.storage.local. NO adapter-side prefix: core's cache-/history-policy
// own the `cache:` / `history:` namespaces themselves (§02), so a single instance backs both.
export class SafariKvStore implements Storage {
  constructor(private readonly area: StorageAreaLike) {}

  async getItem(key: string): Promise<string | null> {
    const got = (await this.area.get(key)) as Record<string, string | undefined>;
    return got[key] ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }
  async removeItem(key: string): Promise<void> {
    await this.area.remove(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = (await this.area.get(null)) as Record<string, unknown>;
    const ks = Object.keys(all);
    return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks;
  }
}
