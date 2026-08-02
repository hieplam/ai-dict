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
import { classifyInbound, acceptAny } from '../../src/app/inbound';

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
  it('routes errlog.status and errlog.set-consent from the same extension', () => {
    const msg1 = { type: 'errlog.status' };
    expect(classifyInbound(msg1, 'ext-id', 'ext-id')).toEqual({ action: 'route', msg: msg1 });
    const msg2 = { type: 'errlog.set-consent', state: 'declined' };
    expect(classifyInbound(msg2, 'ext-id', 'ext-id')).toEqual({ action: 'route', msg: msg2 });
  });
});

// S3 refactor (V3 Task 1): content.ts and side-panel.ts hand-roll ONLY the sender check today,
// on non-WireMessage shapes (CommandMessage / mirror-message) that never go through the router.
// classifyInbound gains an optional 4th `parse` param defaulting to the WireMessageSchema path
// above — these cases prove (a) omitting it is byte-identical to today (parity), and (b) a
// pass-through parse (acceptAny) performs ONLY the S3 sender-guard, never rejecting, so
// content.ts/side-panel.ts can route arbitrary non-WireMessage shapes through the same gate.
describe('classifyInbound with a pass-through parse (acceptAny) — content.ts/side-panel.ts shape', () => {
  it('ignores a foreign sender even with acceptAny', () => {
    expect(
      classifyInbound({ command: 'define-selection' }, 'evil-extension', 'my-id', acceptAny),
    ).toEqual({
      action: 'ignore',
    });
  });
  it('ignores an undefined sender id even with acceptAny', () => {
    expect(classifyInbound({ command: 'define-selection' }, undefined, 'my-id', acceptAny)).toEqual(
      {
        action: 'ignore',
      },
    );
  });
  it('routes an arbitrary non-WireMessage shape from the same extension, unchanged — reject never triggers', () => {
    const commandMsg = { command: 'define-selection' };
    expect(classifyInbound(commandMsg, 'my-id', 'my-id', acceptAny)).toEqual({
      action: 'route',
      msg: commandMsg,
    });
    const mirrorMsg = { to: 'side-panel', state: 'loading' };
    expect(classifyInbound(mirrorMsg, 'my-id', 'my-id', acceptAny)).toEqual({
      action: 'route',
      msg: mirrorMsg,
    });
  });
});
