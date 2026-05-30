import { describe, it, expect } from 'vitest';
import { mapError } from '../src/error-mapper';

describe('mapError (spec §6.9)', () => {
  it('no-key → NO_KEY, not retryable', () => {
    expect(mapError({ kind: 'no-key' })).toMatchObject({ code: 'NO_KEY', retryable: false });
  });
  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 400, geminiStatus: 'INVALID_ARGUMENT' }).code).toBe('INVALID_KEY');
  });
  it('HTTP 401/403 → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 401 }).code).toBe('INVALID_KEY');
    expect(mapError({ kind: 'http', status: 403 }).code).toBe('INVALID_KEY');
  });
  it('HTTP 429 → RATE_LIMIT, retryable, carries retryAfterSec', () => {
    const e = mapError({ kind: 'http', status: 429, retryAfterSec: 30 });
    expect(e).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterSec: 30 });
  });
  it('HTTP 5xx / offline / timeout → NETWORK, retryable', () => {
    expect(mapError({ kind: 'http', status: 503 })).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(mapError({ kind: 'offline' }).code).toBe('NETWORK');
    expect(mapError({ kind: 'timeout' }).code).toBe('NETWORK');
  });
  it('parse → PARSE, not retryable', () => {
    expect(mapError({ kind: 'parse' })).toMatchObject({ code: 'PARSE', retryable: false });
  });
  it('thrown unknown → UNKNOWN; message ≤200 chars and scrubs key-like tokens', () => {
    const e = mapError({ kind: 'thrown', error: new Error('AIzaSyD' + 'x'.repeat(400)) });
    expect(e.code).toBe('UNKNOWN');
    expect(e.message.length).toBeLessThanOrEqual(200);
    expect(e.message).not.toContain('AIzaSy');
  });
  it('thrown non-Error value → UNKNOWN with stringified message', () => {
    expect(mapError({ kind: 'thrown', error: 'boom' }).message).toContain('boom');
  });
  it('unmapped HTTP status (e.g. 418) → UNKNOWN', () => {
    expect(mapError({ kind: 'http', status: 418 }).code).toBe('UNKNOWN');
  });
});
