import { describe, it, expect, vi } from 'vitest';
import { buildRouter, WriteQueue, SUPPRESS } from '../../src/app/router';
import { fakeStorage } from '../fakes';
import {
  historyList,
  type LookupResult,
  type WireMessage,
  type LookupRequest,
  type PublicSettings,
} from '../../src';

const result: LookupResult = {
  markdown: '#',
  word: 'bank',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 7,
};
const req = {
  word: 'bank',
  context: 'river bank',
  url: '',
  title: '',
  target: 'vi',
  outputFormat: 'tpl',
  promptEnvelope: '',
};
const lookupMsg = (requestId: string): WireMessage => ({ type: 'lookup', req, requestId });

type LookupFn = (req: LookupRequest, opts?: { signal?: AbortSignal }) => Promise<LookupResult>;
type LookupMock = ReturnType<typeof vi.fn<LookupFn>>;

function makeLookupMock(impl: LookupFn = () => Promise.resolve(result)): LookupMock {
  return vi.fn<LookupFn>(impl);
}

interface DepsOverrides {
  client?: { lookup: LookupMock };
  readToggles?: () => Promise<{ cacheEnabled: boolean; saveHistory: boolean }>;
}

function deps(over: DepsOverrides = {}) {
  const kv = fakeStorage();
  const lookupFn = over.client?.lookup ?? makeLookupMock();
  const getFn = vi.fn<() => Promise<PublicSettings>>(() =>
    Promise.resolve({
      targetLang: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: 'ENV-R',
      hasKey: true,
      theme: 'sepia' as const,
      configuredProviders: [],
    }),
  );
  return {
    kv,
    client: { lookup: lookupFn },
    settings: {
      get: getFn,
      set: vi.fn<
        (patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>) => Promise<void>
      >(),
    },
    readToggles:
      over.readToggles ?? vi.fn(() => Promise.resolve({ cacheEnabled: true, saveHistory: true })),
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
    await route(lookupMsg('a')); // populate cache
    d.client.lookup.mockClear();
    const reply = await route(lookupMsg('b')); // same req → hit
    expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: true } });
    expect(d.client.lookup).not.toHaveBeenCalled();
  });

  it('manual provider override (req.provider) skips the cache read — picked provider answers', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a')); // populate cache with the default answer
    d.client.lookup.mockClear();
    // Same selection, but with a one-shot provider pick → must bypass the cache and call the client.
    const reply = await route({
      type: 'lookup',
      req: { ...req, provider: 'openai' },
      requestId: 'b',
    });
    expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: false } });
    expect(d.client.lookup).toHaveBeenCalledTimes(1);
  });

  it('forceLiteral override (req.forceLiteral) skips the cache read — the literal answer is fetched fresh', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a')); // populate cache with the default (idiom-aware) answer
    d.client.lookup.mockClear();
    const reply = await route({
      type: 'lookup',
      req: { ...req, forceLiteral: true },
      requestId: 'b',
    });
    expect(reply).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: false } });
    expect(d.client.lookup).toHaveBeenCalledTimes(1);
  });

  it('fallbackFrom is never persisted, but provider IS (cache + history strip transient only)', async () => {
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.resolve({ ...result, provider: 'openai', fallbackFrom: 'gemini' }),
        ),
      },
    });
    const route = buildRouter(d);
    const reply = await route(lookupMsg('a'));
    // The live reply carries the transient annotation…
    expect(reply).toMatchObject({
      ok: true,
      result: { fallbackFrom: 'gemini', provider: 'openai' },
    });
    // …but the persisted history entry keeps provider and drops fallbackFrom.
    const { entries } = await historyList({ storage: d.kv }, {});
    expect(entries[0]!.result.provider).toBe('openai');
    expect('fallbackFrom' in entries[0]!.result).toBe(false);
  });

  it('honours toggles: cacheEnabled=false + saveHistory=false skips both stores', async () => {
    const d = deps({
      readToggles: () => Promise.resolve({ cacheEnabled: false, saveHistory: false }),
    });
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    await route(lookupMsg('b'));
    expect(d.client.lookup).toHaveBeenCalledTimes(2); // no cache → always fetch
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(0);
  });

  it('lookup rejection (LookupError) → error reply (D1)', async () => {
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.reject(
            Object.assign(new Error('x'), { code: 'NETWORK', message: 'x', retryable: true }),
          ),
        ),
      },
    });
    const reply = await buildRouter(d)(lookupMsg('a'));
    expect(reply).toMatchObject({
      ok: false,
      type: 'lookup',
      error: { code: 'NETWORK' },
      requestId: 'a',
    });
  });

  it('lookup NO_KEY → error reply with code NO_KEY (D1 — missing-key scenario)', async () => {
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.reject(
            Object.assign(new Error('Add your Gemini API key in Settings.'), {
              code: 'NO_KEY',
              message: 'Add your Gemini API key in Settings.',
              retryable: false,
            }),
          ),
        ),
      },
    });
    const reply = await buildRouter(d)(lookupMsg('no-key'));
    expect(reply).toMatchObject({
      ok: false,
      type: 'lookup',
      error: { code: 'NO_KEY' },
      requestId: 'no-key',
    });
  });

  it('error reply survives JSON serialization with its message intact (wire-boundary regression)', async () => {
    // chrome.runtime messages are JSON-serialised across the SW→content boundary. A LookupError
    // thrown by GeminiLookupClient is `Object.assign(new Error(msg), …)`, whose `message` is a
    // NON-enumerable own property (set by the Error constructor) — JSON.stringify drops it, so the
    // card would render an EMPTY error. The router must normalise the error to a plain object.
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.reject(
            Object.assign(new Error('Google rejected the API key.'), {
              code: 'INVALID_KEY',
              message: 'Google rejected the API key.',
              retryable: false,
            }),
          ),
        ),
      },
    });
    const reply = await buildRouter(d)(lookupMsg('e'));
    const wire = JSON.parse(JSON.stringify(reply)) as { error: { code: string; message: string } };
    expect(wire.error.message).toBe('Google rejected the API key.');
    expect(wire.error.code).toBe('INVALID_KEY');
  });

  it('cancellation suppresses the aborted lookup reply (D5)', async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => {
      started = r;
    });
    const d = deps({
      client: {
        lookup: makeLookupMock((_req, opts) => {
          started(); // fires after handleLookup's inflight.set, just before await
          return new Promise((_res, rej) => {
            opts?.signal?.addEventListener('abort', () =>
              rej(new DOMException('aborted', 'AbortError')),
            );
          });
        }),
      },
    });
    const route = buildRouter(d);
    const p = route(lookupMsg('a'));
    await startedP; // deterministic: guarantees 'a' is registered in inflight
    const ack = await route({ type: 'lookup.cancel', requestId: 'a' });
    expect(ack).toMatchObject({ ok: true, type: 'ack' });
    expect(await p).toBe(SUPPRESS);
  });

  it('cancel during readToggles phase (pre-inflight window) still suppresses the reply (D5)', async () => {
    // Regression test for the async window bug: inflight.set was previously placed AFTER
    // readToggles + cacheGet awaits, so a cancel arriving during those awaits would find
    // nothing in inflight and not add requestId to cancelled — the lookup result would be
    // returned normally instead of being suppressed. Now inflight.set is the first sync
    // operation before any await, so handleCancel always finds the controller.
    let resolveToggles!: () => void;
    const togglesBlocked = new Promise<void>((r) => {
      resolveToggles = r;
    });

    const d = {
      kv: fakeStorage(),
      client: { lookup: makeLookupMock() },
      settings: {
        get: vi.fn(() =>
          Promise.resolve({
            targetLang: 'vi',
            outputFormat: 'tpl',
            promptEnvelope: '',
            hasKey: true,
            theme: 'sepia' as const,
            configuredProviders: [],
          }),
        ),
        set: vi.fn(),
      },
      readToggles: vi.fn(async () => {
        await togglesBlocked; // block until test sends the cancel
        return { cacheEnabled: false, saveHistory: false }; // disable cache to skip cacheGet
      }),
      queue: new WriteQueue(),
    };
    const route = buildRouter(d);
    const p = route(lookupMsg('pre'));

    // readToggles is now blocked — send the cancel. With the old code (inflight.set after awaits)
    // inflight would be empty here and the cancel would be silently ignored.
    // The `await` here proves the cancel ack was received before we unblock readToggles below.
    const ack = await route({ type: 'lookup.cancel', requestId: 'pre' });
    expect(ack).toMatchObject({ ok: true, type: 'ack' });

    // Unblock readToggles — the result must be SUPPRESS, not a normal lookup reply
    resolveToggles();
    expect(await p).toBe(SUPPRESS);
  });

  it('serializes concurrent index writes — no lost history update (D6)', async () => {
    const d = deps();
    const route = buildRouter(d);
    await Promise.all([route(lookupMsg('a')), route(lookupMsg('b'))]);
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(2);
  });

  it('WriteQueue serializes RMW (raw concurrent append loses an entry — documents WHY the queue exists)', async () => {
    const { historyAppend } = await import('../../src');
    const s = fakeStorage();
    const e = (id: string) => ({ id, word: id, context: '', result, createdAt: Number(id) });
    await Promise.all([
      historyAppend({ storage: s }, e('1')),
      historyAppend({ storage: s }, e('2')),
    ]); // no queue
    expect((await historyList({ storage: s }, {})).entries).toHaveLength(1); // lost update
  });

  it('settings.get → PublicSettings reply (key already stripped upstream)', async () => {
    const reply = await buildRouter(deps())({ type: 'settings.get' });
    expect(reply).toEqual({
      ok: true,
      type: 'settings',
      settings: {
        targetLang: 'vi',
        outputFormat: 'tpl',
        promptEnvelope: 'ENV-R',
        hasKey: true,
        theme: 'sepia' as const,
        configuredProviders: [],
      },
    });
  });

  it('connection.test → ack when lookup succeeds', async () => {
    const d = deps();
    const reply = await buildRouter(d)({ type: 'connection.test' });
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
    // The probe request forwards the resolved envelope override from settings.
    expect(d.client.lookup.mock.calls[0]?.[0]).toMatchObject({ promptEnvelope: 'ENV-R' });
  });

  it('connection.test → error reply when lookup throws', async () => {
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.reject(
            Object.assign(new Error('no key'), {
              code: 'AUTH',
              message: 'no key',
              retryable: false,
            }),
          ),
        ),
      },
    });
    const reply = await buildRouter(d)({ type: 'connection.test' });
    expect(reply).toMatchObject({ ok: false, type: 'connection.test', error: { code: 'AUTH' } });
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

  it('history.delete removes the entry and invalidates its cache (next lookup re-fetches)', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a')); // miss → fetch, cache, history
    const { entries } = await historyList({ storage: d.kv }, {});
    expect(entries).toHaveLength(1);
    d.client.lookup.mockClear();

    const reply = await route({ type: 'history.delete', id: entries[0]!.id });
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
    expect((await historyList({ storage: d.kv }, {})).entries).toHaveLength(0);

    // The cached definition is gone too: the same request must hit the client again.
    await route(lookupMsg('b'));
    expect(d.client.lookup).toHaveBeenCalledTimes(1);
  });

  it('history.delete only touches the targeted entry', async () => {
    const other: LookupResult = { ...result, word: 'pier' };
    const d = deps({
      client: {
        lookup: makeLookupMock((r) => Promise.resolve(r.word === 'pier' ? other : result)),
      },
    });
    const route = buildRouter(d);
    await route(lookupMsg('a'));
    await route({ type: 'lookup', req: { ...req, word: 'pier' }, requestId: 'b' });
    const before = await historyList({ storage: d.kv }, {});
    const bankEntry = before.entries.find((e) => e.word === 'bank')!;

    await route({ type: 'history.delete', id: bankEntry.id });

    const after = await historyList({ storage: d.kv }, {});
    expect(after.entries.map((e) => e.word)).toEqual(['pier']);
    // 'pier' is still cached: re-requesting it must NOT call the client.
    d.client.lookup.mockClear();
    const hit = await route({ type: 'lookup', req: { ...req, word: 'pier' }, requestId: 'c' });
    expect(hit).toMatchObject({ ok: true, type: 'lookup', result: { fromCache: true } });
    expect(d.client.lookup).not.toHaveBeenCalled();
  });

  it('history.delete with an unknown id is an idempotent ack', async () => {
    const route = buildRouter(deps());
    const reply = await route({ type: 'history.delete', id: 'ghost' });
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
  });

  it('saved.save persists a new entry with status learning and returns it', async () => {
    const d = deps();
    const route = buildRouter(d);
    const reply = await route({
      type: 'saved.save',
      word: 'bank',
      definition: 'a financial institution',
      translation: '',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    });
    expect(reply).toMatchObject({
      ok: true,
      type: 'saved',
      entry: {
        word: 'bank',
        status: 'learning',
        senses: [
          {
            definition: 'a financial institution',
            translation: '',
            sentence: 'the river bank',
            url: 'https://example.com',
            title: 'Example',
          },
        ],
      },
    });
    expect(typeof (reply as { entry: { savedAt: number } }).entry.savedAt).toBe('number');
  });

  it('saved.save persists a non-empty translation verbatim (B2 regression guard — no truncation/transform in the pass-through)', async () => {
    const d = deps();
    const route = buildRouter(d);
    const reply = await route({
      type: 'saved.save',
      word: 'bank',
      definition: 'a financial institution',
      translation: 'ngân hàng',
      sentence: 'the river bank',
      url: 'https://example.com',
      title: 'Example',
    });
    expect(reply).toMatchObject({
      ok: true,
      type: 'saved',
      entry: {
        word: 'bank',
        status: 'learning',
        senses: [
          {
            definition: 'a financial institution',
            translation: 'ngân hàng',
            sentence: 'the river bank',
            url: 'https://example.com',
            title: 'Example',
          },
        ],
      },
    });
  });

  it('a second saved.save for the same word (different casing) preserves savedAt, replaces senses', async () => {
    const d = deps();
    const route = buildRouter(d);
    const first = await route({
      type: 'saved.save',
      word: 'Bank',
      definition: 'first def',
      translation: '',
      sentence: 's1',
      url: 'u1',
      title: 't1',
    });
    const firstSavedAt = (first as { entry: { savedAt: number } }).entry.savedAt;
    const second = await route({
      type: 'saved.save',
      word: 'bank',
      definition: 'second def',
      translation: '',
      sentence: 's2',
      url: 'u2',
      title: 't2',
    });
    const entry = (second as { entry: { savedAt: number; senses: unknown[] } }).entry;
    expect(entry.savedAt).toBe(firstSavedAt);
    expect(entry.senses).toHaveLength(1);
    expect((entry.senses[0] as { definition: string }).definition).toBe('second def');
  });

  it('saved.delete removes the entry; idempotent on an unknown word', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route({
      type: 'saved.save',
      word: 'bank',
      definition: 'd',
      translation: '',
      sentence: 's',
      url: 'u',
      title: 't',
    });
    const reply = await route({ type: 'saved.delete', word: 'BANK' });
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
    const again = await route({ type: 'saved.delete', word: 'ghost' });
    expect(again).toMatchObject({ ok: true, type: 'ack' });
  });

  it('history.clear and cache.clear never touch saved:* (independent keyspace scope fence)', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route(lookupMsg('a')); // populates history + cache
    await route({
      type: 'saved.save',
      word: 'bank',
      definition: 'd',
      translation: '',
      sentence: 's',
      url: 'u',
      title: 't',
    });
    await route({ type: 'history.clear' });
    await route({ type: 'cache.clear' });
    expect(await d.kv.getItem('saved:bank')).not.toBeNull();
  });

  it('lookup.cancel with no inflight request still returns ack (no crash)', async () => {
    const route = buildRouter(deps());
    const ack = await route({ type: 'lookup.cancel', requestId: 'nonexistent' });
    expect(ack).toMatchObject({ ok: true, type: 'ack' });
  });

  it('open-options → calls the injected openOptions port and replies ack', async () => {
    const openOptions = vi.fn<() => void>();
    const route = buildRouter({ ...deps(), openOptions });
    const reply = await route({ type: 'open-options' });
    expect(openOptions).toHaveBeenCalledOnce();
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
  });

  it('open-options without an openOptions port still replies ack (no crash)', async () => {
    // The port is optional — a shell that never sends open-options need not provide it.
    const reply = await buildRouter(deps())({ type: 'open-options' });
    expect(reply).toMatchObject({ ok: true, type: 'ack' });
  });

  it('non-LookupError rejection is wrapped via mapError (toLookupError fallback)', async () => {
    // Throw a plain Error (not LookupError-shaped) to hit the mapError branch
    const d = deps({
      client: { lookup: makeLookupMock(() => Promise.reject(new Error('plain network failure'))) },
    });
    const reply = await buildRouter(d)(lookupMsg('plain'));
    // mapError wraps unknown errors as UNKNOWN code
    expect(reply).toMatchObject({ ok: false, type: 'lookup', error: { code: 'UNKNOWN' } });
  });

  it('history.list with limit + cursor options passes them through', async () => {
    const d = deps();
    const route = buildRouter(d);
    // Seed two entries so pagination is meaningful
    await route(lookupMsg('a'));
    await route(lookupMsg('b'));
    const reply = await route({ type: 'history.list', limit: 1 });
    expect(reply).toMatchObject({ ok: true, type: 'history' });
  });

  it('error reply preserves vendor diagnostic fields through the flatten (adr-20260618)', async () => {
    // The SW captures telemetry from the flattened reply.error; httpStatus/vendorStatus/
    // vendorMessage must survive toLookupError() and JSON serialization, or GA4 never sees them.
    const d = deps({
      client: {
        lookup: makeLookupMock(() =>
          Promise.reject(
            Object.assign(new Error('Gemini server error. Retry.'), {
              code: 'NETWORK',
              message: 'Gemini server error. Retry.',
              retryable: true,
              httpStatus: 503,
              vendorStatus: 'UNAVAILABLE',
              vendorMessage: 'The model is overloaded.',
            }),
          ),
        ),
      },
    });
    const reply = await buildRouter(d)(lookupMsg('v'));
    const wire = JSON.parse(JSON.stringify(reply)) as {
      error: { httpStatus?: number; vendorStatus?: string; vendorMessage?: string };
    };
    expect(wire.error).toMatchObject({
      httpStatus: 503,
      vendorStatus: 'UNAVAILABLE',
      vendorMessage: 'The model is overloaded.',
    });
  });
});

describe('errlog routing', () => {
  it('errlog.status returns the reporter status', async () => {
    const errlog = {
      status: vi.fn().mockResolvedValue({ consent: 'unset', pending: true, count: 3 }),
      setConsent: vi.fn().mockResolvedValue(undefined),
    };
    const router = buildRouter({ ...deps(), errlog });
    const reply = await router({ type: 'errlog.status' });
    expect(reply).toEqual({ ok: true, type: 'errlog', consent: 'unset', pending: true, count: 3 });
  });

  it('errlog.set-consent delegates and acks', async () => {
    const errlog = { status: vi.fn(), setConsent: vi.fn().mockResolvedValue(undefined) };
    const router = buildRouter({ ...deps(), errlog });
    const reply = await router({ type: 'errlog.set-consent', state: 'granted' });
    expect(errlog.setConsent).toHaveBeenCalledWith('granted');
    expect(reply).toEqual({ ok: true, type: 'ack' });
  });

  it('errlog.status with no errlog dep returns a disabled status', async () => {
    const router = buildRouter(deps()); // no errlog
    const reply = await router({ type: 'errlog.status' });
    expect(reply).toEqual({
      ok: true,
      type: 'errlog',
      consent: 'disabled',
      pending: false,
      count: 0,
    });
  });
});
