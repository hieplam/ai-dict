import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire-schema';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup', requestId: 'r1', req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' } }).success).toBe(true);
  });
  it('rejects an unknown message type', () => {
    expect(WireMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
  it('[S1] apiKey inside settings sub-object is rejected (strictObject enforces it)', () => {
    // PublicSettingsSchema uses z.strictObject — extra apiKey must be rejected, not stripped
    const ok = WireReplySchema.safeParse({ ok: true, type: 'settings', settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true, apiKey: 'x' } });
    expect(ok.success).toBe(false);
  });

  it('[S1] apiKey at outer reply object level is stripped (z.object strip behavior)', () => {
    // The outer WireReplySchema arms use z.object (strip mode) — an apiKey injected at the
    // root of the reply envelope must be silently dropped, not passed through to consumers.
    const ok = WireReplySchema.safeParse({ ok: true, type: 'settings', settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true }, apiKey: 'leaked' });
    expect(ok.success).toBe(true);
    expect('apiKey' in (ok.data as object)).toBe(false);
  });
  it('extra top-level field on inbound WireMessage is stripped (strip policy)', () => {
    // WireMessageSchema arms use z.object (strip mode) — a spurious apiKey at the top level
    // of a lookup message must be stripped, not passed through (documents the chosen policy).
    const ok = WireMessageSchema.safeParse({
      type: 'lookup', requestId: 'r1',
      req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' },
      apiKey: 'leaked',
    });
    expect(ok.success).toBe(true);
    expect('apiKey' in (ok.data as object)).toBe(false);
  });

  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot('../wire-schema.snapshot.json');
  });
});
