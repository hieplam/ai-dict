// The lite-wire-schema shim replaces zod in the production SW bundle (esbuild wire-schema-shim
// plugin). This test exercises the shim directly to verify field-stripping and all valid types.
// Importing from ../src/lite-wire-schema is fine — the hex zone rule only blocks
// test/ → src/adapters imports, not general src/ imports.
import { describe, it, expect } from 'vitest';
import { WireMessageSchema, wireJsonSchema } from '../src/lite-wire-schema';

describe('WireMessageSchema (lite-wire-schema shim)', () => {
  // ── FIX 1 field-stripping ──────────────────────────────────────────────────

  it('(a) lookup with injected extra field: success:true AND extra field stripped', () => {
    const result = WireMessageSchema.safeParse({
      type: 'lookup',
      req: { word: 'hello', context: 'ctx', url: 'https://example.com', title: 'Page', target: 'en', promptTemplate: 'tmpl {{word}}' },
      requestId: 'req-1',
      apiKey: 'AIza-evil',          // injected extra field
      __proto__: {},                // another unexpected field
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('apiKey');
    expect(result.data).not.toHaveProperty('__proto__');
    expect(result.data.type).toBe('lookup');
    // All four GeminiLookupClient-required fields must survive field-stripping
    if (result.data.type !== 'lookup') throw new Error('expected lookup type');
    expect(result.data.req.url).toBe('https://example.com');
    expect(result.data.req.title).toBe('Page');
    expect(result.data.req.target).toBe('en');
    expect(result.data.req.promptTemplate).toBe('tmpl {{word}}');
    expect(result.data.req.context).toBe('ctx');
  });

  it('(a2) lookup with apiKey injected inside req: success:true AND req.apiKey is stripped', () => {
    const result = WireMessageSchema.safeParse({
      type: 'lookup',
      req: { word: 'hello', apiKey: 'AIza-secret', context: 'some context' },
      requestId: 'req-2',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Narrow to the lookup variant before accessing req
    if (result.data.type !== 'lookup') throw new Error('expected lookup type');
    // req must NOT carry the injected apiKey — only whitelisted fields survive
    expect(result.data.req).not.toHaveProperty('apiKey');
    expect(result.data.req.word).toBe('hello');
    expect((result.data.req as { context?: unknown }).context).toBe('some context');
  });

  it('(b1) malformed lookup — missing req entirely → success:false', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup' }).success).toBe(false);
  });

  it('(b2) malformed lookup — req present but word is missing → success:false', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup', req: {} }).success).toBe(false);
  });

  it('(b3) malformed lookup — req.word is not a string → success:false', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup', req: { word: 42 } }).success).toBe(false);
  });

  it('(c) unknown type → success:false', () => {
    expect(WireMessageSchema.safeParse({ type: 'unknown.command' }).success).toBe(false);
  });

  it('(c) null → success:false', () => {
    expect(WireMessageSchema.safeParse(null).success).toBe(false);
  });

  it('(c) non-object → success:false', () => {
    expect(WireMessageSchema.safeParse('lookup').success).toBe(false);
  });

  // ── (d) each of the other 6 types with minimal valid input ─────────────────

  it('(d) lookup.cancel with requestId → success:true, only {type, requestId}', () => {
    const result = WireMessageSchema.safeParse({ type: 'lookup.cancel', requestId: 'r1', evil: true });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('evil');
    expect(result.data.type).toBe('lookup.cancel');
  });

  it('(d) settings.get → success:true, only {type}', () => {
    const result = WireMessageSchema.safeParse({ type: 'settings.get', evil: true });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('evil');
  });

  it('(d) history.list minimal → success:true, only {type}', () => {
    const result = WireMessageSchema.safeParse({ type: 'history.list' });
    expect(result.success).toBe(true);
  });

  it('(d) history.list with limit and cursor → strips extra fields, keeps limit+cursor', () => {
    const result = WireMessageSchema.safeParse({ type: 'history.list', limit: 10, cursor: 'abc', evil: 'x' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('evil');
    expect((result.data as { limit?: unknown }).limit).toBe(10);
    expect((result.data as { cursor?: unknown }).cursor).toBe('abc');
  });

  it('(d) history.clear → success:true', () => {
    expect(WireMessageSchema.safeParse({ type: 'history.clear' }).success).toBe(true);
  });

  it('(d) cache.clear → success:true', () => {
    expect(WireMessageSchema.safeParse({ type: 'cache.clear' }).success).toBe(true);
  });

  it('(d) connection.test → success:true', () => {
    expect(WireMessageSchema.safeParse({ type: 'connection.test' }).success).toBe(true);
  });

  // ── FIX 1: wireJsonSchema stub coverage ────────────────────────────────────
  it('wireJsonSchema() returns an empty object (SW bundle stub — real schema lives in core)', () => {
    expect(wireJsonSchema()).toEqual({});
  });
});
