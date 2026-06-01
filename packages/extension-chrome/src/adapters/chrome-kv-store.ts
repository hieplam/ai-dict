import type { Storage } from '@ai-dict/core';

// Minimal surface of chrome.storage.StorageArea needed by this adapter.
// Using a custom interface instead of Pick<chrome.storage.StorageArea, ...>
// so that hand-rolled test fakes can satisfy it without the overloaded chrome types.
export interface StorageAreaLike {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

// Thin Storage over chrome.storage.local. NO adapter-side prefix: core's cache-/history-policy
// own the `cache:` / `history:` namespaces themselves (§02), so a single instance backs both.
export class ChromeKvStore implements Storage {
  constructor(private readonly area: StorageAreaLike) {}

  async getItem(key: string): Promise<string | null> {
    const got = await this.area.get(key);
    return (got[key] as string | undefined) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }
  async removeItem(key: string): Promise<void> {
    await this.area.remove(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = await this.area.get(null);
    const ks = Object.keys(all);
    return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks;
  }
}
