import {
  mapError,
  isLookupError,
  cacheGet,
  cachePut,
  cacheClear,
  cacheDelete,
  historyAppend,
  historyList,
  historyClear,
  historyGet,
  historyDelete,
  savedWordUpsert,
  savedWordDelete,
  type WireMessage,
  type WireReply,
  type LookupError,
  type LookupClient,
  type SettingsStore,
  type Storage,
  type HistoryEntry,
} from '../index';

export const SUPPRESS = Symbol('suppress');
export type RouterReply = WireReply | typeof SUPPRESS;

export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface RouterDeps {
  client: LookupClient;
  settings: SettingsStore; // returns PublicSettings (key stripped)
  kv: Storage; // single store; core owns cache:/history: prefixes
  readToggles: () => Promise<{ cacheEnabled: boolean; saveHistory: boolean }>;
  queue: WriteQueue;
  // Open the extension's options page. Injected by the composition root because the act
  // itself (chrome.runtime.openOptionsPage) is platform code that has no place in the pure
  // router. Optional: a shell that never sends 'open-options' need not provide it.
  openOptions?: () => void | Promise<void>;
  /**
   * Error-reporting service. Optional: a shell that does not report errors
   * (e.g. Safari, for now) simply omits it; the errlog.* messages then ack
   * with a disabled status. Injected by the composition root.
   */
  errlog?: {
    status: () => Promise<{
      consent: 'unset' | 'granted' | 'disabled';
      pending: boolean;
      count: number;
    }>;
    setConsent: (state: 'granted' | 'declined' | 'disabled') => Promise<void>;
  };
}

function toLookupError(err: unknown): LookupError {
  const e = isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
  // Normalise to a PLAIN object before it crosses the chrome.runtime message boundary.
  // A LookupError thrown by GeminiLookupClient is `Object.assign(new Error(msg), …)`, whose
  // `message` is a NON-enumerable own property (set by the Error constructor). chrome.runtime
  // messages are JSON-serialised, which silently drops non-enumerable props — so the message
  // would be lost in transit and the card would render an empty error. Spreading the fields into
  // a fresh object makes `message` enumerable so it survives serialisation.
  return {
    code: e.code,
    message: e.message,
    retryable: e.retryable,
    ...(e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {}),
    // Carry the vendor failure signature across the wire so the SW can feed it to telemetry.
    ...(e.httpStatus !== undefined ? { httpStatus: e.httpStatus } : {}),
    ...(e.vendorStatus !== undefined ? { vendorStatus: e.vendorStatus } : {}),
    ...(e.vendorMessage !== undefined ? { vendorMessage: e.vendorMessage } : {}),
  };
}

export function buildRouter(deps: RouterDeps): (msg: WireMessage) => Promise<RouterReply> {
  const inflight = new Map<string, AbortController>();
  const cancelled = new Set<string>();

  async function handleLookup(msg: Extract<WireMessage, { type: 'lookup' }>): Promise<RouterReply> {
    const { req, requestId } = msg;
    // Register the controller synchronously (before any await) so a lookup.cancel that arrives
    // during readToggles or cacheGet is guaranteed to find the entry in inflight and add the
    // requestId to cancelled. Without this, a cancel during the pre-inflight window is silently
    // ignored and the result is returned to the caller instead of being suppressed (§6.10 / D5).
    const controller = new AbortController();
    inflight.set(requestId, controller);

    try {
      const { cacheEnabled, saveHistory } = await deps.readToggles();
      const keyReq = { word: req.word, context: req.context, target: req.target };

      // A manual provider pick (req.provider set) must reach the picked provider: the cache key
      // ignores provider, so a hit would echo back the previous provider's answer. Skip the read.
      // A8: the same reasoning applies to a forced-literal re-run (req.forceLiteral) — a hit
      // would echo back the smart idiom-aware answer instead of the literal one requested.
      if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
        const hit = await cacheGet({ storage: deps.kv }, keyReq);
        if (hit)
          return { ok: true, type: 'lookup', result: { ...hit, fromCache: true }, requestId };
      }

      // A cancel that arrived during readToggles/cacheGet will have found requestId in inflight,
      // added it to cancelled, and called controller.abort(). Check here before calling client.
      if (cancelled.has(requestId)) return SUPPRESS;

      const result = await deps.client.lookup(req, { signal: controller.signal });
      // Strip fallbackFrom before storage writes: it's a per-request runtime annotation
      // (which provider answered this lookup) and should not persist in cache or history.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { fallbackFrom: _f, ...storableResult } = result;
      if (cacheEnabled)
        await deps.queue.run(() => cachePut({ storage: deps.kv }, keyReq, storableResult));
      if (saveHistory) {
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          word: req.word,
          context: req.context,
          result: storableResult,
          createdAt: result.fetchedAt,
        };
        await deps.queue.run(() => historyAppend({ storage: deps.kv }, entry));
      }
      return { ok: true, type: 'lookup', result, requestId };
    } catch (err) {
      if (cancelled.has(requestId)) return SUPPRESS; // our-cancel: reply channel abandoned (§6.10)
      return { ok: false, type: 'lookup', error: toLookupError(err), requestId };
    } finally {
      inflight.delete(requestId);
      cancelled.delete(requestId);
    }
  }

  function handleCancel(msg: Extract<WireMessage, { type: 'lookup.cancel' }>): RouterReply {
    const c = inflight.get(msg.requestId);
    if (c) {
      cancelled.add(msg.requestId);
      c.abort();
    }
    return { ok: true, type: 'ack' };
  }

  async function handleHistoryList(
    msg: Extract<WireMessage, { type: 'history.list' }>,
  ): Promise<RouterReply> {
    const opts: { limit?: number; cursor?: string } = {};
    if (msg.limit !== undefined) opts.limit = msg.limit;
    if (msg.cursor !== undefined) opts.cursor = msg.cursor;
    const page = await historyList({ storage: deps.kv }, opts);
    return page.nextCursor !== undefined
      ? { ok: true, type: 'history', entries: page.entries, nextCursor: page.nextCursor }
      : { ok: true, type: 'history', entries: page.entries };
  }

  async function handleConnectionTest(): Promise<RouterReply> {
    try {
      const s = await deps.settings.get();
      await deps.client.lookup({
        word: 'test',
        context: 'connection test',
        url: '',
        title: '',
        target: s.targetLang,
        outputFormat: s.outputFormat,
        promptEnvelope: s.promptEnvelope,
      });
      return { ok: true, type: 'ack' };
    } catch (err) {
      return { ok: false, type: 'connection.test', error: toLookupError(err) };
    }
  }

  return async (msg: WireMessage): Promise<RouterReply> => {
    switch (msg.type) {
      case 'lookup':
        return handleLookup(msg);
      case 'lookup.cancel':
        return handleCancel(msg);
      case 'settings.get':
        return { ok: true, type: 'settings', settings: await deps.settings.get() };
      case 'history.list':
        return handleHistoryList(msg);
      case 'history.clear':
        await historyClear({ storage: deps.kv });
        return { ok: true, type: 'ack' };
      case 'history.delete': {
        // Resolve the entry server-side so the cache key comes from the stored record, not the
        // client. Deleting the cache copy too is the point: the next lookup of this selection
        // misses and re-queries with the current prompt template. Unknown id → idempotent ack.
        const entry = await historyGet({ storage: deps.kv }, msg.id);
        if (entry) {
          await deps.queue.run(async () => {
            await cacheDelete(
              { storage: deps.kv },
              { word: entry.word, context: entry.context, target: entry.result.target },
            );
            await historyDelete({ storage: deps.kv }, entry.id);
          });
        }
        return { ok: true, type: 'ack' };
      }
      case 'saved.save': {
        const entry = await deps.queue.run(() =>
          savedWordUpsert(
            { storage: deps.kv },
            {
              word: msg.word,
              definition: msg.definition,
              translation: msg.translation,
              sentence: msg.sentence,
              url: msg.url,
              title: msg.title,
            },
          ),
        );
        return { ok: true, type: 'saved', entry };
      }
      case 'saved.delete':
        await deps.queue.run(() => savedWordDelete({ storage: deps.kv }, msg.word));
        return { ok: true, type: 'ack' };
      case 'cache.clear':
        await cacheClear({ storage: deps.kv });
        return { ok: true, type: 'ack' };
      case 'connection.test':
        return handleConnectionTest();
      case 'open-options':
        await deps.openOptions?.();
        return { ok: true, type: 'ack' };
      case 'errlog.status': {
        const s = (await deps.errlog?.status()) ?? {
          consent: 'disabled' as const,
          pending: false,
          count: 0,
        };
        return { ok: true, type: 'errlog', consent: s.consent, pending: s.pending, count: s.count };
      }
      case 'errlog.set-consent':
        await deps.errlog?.setConsent(msg.state);
        return { ok: true, type: 'ack' };
    }
  };
}
