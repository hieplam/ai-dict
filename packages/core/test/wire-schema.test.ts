import { describe, it, expect } from 'vitest';
import { WireMessageSchema, WireReplySchema, wireJsonSchema } from '../src/wire-schema';

describe('wire-schema', () => {
  it('accepts a valid lookup message', () => {
    expect(WireMessageSchema.safeParse({ type: 'lookup', requestId: 'r1', req: { word: 'a', context: 'b', url: '', title: '', target: 'vi', promptTemplate: 't' } }).success).toBe(true);
  });
  it('rejects an unknown message type', () => {
    expect(WireMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
  it('[S1] settings reply schema has no apiKey field', () => {
    const ok = WireReplySchema.safeParse({ ok: true, type: 'settings', settings: { targetLang: 'vi', promptTemplate: 't', hasKey: true, apiKey: 'x' } });
    // extra apiKey must be stripped/rejected — settings carries PublicSettings only
    if (ok.success) expect('apiKey' in (ok.data as { settings: object }).settings).toBe(false);
    else expect(ok.success).toBe(false);
  });
  it('JSON-schema snapshot is stable (spec §8.5)', async () => {
    await expect(JSON.stringify(wireJsonSchema(), null, 2)).toMatchFileSnapshot('../wire-schema.snapshot.json');
  });
});
