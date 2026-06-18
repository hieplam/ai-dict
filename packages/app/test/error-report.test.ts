import { describe, it, expect } from 'vitest';
import {
  toErrorRecord,
  appendCapped,
  fibThreshold,
  decide,
  ERROR_BUFFER_CAP,
  type ErrorRecord,
} from '../src/domain/error-report';

const meta = {
  now: 1000,
  extVersion: '1.5.0',
  browserVersion: 'Chrome/124',
  provider: 'gemini' as const,
};

describe('toErrorRecord', () => {
  it('captures the distilled provider-error code and redacts the message', () => {
    const r = toErrorRecord(
      {
        source: 'lookup',
        error: { code: 'INVALID_KEY', message: 'bad key AIzaSyABC123_-x', retryable: false },
        url: 'https://www.nytimes.com/2024/article',
      },
      meta,
    );
    expect(r).toMatchObject({
      ts: 1000,
      source: 'lookup',
      code: 'INVALID_KEY',
      provider: 'gemini',
      retryable: false,
      domain: 'www.nytimes.com',
      extVersion: '1.5.0',
      browserVersion: 'Chrome/124',
    });
    expect(r.message).toBe('bad key [redacted]');
  });

  it('redacts PII (email) in the message and truncates to 150 chars', () => {
    const r = toErrorRecord(
      {
        source: 'lookup',
        error: { code: 'UNKNOWN', message: 'fail for a@b.com '.repeat(20), retryable: true },
        url: '',
      },
      meta,
    );
    expect(r.message).not.toContain('a@b.com');
    expect(r.message).toContain('[redact]');
    expect(r.message.length).toBeLessThanOrEqual(150);
    expect(r.domain).toBeUndefined();
  });

  it('carries retryAfterSec and omits provider when not supplied', () => {
    const r = toErrorRecord(
      {
        source: 'thrown',
        error: { code: 'RATE_LIMIT', message: 'slow down', retryable: true, retryAfterSec: 30 },
        url: 'http://x.test/p',
      },
      { ...meta, provider: undefined },
    );
    expect(r.retryAfterSec).toBe(30);
    expect(r.domain).toBe('x.test');
    expect(r.provider).toBeUndefined();
  });
});

describe('appendCapped', () => {
  it('appends and keeps only the last ERROR_BUFFER_CAP, dropping oldest', () => {
    let buf: ErrorRecord[] = [];
    for (let i = 0; i < ERROR_BUFFER_CAP + 5; i++) {
      buf = appendCapped(buf, {
        ts: i,
        source: 'lookup',
        code: 'UNKNOWN',
        message: String(i),
        extVersion: '1',
        browserVersion: 'c',
      });
    }
    expect(buf.length).toBe(ERROR_BUFFER_CAP);
    expect(buf[0]!.ts).toBe(5);
    expect(buf[buf.length - 1]!.ts).toBe(ERROR_BUFFER_CAP + 4);
  });
});

describe('fibThreshold', () => {
  it('starts at 3 and follows Fibonacci spacing: 3,5,8,13,21,34', () => {
    expect([0, 1, 2, 3, 4, 5].map(fibThreshold)).toEqual([3, 5, 8, 13, 21, 34]);
  });
});

describe('decide', () => {
  it('disabled consent → silent', () => {
    expect(decide({ unsentCount: 100, thresholdIndex: 0, consent: 'disabled' })).toBe('silent');
  });
  it('granted consent → send', () => {
    expect(decide({ unsentCount: 1, thresholdIndex: 0, consent: 'granted' })).toBe('send');
  });
  it('unset below threshold → silent, at/over → prompt', () => {
    expect(decide({ unsentCount: 2, thresholdIndex: 0, consent: 'unset' })).toBe('silent');
    expect(decide({ unsentCount: 3, thresholdIndex: 0, consent: 'unset' })).toBe('prompt');
    expect(decide({ unsentCount: 4, thresholdIndex: 1, consent: 'unset' })).toBe('silent'); // rung index1=5
    expect(decide({ unsentCount: 5, thresholdIndex: 1, consent: 'unset' })).toBe('prompt');
  });
});
