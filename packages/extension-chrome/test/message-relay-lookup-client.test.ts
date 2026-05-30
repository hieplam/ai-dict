import { describe, it, expect, vi } from 'vitest';
import { MessageRelayLookupClient } from '../src/adapters/message-relay-lookup-client';
import { isLookupError, type LookupResult } from '@ai-dict/core';

const okResult: LookupResult = { markdown: '#', word: 'bank', target: 'vi', model: 'gemini-2.5-flash', fromCache: false, fetchedAt: 1 };
const req = { word: 'bank', context: 'river bank', url: '', title: '', target: 'vi', promptTemplate: 'tpl' };

describe('MessageRelayLookupClient', () => {
  it('posts {type:lookup, req, requestId} and unwraps the result', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' }));
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-1');
    expect(await c.lookup(req)).toEqual(okResult);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'lookup', req, requestId: 'id-1' });
  });

  it('rethrows an error reply as a LookupError-shaped Error', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, type: 'lookup', error: { code: 'RATE_LIMIT', message: 'slow down', retryable: true }, requestId: 'id-1' }));
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-1');
    const err = await c.lookup(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('RATE_LIMIT');
  });

  it('on signal abort, sends a lookup.cancel for the same requestId', async () => {
    const ac = new AbortController();
    const sent: unknown[] = [];
    const sendMessage = vi.fn(async (m: unknown) => { sent.push(m); return new Promise(() => {}); }); // lookup never settles
    const c = new MessageRelayLookupClient({ sendMessage }, () => 'id-9');
    void c.lookup(req, { signal: ac.signal });
    await Promise.resolve();
    ac.abort();
    expect(sent).toContainEqual({ type: 'lookup', req, requestId: 'id-9' });
    expect(sent).toContainEqual({ type: 'lookup.cancel', requestId: 'id-9' });
  });
});
