import type { Storage, TelemetrySink } from '../ports';
import {
  toErrorRecord,
  appendCapped,
  decide,
  type ErrorRecord,
  type Consent,
  type CaptureInput,
  type ReportDecision,
} from '../domain/error-report';

const K_BUFFER = 'errlog:buffer';
const K_CONSENT = 'errlog:consent';
const K_RUNG = 'errlog:threshold-index';
const GA4_MAX_EVENTS = 25;

export interface ErrorReporterDeps {
  kv: Storage;
  sink: TelemetrySink;
  now: () => number;
  /** Per-capture metadata read from the platform (versions, active provider). */
  meta: () => Promise<{
    extVersion: string;
    browserVersion: string;
    provider: 'gemini' | 'openai' | undefined;
  }>;
}

export interface ErrorLogStatus {
  consent: Consent;
  pending: boolean;
  count: number;
}

export class ErrorReporter {
  constructor(private readonly deps: ErrorReporterDeps) {}

  private async readBuffer(): Promise<ErrorRecord[]> {
    const raw = await this.deps.kv.getItem(K_BUFFER);
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? (v as ErrorRecord[]) : [];
    } catch {
      return [];
    }
  }
  private async writeBuffer(b: ErrorRecord[]): Promise<void> {
    await this.deps.kv.setItem(K_BUFFER, JSON.stringify(b));
  }
  private async readConsent(): Promise<Consent> {
    return ((await this.deps.kv.getItem(K_CONSENT)) as Consent | null) ?? 'unset';
  }
  private async readRung(): Promise<number> {
    return Number((await this.deps.kv.getItem(K_RUNG)) ?? 0) || 0;
  }

  /** Push to the sink in ≤25-event GA4-legal batches. */
  private async flush(records: ErrorRecord[]): Promise<void> {
    for (let i = 0; i < records.length; i += GA4_MAX_EVENTS) {
      await this.deps.sink.send(records.slice(i, i + GA4_MAX_EVENTS));
    }
  }

  async capture(input: CaptureInput): Promise<ReportDecision> {
    const meta = await this.deps.meta();
    const rec = toErrorRecord(input, { now: this.deps.now(), ...meta });
    const buffer = appendCapped(await this.readBuffer(), rec);
    const consent = await this.readConsent();
    const thresholdIndex = await this.readRung();
    const decision = decide({ unsentCount: buffer.length, thresholdIndex, consent });

    if (decision === 'send') {
      await this.flush(buffer);
      await this.writeBuffer([]);
    } else {
      await this.writeBuffer(buffer);
    }
    return decision;
  }

  async status(): Promise<ErrorLogStatus> {
    const buffer = await this.readBuffer();
    const consent = await this.readConsent();
    const thresholdIndex = await this.readRung();
    return {
      consent,
      count: buffer.length,
      pending: decide({ unsentCount: buffer.length, thresholdIndex, consent }) === 'prompt',
    };
  }

  async setConsent(state: 'granted' | 'declined' | 'disabled'): Promise<void> {
    if (state === 'granted') {
      const buffer = await this.readBuffer();
      if (buffer.length) await this.flush(buffer);
      await this.writeBuffer([]);
      await this.deps.kv.setItem(K_CONSENT, 'granted');
      return;
    }
    if (state === 'disabled') {
      await this.writeBuffer([]);
      await this.deps.kv.setItem(K_CONSENT, 'disabled');
      return;
    }
    // declined → soft no: keep buffer, advance the Fibonacci rung, stay 'unset'.
    await this.deps.kv.setItem(K_RUNG, String((await this.readRung()) + 1));
  }
}
