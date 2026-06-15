import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorReporter } from '../../src/app/error-reporter';
import type { Storage, TelemetrySink } from '../../src/ports';
import type { ErrorRecord } from '../../src/domain/error-report';
import { fakeStorage } from '../fakes';

function fakeSink(): TelemetrySink & { sent: ErrorRecord[][] } {
  const sent: ErrorRecord[][] = [];
  return {
    sent,
    send: (recs) => {
      sent.push(recs);
      return Promise.resolve();
    },
  };
}

const meta = { extVersion: '1.5.0', browserVersion: 'Chrome/124', provider: 'gemini' as const };
const lookupErr = {
  source: 'lookup' as const,
  error: { code: 'UNKNOWN', message: 'boom', retryable: true },
  url: 'https://a.test/x',
};

describe('ErrorReporter.capture', () => {
  let kv: Storage, sink: ReturnType<typeof fakeSink>, now: number, reporter: ErrorReporter;
  beforeEach(() => {
    kv = fakeStorage();
    sink = fakeSink();
    now = 0;
    reporter = new ErrorReporter({ kv, sink, now: () => now++, meta: () => Promise.resolve(meta) });
  });

  it('buffers silently below the first threshold (3) and never sends', async () => {
    expect(await reporter.capture(lookupErr)).toBe('silent');
    expect(await reporter.capture(lookupErr)).toBe('silent');
    expect(sink.sent).toHaveLength(0);
    expect((await reporter.status()).count).toBe(2);
  });

  it('returns "prompt" once the buffer reaches the threshold of 3', async () => {
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    expect(await reporter.capture(lookupErr)).toBe('prompt');
    expect((await reporter.status()).pending).toBe(true);
  });

  it('grant flushes the whole buffer to the sink and clears it; future errors auto-send', async () => {
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    await reporter.setConsent('granted');
    expect(sink.sent[0]).toHaveLength(3);
    expect((await reporter.status()).count).toBe(0);
    expect(await reporter.capture(lookupErr)).toBe('send');
    expect(sink.sent[1]).toHaveLength(1);
  });

  it('decline advances the Fibonacci rung: next prompt at 5, not 3', async () => {
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    await reporter.setConsent('declined');
    expect((await reporter.status()).pending).toBe(false);
    expect(await reporter.capture(lookupErr)).toBe('silent'); // 4 < 5
    expect(await reporter.capture(lookupErr)).toBe('prompt'); // 5 >= 5
  });

  it('disabled stops sending and prompting; buffer is cleared', async () => {
    await reporter.capture(lookupErr);
    await reporter.setConsent('disabled');
    expect((await reporter.status()).count).toBe(0);
    expect(await reporter.capture(lookupErr)).toBe('silent');
    expect(sink.sent).toHaveLength(0);
  });
});
