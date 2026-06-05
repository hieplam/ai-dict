import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapError } from '../src/domain/error-mapper';

describe('mapError (spec §6.9)', () => {
  it('no-key → NO_KEY, not retryable', () => {
    expect(mapError({ kind: 'no-key' })).toMatchObject({ code: 'NO_KEY', retryable: false });
  });
  it('HTTP 400 INVALID_ARGUMENT → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 400, geminiStatus: 'INVALID_ARGUMENT' }).code).toBe(
      'INVALID_KEY',
    );
  });
  it('HTTP 401/403 → INVALID_KEY', () => {
    expect(mapError({ kind: 'http', status: 401 }).code).toBe('INVALID_KEY');
    expect(mapError({ kind: 'http', status: 403 }).code).toBe('INVALID_KEY');
  });
  it('geminiStatus UNAUTHENTICATED → INVALID_KEY regardless of HTTP status (e.g. 200)', () => {
    expect(mapError({ kind: 'http', status: 200, geminiStatus: 'UNAUTHENTICATED' }).code).toBe(
      'INVALID_KEY',
    );
  });
  it('geminiStatus PERMISSION_DENIED → INVALID_KEY regardless of HTTP status (e.g. 200)', () => {
    expect(mapError({ kind: 'http', status: 200, geminiStatus: 'PERMISSION_DENIED' }).code).toBe(
      'INVALID_KEY',
    );
  });
  it('HTTP 429 → RATE_LIMIT, retryable, carries retryAfterSec', () => {
    const e = mapError({ kind: 'http', status: 429, retryAfterSec: 30 });
    expect(e).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterSec: 30 });
  });
  it('HTTP 5xx / offline / timeout → NETWORK, retryable', () => {
    expect(mapError({ kind: 'http', status: 503 })).toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
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

  // FIX 2: absent-field contract — retryAfterSec must be ABSENT (not undefined) when no Retry-After
  it('HTTP 429 without retryAfterSec → RATE_LIMIT and retryAfterSec field is ABSENT', () => {
    const e = mapError({ kind: 'http', status: 429 });
    expect(e.code).toBe('RATE_LIMIT');
    expect('retryAfterSec' in e).toBe(false);
  });

  // FIX 3: geminiStatus-only RATE_LIMIT path (status 200 + RESOURCE_EXHAUSTED)
  it('geminiStatus RESOURCE_EXHAUSTED → RATE_LIMIT even when HTTP status is 200', () => {
    expect(mapError({ kind: 'http', status: 200, geminiStatus: 'RESOURCE_EXHAUSTED' }).code).toBe(
      'RATE_LIMIT',
    );
  });
});

// Helper: read a fixture file and parse JSON (or return raw string for non-JSON)
function fixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures/gemini-responses', name), 'utf-8');
}
interface GeminiErrorBody {
  error: { status: string; code: number; message: string };
}

describe('mapError — fixture-driven (validates fixture content matches mapper assumptions)', () => {
  it('invalid-key-400.json: status=INVALID_ARGUMENT, code=400 → INVALID_KEY', () => {
    const body = JSON.parse(fixture('invalid-key-400.json')) as GeminiErrorBody;
    expect(body.error.code).toBe(400);
    expect(body.error.status).toBe('INVALID_ARGUMENT');
    const result = mapError({
      kind: 'http',
      status: body.error.code,
      geminiStatus: body.error.status,
    });
    expect(result.code).toBe('INVALID_KEY');
    expect(result.retryable).toBe(false);
  });

  it('invalid-key-403.json: status=PERMISSION_DENIED, code=403 → INVALID_KEY', () => {
    const body = JSON.parse(fixture('invalid-key-403.json')) as GeminiErrorBody;
    expect(body.error.code).toBe(403);
    expect(body.error.status).toBe('PERMISSION_DENIED');
    const result = mapError({
      kind: 'http',
      status: body.error.code,
      geminiStatus: body.error.status,
    });
    expect(result.code).toBe('INVALID_KEY');
    expect(result.retryable).toBe(false);
  });

  it('rate-limit-429.json: status=RESOURCE_EXHAUSTED, code=429 → RATE_LIMIT', () => {
    const body = JSON.parse(fixture('rate-limit-429.json')) as GeminiErrorBody;
    expect(body.error.code).toBe(429);
    expect(body.error.status).toBe('RESOURCE_EXHAUSTED');
    const result = mapError({
      kind: 'http',
      status: body.error.code,
      geminiStatus: body.error.status,
    });
    expect(result.code).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('server-5xx.json: status=INTERNAL, code=500 → NETWORK', () => {
    const body = JSON.parse(fixture('server-5xx.json')) as GeminiErrorBody;
    expect(body.error.code).toBe(500);
    const result = mapError({
      kind: 'http',
      status: body.error.code,
      geminiStatus: body.error.status,
    });
    expect(result.code).toBe('NETWORK');
    expect(result.retryable).toBe(true);
  });

  it('malformed.txt: non-JSON content maps to PARSE error', () => {
    const raw = fixture('malformed.txt');
    // Simulate what a real adapter would do: JSON.parse throws → kind: 'parse'
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(raw)).toThrow();
    const result = mapError({ kind: 'parse' });
    expect(result.code).toBe('PARSE');
    expect(result.retryable).toBe(false);
  });

  it('success.json: well-formed response has no error field (candidates only)', () => {
    const body = JSON.parse(fixture('success.json')) as Record<string, unknown>;
    expect(body).not.toHaveProperty('error');
    expect(Array.isArray(body['candidates'])).toBe(true);
  });

  it('prompt-injection.json: response body contains injected markup but has no error field', () => {
    const body = JSON.parse(fixture('prompt-injection.json')) as Record<string, unknown>;
    // The fixture is a valid Gemini response, not an HTTP error — no error field present
    expect(body).not.toHaveProperty('error');
    const candidates = body['candidates'] as Array<{ content: { parts: Array<{ text: string }> } }>;
    const text = candidates[0]!.content.parts[0]!.text;
    // The raw markdown contains injected content — the adapter/renderer must sanitize it
    expect(text).toContain('<script>');
    expect(text).toContain('javascript:');
  });
});
