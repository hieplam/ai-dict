import { redactPII, scrubSecrets } from './pii';

/** Max errors held locally before consent; oldest dropped beyond this. */
export const ERROR_BUFFER_CAP = 100;
const MESSAGE_MAX = 150;

export type Consent = 'unset' | 'granted' | 'disabled';

export interface ErrorRecord {
  ts: number;
  source: 'lookup' | 'connection.test' | 'thrown';
  code: string;
  provider?: 'gemini' | 'openai';
  message: string;
  retryable?: boolean;
  retryAfterSec?: number;
  domain?: string;
  extVersion: string;
  browserVersion: string;
}

export interface CaptureInput {
  source: ErrorRecord['source'];
  error: { code: string; message: string; retryable?: boolean; retryAfterSec?: number };
  url?: string;
}

export interface CaptureMeta {
  now: number;
  extVersion: string;
  browserVersion: string;
  provider: 'gemini' | 'openai' | undefined;
}

/** Hostname only — never path/query (privacy). undefined on empty/invalid. */
function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Shape a redacted, signature-only record from an error at the message boundary. */
export function toErrorRecord(input: CaptureInput, meta: CaptureMeta): ErrorRecord {
  const message = scrubSecrets(redactPII(input.error.message)).slice(0, MESSAGE_MAX);
  const rec: ErrorRecord = {
    ts: meta.now,
    source: input.source,
    code: input.error.code,
    message,
    extVersion: meta.extVersion,
    browserVersion: meta.browserVersion,
  };
  if (meta.provider) rec.provider = meta.provider;
  if (input.error.retryable !== undefined) rec.retryable = input.error.retryable;
  if (input.error.retryAfterSec !== undefined) rec.retryAfterSec = input.error.retryAfterSec;
  const domain = hostnameOf(input.url);
  if (domain) rec.domain = domain;
  return rec;
}

/** Append a record, retaining only the most recent ERROR_BUFFER_CAP. */
export function appendCapped(buffer: ErrorRecord[], rec: ErrorRecord): ErrorRecord[] {
  const next = [...buffer, rec];
  return next.length > ERROR_BUFFER_CAP ? next.slice(next.length - ERROR_BUFFER_CAP) : next;
}

/** Fibonacci prompt ladder starting at 3: index 0→3, 1→5, 2→8, 3→13, … */
export function fibThreshold(index: number): number {
  let a = 3;
  let b = 5;
  for (let i = 0; i < index; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

export type ReportDecision = 'silent' | 'prompt' | 'send';

/** Pure decision: given buffer size + rung + consent, what to do. */
export function decide(state: {
  unsentCount: number;
  thresholdIndex: number;
  consent: Consent;
}): ReportDecision {
  if (state.consent === 'granted') return 'send';
  if (state.consent === 'disabled') return 'silent';
  return state.unsentCount >= fibThreshold(state.thresholdIndex) ? 'prompt' : 'silent';
}
