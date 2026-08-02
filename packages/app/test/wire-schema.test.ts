import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire';
import { mapError } from '../src/index';
import { toLookupError } from '../src/app/router';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: {
          word: 'a',
          context: 'b',
          url: '',
          title: '',
          target: 'vi',
          outputFormat: 't',
          promptEnvelope: '',
        },
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
        promptEnvelope: '',
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
          promptEnvelope: '',
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
      req: {
        word: 'a',
        context: 'b',
        url: '',
        title: '',
        target: 'vi',
        outputFormat: 't',
        promptEnvelope: '',
      },
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
  it('accepts an open-options message with fixKey (C6)', () => {
    expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: true }).success).toBe(true);
    expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: false }).success).toBe(true);
  });
  it('rejects an open-options message with a non-boolean fixKey (C6)', () => {
    expect(WireMessageSchema.safeParse({ type: 'open-options', fixKey: 'yes' }).success).toBe(
      false,
    );
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
        req: {
          word: 'a',
          context: 'b',
          url: '',
          title: '',
          target: 'vi',
          outputFormat: 't',
          promptEnvelope: '',
        },
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

  // D1: BILLING is a new, valid error code on the wire reply.
  it('accepts a valid error reply (ok:false with BILLING error)', () => {
    const result = WireReplySchema.safeParse({
      ok: false,
      type: 'lookup',
      error: { code: 'BILLING', message: 'x', retryable: false },
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
        promptEnvelope: '',
        hasKey: true,
        theme: 'sepia',
        configuredProviders: ['gemini'],
      },
    });
    expect(r.success).toBe(true);
  });

  it('lookup req accepts an optional provider override and rejects unknown providers', () => {
    const base = {
      word: 'w',
      context: 'c',
      url: '',
      title: '',
      target: 'vi',
      outputFormat: 'f',
      promptEnvelope: '',
    };
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

  it('lookup req accepts an optional forceLiteral flag and rejects a non-boolean', () => {
    const base = {
      word: 'w',
      context: 'c',
      url: '',
      title: '',
      target: 'vi',
      outputFormat: 'f',
      promptEnvelope: '',
    };
    const ok = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: '1',
      req: { ...base, forceLiteral: true },
    });
    expect(ok.success).toBe(true);
    const bad = WireMessageSchema.safeParse({
      type: 'lookup',
      requestId: '1',
      req: { ...base, forceLiteral: 'yes' },
    });
    expect(bad.success).toBe(false);
  });

  it('lookup result carries an optional definedAs; rejects an unknown key inside it (strictObject)', () => {
    const result = {
      markdown: 'm',
      word: 'w',
      target: 'vi',
      model: 'x',
      fromCache: false,
      fetchedAt: 1,
    };
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: '1',
        result: { ...result, definedAs: { term: 'kick the bucket', isIdiom: true } },
      }).success,
    ).toBe(true);
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: '1',
        result: { ...result, definedAs: { term: 'x', isIdiom: true, extra: 'nope' } },
      }).success,
    ).toBe(false);
    // Old-shaped result (no definedAs) still parses — back-compat.
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
    ).toBe(true);
  });

  it('lookup result carries an optional translation; back-compat with results that omit it', () => {
    const result = {
      markdown: 'm',
      word: 'w',
      target: 'vi',
      model: 'x',
      fromCache: false,
      fetchedAt: 1,
    };
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: '1',
        result: { ...result, translation: 'ngân hàng' },
      }).success,
    ).toBe(true);
    // Old-shaped result (no translation) still parses — back-compat.
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
    ).toBe(true);
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

  it('lookup result carries an optional nudge flag; old results still parse (B7)', () => {
    const result = {
      markdown: 'm',
      word: 'w',
      target: 'vi',
      model: 'x',
      fromCache: false,
      fetchedAt: 1,
    };
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'lookup',
        requestId: '1',
        result: { ...result, nudge: true },
      }).success,
    ).toBe(true);
    // Old-shaped result (no nudge) still parses — back-compat.
    expect(
      WireReplySchema.safeParse({ ok: true, type: 'lookup', requestId: '1', result }).success,
    ).toBe(true);
  });

  it('promptEnvelope is required on settings and carried on the lookup req (like outputFormat)', () => {
    const base = {
      targetLang: 'vi',
      outputFormat: 't',
      hasKey: true,
      theme: 'sepia' as const,
      configuredProviders: [],
    };
    // Present (even '') → parses; omitted → rejected, exactly like outputFormat.
    expect(
      WireReplySchema.safeParse({
        ok: true,
        type: 'settings',
        settings: { ...base, promptEnvelope: '' },
      }).success,
    ).toBe(true);
    expect(WireReplySchema.safeParse({ ok: true, type: 'settings', settings: base }).success).toBe(
      false,
    );
    // A non-empty envelope override round-trips on the lookup req.
    expect(
      WireMessageSchema.safeParse({
        type: 'lookup',
        requestId: 'r1',
        req: {
          word: 'a',
          context: 'b',
          url: '',
          title: '',
          target: 'vi',
          outputFormat: 't',
          promptEnvelope: 'CUSTOM {word}',
        },
      }).success,
    ).toBe(true);
  });

  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot(
      '../wire-schema.snapshot.json',
    );
  });
});

describe('saved.save / saved.delete wire messages (B1)', () => {
  const senseFields = {
    word: 'bank',
    definition: 'a financial institution',
    translation: '',
    sentence: 'the river bank',
    url: 'https://example.com',
    title: 'Example',
  };

  it('accepts a valid saved.save message', () => {
    const parsed = WireMessageSchema.safeParse({ type: 'saved.save', ...senseFields });
    expect(parsed.success).toBe(true);
  });

  it('rejects a saved.save message missing a required field', () => {
    const { title: _title, ...missingTitle } = senseFields;
    void _title;
    const parsed = WireMessageSchema.safeParse({ type: 'saved.save', ...missingTitle });
    expect(parsed.success).toBe(false);
  });

  it('accepts a valid saved.delete message', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.delete', word: 'bank' }).success).toBe(true);
  });

  it('a saved reply carries the ratified entry shape; rejects an unknown key inside a sense (strictObject)', () => {
    const entry = {
      word: 'bank',
      status: 'learning',
      savedAt: 1,
      senses: [
        {
          definition: 'd',
          translation: 't',
          sentence: 's',
          url: 'u',
          title: 'ti',
        },
      ],
    };
    expect(WireReplySchema.safeParse({ ok: true, type: 'saved', entry }).success).toBe(true);
    const bad = {
      ...entry,
      senses: [{ ...entry.senses[0], extra: 'nope' }],
    };
    expect(WireReplySchema.safeParse({ ok: true, type: 'saved', entry: bad }).success).toBe(false);
  });

  it('rejects an invalid status value inside a saved reply entry', () => {
    const entry = {
      word: 'bank',
      status: 'archived', // not 'learning' | 'known'
      savedAt: 1,
      senses: [{ definition: 'd', translation: 't', sentence: 's', url: 'u', title: 'ti' }],
    };
    expect(WireReplySchema.safeParse({ ok: true, type: 'saved', entry }).success).toBe(false);
  });

  it('accepts a valid saved.setStatus message (B5)', () => {
    expect(
      WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'known' })
        .success,
    ).toBe(true);
    expect(
      WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'learning' })
        .success,
    ).toBe(true);
  });

  it('rejects a saved.setStatus message with an invalid status value (B5)', () => {
    expect(
      WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank', status: 'mastered' })
        .success,
    ).toBe(false);
  });

  it('rejects a saved.setStatus message missing word or status (B5)', () => {
    expect(WireMessageSchema.safeParse({ type: 'saved.setStatus', status: 'known' }).success).toBe(
      false,
    );
    expect(WireMessageSchema.safeParse({ type: 'saved.setStatus', word: 'bank' }).success).toBe(
      false,
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

// typed-errors: the wire-flatten contract. GeminiLookupClient (and every LookupClient) throws
// via `Object.assign(new Error(msg), lookupError)` (rule-typed-errors) — a raw JS Error whose
// `message` is a NON-enumerable own property. router.ts's toLookupError flattens that into a
// plain object before it is ever placed on an error reply, specifically so `message` survives
// the chrome.runtime wire's JSON.stringify/JSON.parse round-trip. This suite pins that behavior
// for every error-reply shape the router can produce (grepped `toLookupError(` call sites in
// router.ts: the 'lookup' reply at ~line 168 and the 'connection.test' reply at ~line 210).
describe('typed-errors: wire-flatten contract (rule-typed-errors)', () => {
  // Builds a thrown error exactly the way a real LookupClient does, so the test exercises the
  // production construction path rather than a hand-rolled stand-in.
  function thrownFrom(input: Parameters<typeof mapError>[0]): unknown {
    const mapped = mapError(input);
    return Object.assign(new Error(mapped.message), mapped);
  }

  function roundTripReply(reply: unknown): { error: Record<string, unknown> } {
    return JSON.parse(JSON.stringify(reply)) as { error: Record<string, unknown> };
  }

  function assertErrorSurvivesRoundTrip(error: Record<string, unknown>): void {
    for (const key of ['code', 'message', 'retryable']) {
      expect(
        Object.prototype.hasOwnProperty.call(error, key),
        `expected round-tripped error to have own enumerable key "${key}"`,
      ).toBe(true);
    }
    expect(Object.keys(error)).toEqual(expect.arrayContaining(['code', 'message', 'retryable']));
  }

  it('a "lookup" error reply built from an http-mapped error round-trips code/message/retryable', () => {
    const err = thrownFrom({ kind: 'http', status: 503, provider: 'gemini' });
    const reply = { ok: false, type: 'lookup', error: toLookupError(err), requestId: 'r1' };
    const roundTripped = roundTripReply(reply);
    assertErrorSurvivesRoundTrip(roundTripped.error);
    expect(roundTripped.error.code).toBe('NETWORK');
    expect(roundTripped.error.retryable).toBe(true);
    expect(typeof roundTripped.error.message).toBe('string');
    expect((roundTripped.error.message as string).length).toBeGreaterThan(0);
  });

  it('a "connection.test" error reply built from a no-key error round-trips code/message/retryable', () => {
    const err = thrownFrom({ kind: 'no-key' });
    const reply = { ok: false, type: 'connection.test', error: toLookupError(err) };
    const roundTripped = roundTripReply(reply);
    assertErrorSurvivesRoundTrip(roundTripped.error);
    expect(roundTripped.error.code).toBe('NO_KEY');
    expect(roundTripped.error.retryable).toBe(false);
    expect(typeof roundTripped.error.message).toBe('string');
    expect((roundTripped.error.message as string).length).toBeGreaterThan(0);
  });

  it('a "lookup" error reply built from a timeout-mapped error also round-trips (a third mapError kind)', () => {
    const err = thrownFrom({ kind: 'timeout' });
    const reply = { ok: false, type: 'lookup', error: toLookupError(err), requestId: 'r2' };
    const roundTripped = roundTripReply(reply);
    assertErrorSurvivesRoundTrip(roundTripped.error);
    expect(roundTripped.error.code).toBe('NETWORK');
    expect(roundTripped.error.retryable).toBe(true);
    expect(typeof roundTripped.error.message).toBe('string');
    expect((roundTripped.error.message as string).length).toBeGreaterThan(0);
  });

  // Negative control: a raw Error's `message` is set by the Error constructor as a
  // NON-enumerable own property, so JSON.stringify never visits it and JSON.parse comes back
  // without it. This is exactly the failure mode toLookupError's flatten-to-plain-object exists
  // to prevent (see router.ts's comment beside toLookupError) — without the flatten, an error
  // reply would arrive at the card as `{}` and render an empty error.
  it('[negative control] a raw `new Error("x")` LOSES `message` over the same JSON round-trip', () => {
    const raw = new Error('x');
    const roundTripped = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    expect(Object.keys(roundTripped)).not.toContain('message');
    expect(roundTripped.message).toBeUndefined();
  });
});
