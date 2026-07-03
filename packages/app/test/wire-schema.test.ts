import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', outputFormat: 't' },
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
      settings: { targetLang: 'vi', outputFormat: 't', hasKey: true, apiKey: 'x' },
    });
    expect(ok.success).toBe(false);
  });

  it('[S1] apiKey at outer reply object level is stripped (z.object strip behavior)', () => {
    // The outer WireReplySchema arms use z.object (strip mode) — an apiKey injected at the
    // root of the reply envelope must be silently dropped, not passed through to consumers.
    const ok = WireReplySchema.safeParse({
      ok: true,
      type: 'settings',
      settings: {
        targetLang: 'vi',
        outputFormat: 't',
        hasKey: true,
        theme: 'sepia',
        configuredProviders: [],
      },
      apiKey: 'leaked',
    });
    expect(ok.success).toBe(true);
    expect('apiKey' in (ok.data as object)).toBe(false);
  });

  it('accepts each of the four theme values in a settings reply', () => {
    for (const theme of ['sepia', 'dark', 'contrast', 'system']) {
      const ok = WireReplySchema.safeParse({
        ok: true,
        type: 'settings',
        settings: {
          targetLang: 'vi',
          outputFormat: 't',
          hasKey: true,
          theme,
          configuredProviders: [],
        },
      });
      expect(ok.success, `theme=${theme} must parse`).toBe(true);
    }
  });

  it('rejects a settings reply with an unknown or missing theme', () => {
    const base = { targetLang: 'vi', outputFormat: 't', hasKey: true };
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'settings',
        // 'light' is the retired pre-Paperlight value — rejected at the wire (storage coerces
        // any legacy 'light' to 'sepia' before it is ever serialized onto the wire).
        settings: { ...base, theme: 'light' },
      }).success,
    ).toBe(false);
    expect(WireReplySchema.safeParse({ ok: true, type: 'settings', settings: base }).success).toBe(
      false,
    );
  });
  it('extra top-level field on inbound WireMessage is stripped (strip policy)', () => {
    // WireMessageSchema arms use z.object (strip mode) — a spurious apiKey at the top level
    // of a lookup message must be stripped, not passed through (documents the chosen policy).
    const ok = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: 'r1',
      req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', outputFormat: 't' },
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
  it('accepts open-options message', () => {
    expect(WireMessageSchema.safeParse({ type: 'open-options' }).success).toBe(true);
  });
  it('accepts history.delete message with an id', () => {
    expect(WireMessageSchema.safeParse({ type: 'history.delete', id: 'h1' }).success).toBe(true);
  });
  it('rejects history.delete missing its id', () => {
    expect(WireMessageSchema.safeParse({ type: 'history.delete' }).success).toBe(false);
  });

  // Rejection test: lookup message missing required field
  it('rejects a lookup message missing requestId', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', outputFormat: 't' },
        // requestId intentionally omitted
      }).success,
    ).toBe(false);
  });
  it('rejects a lookup message with a malformed req (missing word)', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: { context: 'b', url: '', title: '', target: 'vi', outputFormat: 't' },
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

  it('settings reply includes configuredProviders', () => {
    const r = WireReplySchema.safeParse({
      ok: true,
      type: 'settings',
      settings: {
        targetLang: 'vi',
        outputFormat: 'f',
        hasKey: true,
        theme: 'sepia',
        configuredProviders: ['gemini'],
      },
    });
    expect(r.success).toBe(true);
  });

  it('lookup req accepts an optional provider override and rejects unknown providers', () => {
    const base = { word: 'w', context: 'c', url: '', title: '', target: 'vi', outputFormat: 'f' };
    const ok = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: '1',
      req: { ...base, provider: 'anthropic' },
    });
    expect(ok.success).toBe(true);
    const bad = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: '1',
      req: { ...base, provider: 'skynet' },
    });
    expect(bad.success).toBe(false);
  });

  it('lookup result carries optional provider + fallbackFrom; old results still parse', () => {
    const result = {
      markdown: 'm',
      word: 'w',
      target: 'vi',
      model: 'x',
      fromCache: false,
      fetchedAt: 1,
    };
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
    ).toBe(true);
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: '1',
        result: { ...result, provider: 'anthropic', fallbackFrom: 'gemini' },
      }).success,
    ).toBe(true);
  });

  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot(
      '../wire-schema.snapshot.json',
    );
  });
});

describe('errlog wire messages', () => {
  it('accepts errlog.status and errlog.set-consent', () => {
    expect(WireMessageSchema.safeParse({ type: 'errlog.status' }).success).toBe(true);
    expect(
      WireMessageSchema.safeParse({ type: 'errlog.set-consent', state: 'granted' }).success,
    ).toBe(true);
    expect(WireMessageSchema.safeParse({ type: 'errlog.set-consent', state: 'nope' }).success).toBe(
      false,
    );
  });
  it('accepts the errlog status reply', () => {
    const reply = { ok: true, type: 'errlog', consent: 'unset', pending: true, count: 3 };
    expect(WireReplySchema.safeParse(reply).success).toBe(true);
  });

  it('accepts a lookup error reply with vendor diagnostic fields (adr-20260618)', () => {
    const reply = {
      ok: false,
      type: 'lookup',
      requestId: 'r',
      error: {
        code: 'NETWORK',
        message: 'Gemini server error. Retry.',
        retryable: true,
        httpStatus: 503,
        vendorStatus: 'UNAVAILABLE',
        vendorMessage: 'The model is overloaded.',
      },
    };
    expect(WireReplySchema.safeParse(reply).success).toBe(true);
  });

  it('rejects an unknown field inside the error object (strictObject)', () => {
    const reply = {
      ok: false,
      type: 'lookup',
      error: { code: 'NETWORK', message: 'x', retryable: true, bogus: 1 },
    };
    expect(WireReplySchema.safeParse(reply).success).toBe(false);
  });
});
