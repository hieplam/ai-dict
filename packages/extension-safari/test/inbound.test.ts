// BUNDLE NOTE — lite-wire-schema shim replaces zod in ALL production bundles:
// The production build uses esbuild's wire-schema-shim plugin to substitute
// src/lite-wire-schema.ts for @ai-dict/core's zod-backed WireMessageSchema in every
// output bundle (sw.js, content.js, options.js), keeping sw.js within the 30KB brotli
// SW budget (~3.5KB brotli).  Zod is never loaded in any production bundle.
// These unit tests exercise classifyInbound against the REAL zod WireMessageSchema
// because vitest resolves source files directly without the esbuild alias applied —
// this is intentional: it validates the canonical schema contract.
// The lite shim itself (field-stripping + type-discriminant check) is exercised
// separately in test/lite-wire-schema.test.ts.
// The sender guard (S3) ensures same-origin-only messages reach this path,
// limiting the attack surface to extension-internal contexts.

import { describe, it, expect } from 'vitest';
import { classifyInbound } from '../src/inbound';

const valid = { type: 'settings.get' };

describe('classifyInbound (S3 sender guard + wire-schema gate)', () => {
  it('ignores messages from a foreign sender id (S3 / D4)', () => {
    expect(classifyInbound(valid, 'evil-extension', 'my-id')).toEqual({ action: 'ignore' });
  });
  // S3: web pages send messages with sender.id === undefined (no extension id).
  // This is the most common real-world attacker path; the guard must reject it.
  it('ignores messages with undefined sender id — web-page attacker path (S3)', () => {
    expect(classifyInbound(valid, undefined, 'my-runtime-id')).toEqual({ action: 'ignore' });
  });
  it('rejects malformed messages with a PARSE error reply', () => {
    const out = classifyInbound({ type: 'nope' }, 'my-id', 'my-id');
    expect(out).toMatchObject({ action: 'reject', reply: { ok: false, error: { code: 'PARSE' } } });
  });
  it('routes a valid same-origin message', () => {
    expect(classifyInbound(valid, 'my-id', 'my-id')).toEqual({ action: 'route', msg: valid });
  });
});
