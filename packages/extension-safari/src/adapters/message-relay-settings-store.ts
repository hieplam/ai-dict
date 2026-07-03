import type { SettingsStore, PublicSettings, WireReply, RuntimeLike } from '@ai-dict/app';

export class MessageRelaySettingsStore implements SettingsStore {
  private cache: PublicSettings | null = null;

  constructor(
    private readonly runtime: RuntimeLike,
    subscribe: (invalidate: () => void) => void,
  ) {
    subscribe(() => {
      this.cache = null;
    });
  }

  async get(): Promise<PublicSettings> {
    if (this.cache) return this.cache;
    const reply = (await this.runtime.sendMessage({ type: 'settings.get' })) as WireReply;
    if (reply.ok && reply.type === 'settings') {
      // Cache ONLY the known PublicSettings fields — never the raw reply object.
      // This guarantees the content side never retains an unexpected field (e.g. a
      // stray apiKey) regardless of what the SW sends over the wire.
      const stripped: PublicSettings = {
        targetLang: reply.settings.targetLang,
        outputFormat: reply.settings.outputFormat,
        hasKey: reply.settings.hasKey,
        theme: reply.settings.theme,
        configuredProviders: reply.settings.configuredProviders,
      };
      this.cache = stripped;
      return stripped;
    }
    throw new Error('settings.get failed');
  }

  // The content side MUST NOT write settings over the wire. Settings are edited on the options page.
  // Param is intentionally ignored — method exists only to satisfy the SettingsStore interface.
  set(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _patch: Partial<Pick<import('@ai-dict/app').PublicSettings, 'targetLang' | 'outputFormat'>>,
  ): Promise<void> {
    return Promise.reject(
      new Error('Settings are edited on the options page, not over the content wire.'),
    );
  }
}
