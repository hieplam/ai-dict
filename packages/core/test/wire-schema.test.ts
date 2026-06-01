import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire-schema';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' },
      }).success,
    ).toBe(true);
  });
  it('rejects an unknown message type', () => {
    expect(WireMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
  it('[S1] apiKey inside settings sub-object is rejected (strictObject enforces it)', () => {
    // PublicSettingsSchema uses z.strictObject — extra apiKey must be rejected, not stripped
    const ok = WireReplySchema.safeParse({
      ok: true,
      type: 'settings',
      settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true, apiKey: 'x' },
    });
    expect(ok.success).toBe(false);
  });

  it('[S1] apiKey at outer reply object level is stripped (z.object strip behavior)', () => {
    // The outer WireReplySchema arms use z.object (strip mode) — an apiKey injected at the
    // root of the reply envelope must be silently dropped, not passed through to consumers.
    const ok = WireReplySchema.safeParse({
      ok: true,
      type: 'settings',
      settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true },
      apiKey: 'leaked',
    });
    expect(ok.success).toBe(true);
    expect('apiKey' in (ok.data as object)).toBe(false);
  });
  it('extra top-level field on inbound WireMessage is stripped (strip policy)', () => {
    // WireMessageSchema arms use z.object (strip mode) — a spurious apiKey at the top level
    // of a lookup message must be stripped, not passed through (documents the chosen policy).
    const ok = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: 'r1',
      req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' },
      apiKey: 'leaked',
    });
    expect(ok.success).toBe(true);
    expect('apiKey' in (ok.data as object)).toBe(false);
  });

  // Each remaining WireMessage discriminant arm must be parseable
  it('accepts lookup.cancel message', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup.cancel', requestId: 'r2' }).success).toBe(
      true,
    );
  });
  it('accepts settings.get message', () => {
    expect(WireMessageSchema.safeParse({ type: 'settings.get' }).success).toBe(true);
  });
  it('accepts history.list message (no options)', () => {
    expect(WireMessageSchema.safeParse({ type: 'history.list' }).success).toBe(true);
  });
  it('accepts history.list message (with limit and cursor)', () => {
    expect(
      WireMessageSchema.safeParse({ type: 'history.list', limit: 10, cursor: 'abc' }).success,
    ).toBe(true);
  });
  it('accepts history.clear message', () => {
    expect(WireMessageSchema.safeParse({ type: 'history.clear' }).success).toBe(true);
  });
  it('accepts cache.clear message', () => {
    expect(WireMessageSchema.safeParse({ type: 'cache.clear' }).success).toBe(true);
  });
  it('accepts connection.test message', () => {
    expect(WireMessageSchema.safeParse({ type: 'connection.test' }).success).toBe(true);
  });

  // Rejection test: lookup message missing required field
  it('rejects a lookup message missing requestId', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' },
        // requestId intentionally omitted
      }).success,
    ).toBe(false);
  });
  it('rejects a lookup message with a malformed req (missing word)', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: { context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' },
      }).success,
    ).toBe(false);
  });

  // FIX 4a: WireReply error arm — valid error reply must parse successfully
  it('accepts a valid error reply (ok:false with RATE_LIMIT error)', () => {
    const result = WireReplySchema.safeParse({
      ok: false,
      type: 'lookup',
      error: { code: 'RATE_LIMIT', message: 'x', retryable: true },
      requestId: 'r1',
    });
    expect(result.success).toBe(true);
  });

  // FIX 4b: WireReply error arm — malformed error body must be rejected
  it('rejects an error reply with invalid error.code (not in enum)', () => {
    const result = WireReplySchema.safeParse({
      ok: false,
      type: 'lookup',
      error: { code: 'BOGUS_CODE', message: 'x', retryable: true },
      requestId: 'r1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an error reply missing error.retryable', () => {
    const result = WireReplySchema.safeParse({
      ok: false,
      type: 'lookup',
      error: { code: 'RATE_LIMIT', message: 'x' },
      requestId: 'r1',
    });
    expect(result.success).toBe(false);
  });

  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot(
      '../wire-schema.snapshot.json',
    );
  });
});
