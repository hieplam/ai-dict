import { describe, it, expect, vi } from 'vitest';
import { Ga4TelemetrySink } from './ga4-telemetry-sink';
import type { ErrorRecord } from '@ai-dict/app';

const K_CLIENT_ID = 'errlog:client-id';

function fakeArea(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: vi.fn((key: string | null) => {
      if (key === null) return Promise.resolve(Object.fromEntries(store));
      return Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {});
    }),
    set: vi.fn((obj: Record<string, string>) => {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
      return Promise.resolve();
    }),
    _store: store,
  } as unknown as chrome.storage.StorageArea & { _store: Map<string, string> };
}

const rec: ErrorRecord = {
  ts: 1000,
  source: 'lookup',
  code: 'NETWORK',
  provider: 'gemini',
  message: 'Gemini server error. Retry.',
  retryable: true,
  httpStatus: 503,
  vendorStatus: 'UNAVAILABLE',
  extVersion: '1.6.0',
  browserVersion: 'Chrome/126',
};

const CFG = { measurementId: 'G-XXX', apiSecret: 'sek' };

describe('Ga4TelemetrySink', () => {
  it('no-ops (no fetch) when GA4 is not configured', async () => {
    const fetchFn = vi.fn();
    await new Ga4TelemetrySink({ measurementId: '', apiSecret: '' }, fakeArea(), fetchFn).send([
      rec,
    ]);
    await new Ga4TelemetrySink({ measurementId: 'G', apiSecret: '' }, fakeArea(), fetchFn).send([
      rec,
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no-ops on an empty batch', async () => {
    const fetchFn = vi.fn();
    await new Ga4TelemetrySink(CFG, fakeArea(), fetchFn).send([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // url/body are always strings here (the sink builds them from buildGa4Request); the cast
  // narrows the fetch signature's RequestInfo/BodyInit unions for the assertions below.
  const bodyOf = (
    init: RequestInit | undefined,
  ): { client_id: string; events: { name: string }[] } =>
    JSON.parse(init?.body as string) as { client_id: string; events: { name: string }[] };

  it('POSTs the GA4 Measurement Protocol request when configured', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 204 })));
    await new Ga4TelemetrySink(CFG, fakeArea(), fetchFn).send([rec]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url as string).toContain('https://www.google-analytics.com/mp/collect');
    expect(url as string).toContain('measurement_id=G-XXX');
    expect(url as string).toContain('api_secret=sek');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    const body = bodyOf(init);
    expect(body.client_id).toBeTruthy();
    expect(body.events[0]!.name).toBe('extension_error');
  });

  it('generates a client_id once, persists it, and reuses it across sends', async () => {
    const area = fakeArea();
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 204 })));
    const sink = new Ga4TelemetrySink(CFG, area, fetchFn);

    await sink.send([rec]);
    const persisted = area._store.get(K_CLIENT_ID);
    expect(persisted).toBeTruthy();

    await sink.send([rec]);
    const idsSent = fetchFn.mock.calls.map(([, init]) => bodyOf(init).client_id);
    expect(idsSent[0]).toBe(persisted);
    expect(idsSent[1]).toBe(persisted); // stable per install
  });

  it('swallows a fetch rejection (offline / blocked) without throwing', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new Error('network down')));
    await expect(
      new Ga4TelemetrySink(CFG, fakeArea(), fetchFn).send([rec]),
    ).resolves.toBeUndefined();
  });
});
