import { buildGa4Request, type TelemetrySink, type ErrorRecord } from '@ai-dict/app';

const K_CLIENT_ID = 'errlog:client-id';

/**
 * Posts error records to GA4 via the Measurement Protocol. Lives in the SW only:
 * the api_secret is baked into the SW bundle and never reaches a content script.
 * No-ops when GA4 is not configured (empty defines) so dev builds are silent.
 */
export class Ga4TelemetrySink implements TelemetrySink {
  constructor(
    private readonly cfg: { measurementId: string; apiSecret: string },
    private readonly area: chrome.storage.StorageArea,
    private readonly fetchFn: typeof fetch = (u, i) => fetch(u, i),
  ) {}

  private async clientId(): Promise<string> {
    const got = (await this.area.get(K_CLIENT_ID)) as Record<string, string>;
    let id = got[K_CLIENT_ID];
    if (!id) {
      id = crypto.randomUUID();
      await this.area.set({ [K_CLIENT_ID]: id });
    }
    return id;
  }

  async send(records: ErrorRecord[]): Promise<void> {
    if (!this.cfg.measurementId || !this.cfg.apiSecret || records.length === 0) return;
    const req = buildGa4Request(records, {
      clientId: await this.clientId(),
      measurementId: this.cfg.measurementId,
      apiSecret: this.cfg.apiSecret,
    });
    try {
      await this.fetchFn(req.url, {
        method: req.method,
        body: req.body,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      });
    } catch {
      /* offline / blocked — drop silently */
    }
  }
}
