import { describe, it, expect, vi } from 'vitest';
import { buildRouter, WriteQueue, SUPPRESS } from '../src/router';
import { fakeStorage } from '@ai-dict/core/test/fakes';
import { historyList, type LookupResult, type WireMessage, type LookupRequest, type PublicSettings } from '@ai-dict/core';

const result: LookupResult = { markdown: '#', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 7 };
const req = { word: 'bank', context: 'river bank', url: '', title: '', target: 'vi', promptTemplate: 'tpl' };
const lookupMsg = (requestId: string): WireMessage => ({ type: 'lookup', req, requestId });

type LookupFn = (req: LookupRequest, opts?: { signal?: AbortSignal }) => Promise<LookupResult>;
type LookupMock = ReturnType<typeof vi.fn<LookupFn>>;

function makeLookupMock(impl: LookupFn = async () => result): LookupMock {
  return vi.fn<LookupFn>(impl);
}

interface DepsOverrides {
  client?: { lookup: LookupMock };
  readToggles?: () => Promise<{ cacheEnabled: boolean; saveHistory: boolean }>;
}

function deps(over: DepsOverrides = {}) {
  const kv = fakeStorage();
  const lookupFn = over.client?.lookup ?? makeLookupMock();
  const getFn = vi.fn<() => Promise<PublicSettings>>(async () => ({ targetLang: 'vi', promptTemplate: 'tpl', hasKey: true }));
  return {
    kv,
    client: { lookup: lookupFn },
    settings: { get: getFn, set: vi.fn<(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>) => Promise<void>>() },
    readToggles: over.readToggles ?? vi.fn(async () => ({ cacheEnabled: true, saveHistory: true })),
    queue: new WriteQueue(),
  };
}

describe('buildRouter', () => {
  it('lookup miss → calls client, caches, appends history, replies result (D1)', async () => {
    const d = deps();
    const route = buildRouter(d);
    const reply = await route(lookupMsg('a'));
    expect(reply).toMatchObject({ ok: true, type: 'lookup', result, requestId: 'a' });
    expect(d.client.lookup).toHaveBeenCalledTimes(1);
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(1);
  });

  it('lookup cache hit → fromCache:true, no client call (D1)', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a'));               // populate cache
    d.client.lookup.mockClear();
    const reply = await route(lookupMsg('b'));  // same req → hit
    expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: true } });
    expect(d.client.lookup).not.toHaveBeenCalled();
  });

  it('honours toggles: cacheEnabled=false + saveHistory=false skips both stores', async () => {
    const d = deps({ readToggles: async () => ({ cacheEnabled: false, saveHistory: false }) });
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    await route(lookupMsg('b'));
    expect(d.client.lookup).toHaveBeenCalledTimes(2);               // no cache → always fetch
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(0);
  });

  it('lookup rejection (LookupError) → error reply (D1)', async () => {
    const d = deps({ client: { lookup: makeLookupMock(async () => { throw Object.assign(new Error('x'), { code: 'NETWORK', message: 'x', retryable: true }); }) } });
    const reply = await buildRouter(d)(lookupMsg('a'));
    expect(reply).toMatchObject({ ok: false, type: 'lookup', error: { code: 'NETWORK' }, requestId: 'a' });
  });

  it('cancellation suppresses the aborted lookup reply (D5)', async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const d = deps({
      client: { lookup: makeLookupMock((_req, opts) => {
        started();                                  // fires after handleLookup's inflight.set, just before await
        return new Promise((_res, rej) => {
          opts?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        });
      }) },
    });
    const route = buildRouter(d);
    const p = route(lookupMsg('a'));
    await startedP;                                  // deterministic: guarantees 'a' is registered in inflight
    const ack = await route({ type: 'lookup.cancel', requestId: 'a' });
    expect(ack).toMatchObject({ ok: true, type: 'ack' });
    expect(await p).toBe(SUPPRESS);
  });

  it('serializes concurrent index writes — no lost history update (D6)', async () => {
    const d = deps();
    const route = buildRouter(d);
    await Promise.all([route(lookupMsg('a')), route(lookupMsg('b'))]);
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(2);
  });

  it('WriteQueue serializes RMW (raw concurrent append loses an entry — documents WHY the queue exists)', async () => {
    const { historyAppend } = await import('@ai-dict/core');
    const s = fakeStorage();
    const e = (id: string) => ({ id, word: id, context: '', result, createdAt: Number(id) });
    await Promise.all([historyAppend({ storage: s }, e('1')), historyAppend({ storage: s }, e('2'))]); // no queue
    expect((await historyList({ storage: s }, {})).entries).toHaveLength(1); // lost update
  });

  it('settings.get → PublicSettings reply (key already stripped upstream)', async () => {
    const reply = await buildRouter(deps())({ type: 'settings.get' });
    expect(reply).toEqual({ ok: true, type: 'settings', settings: { targetLang: 'vi', promptTemplate: 'tpl', hasKey: true } });
  });

  it('history.list / history.clear / cache.clear', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    expect(await route({ type: 'history.list' })).toMatchObject({ ok: true, type: 'history' });
    expect(await route({ type: 'history.clear' })).toMatchObject({ ok: true, type: 'ack' });
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(0);
    expect(await route({ type: 'cache.clear' })).toMatchObject({ ok: true, type: 'ack' });
  });
});
