// INTEGRATION NOTE — shim vs. full Zod schema:
// These tests exercise classifyInbound against the REAL WireMessageSchema (Zod).
// In the production browser bundle, esbuild's wire-schema-shim plugin replaces
// WireMessageSchema with a lightweight Set.has check (see esbuild.config.mjs).
// The shim adds a structural guard for 'lookup' (req must be a non-null object with
// a string `word` field) to prevent a malformed message from crashing the SW on
// req.word access. All other message types carry no payload the router destructures.
// Accepted risk: non-lookup payload fields (e.g. requestId type) are not validated
// by the shim. The sender guard (S3) ensures same-origin-only messages reach this
// path, limiting the attack surface to extension-internal contexts.

import { describe, it, expect } from 'vitest';
import { classifyInbound } from '../../src/app/inbound';

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
