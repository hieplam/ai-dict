import { describe, it, expect, vi } from 'vitest';
import { MessageRelayLookupClient, randomId } from '../../src/app/message-relay-lookup-client';
import { isLookupError, type LookupResult } from '../../src';

const okResult: LookupResult = {
  markdown: '#',
  word: 'bank',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 1,
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

describe('MessageRelayLookupClient', () => {
  it('posts {type:lookup, req, requestId} and unwraps the result', async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' }),
    );
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-1');
    expect(await c.lookup(req)).toEqual(okResult);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'lookup', req, requestId: 'id-1' });
  });

  it('rethrows an error reply as a LookupError-shaped Error', async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({
        ok: false,
        type: 'lookup',
        error: { code: 'RATE_LIMIT', message: 'slow down', retryable: true },
        requestId: 'id-1',
      }),
    );
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-1');
    const err = await c.lookup(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('RATE_LIMIT');
  });

  it('propagates retryAfterSec when the error reply includes it', async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({
        ok: false,
        type: 'lookup',
        error: { code: 'RATE_LIMIT', message: 'slow down', retryable: true, retryAfterSec: 30 },
        requestId: 'id-3',
      }),
    );
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-3');
    const err = await c.lookup(req).catch((e: unknown) => e);
    expect((err as { retryAfterSec: number }).retryAfterSec).toBe(30);
  });

  it('throws a PARSE error when the SW reply is ok but not a lookup-type (unexpected shape)', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, type: 'settings', settings: {} }));
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-2');
    const err = await c.lookup(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('PARSE');
  });

  it('default genId (randomId) makes a v4 UUID via getRandomValues — works without a secure context', async () => {
    // Regression: the previous default `crypto.randomUUID()` is undefined on plain http:// pages
    // (non-secure context) and threw "is not a function", failing every lookup there. randomId
    // uses crypto.getRandomValues, which is available everywhere.
    const sendMessage = vi.fn(() =>
      Promise.resolve({ ok: true, type: 'lookup', result: okResult, requestId: 'x' }),
    );
    await new MessageRelayLookupClient({ sendMessage }).lookup(req); // exercises the DEFAULT genId
    const calls = sendMessage.mock.calls as Array<Array<{ requestId: string }>>;
    expect(calls[0]?.[0]?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(randomId()).not.toBe(randomId()); // unique each call
  });

  it('on signal abort, sends a lookup.cancel for the same requestId', async () => {
    const ac = new AbortController();
    const sent: unknown[] = [];
    const sendMessage = vi.fn((m: unknown) => {
      sent.push(m);
      return new Promise<unknown>(() => {});
    }); // lookup never settles
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-9');
    void c.lookup(req, { signal: ac.signal });
    await Promise.resolve();
    ac.abort();
    expect(sent).toContainEqual({ type: 'lookup', req, requestId: 'id-9' });
    expect(sent).toContainEqual({ type: 'lookup.cancel', requestId: 'id-9' });
  });
});
