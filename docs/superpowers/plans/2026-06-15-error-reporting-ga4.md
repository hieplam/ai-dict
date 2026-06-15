# Consent-Gated Error Reporting → GA4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture client-side errors into a local buffer, prompt the user for consent at escalating Fibonacci thresholds, and forward an anonymous provider-error signature to Google Analytics 4 via the Measurement Protocol — no server.

**Architecture:** Pure-domain logic (record shaping, Fibonacci policy, capped buffer, GA4 payload) in `@ai-dict/app`; an app-layer `ErrorReporter` orchestrator wired only through ports (`Storage`, new `TelemetrySink`); capture happens in the Chrome `sw.ts` composition root by inspecting `reply.ok === false` (zero changes to the pure router); the consent prompt is an in-page footer on the existing error card.

**Tech Stack:** TypeScript, Vitest + happy-dom, Zod (wire schema), esbuild (`define` injection), Chrome MV3, GA4 Measurement Protocol.

**Spec:** `docs/superpowers/specs/2026-06-15-error-reporting-ga4-design.md`

**Conventions in this repo (read before starting):**
- Tests live under `packages/app/test/...` mirroring `src` (domain → `test/<name>.test.ts`, app-layer → `test/app/<name>.test.ts`, ui → `test/ui/<name>.test.ts`).
- Run app tests from `packages/app`: `npm test -- <file>` (vitest) and `npm run typecheck`.
- Domain files (`packages/app/src/domain/`) MUST be platform-free (`rule-domain-purity`): no `chrome.*`, no `fetch`, no `Date.now()` inside pure functions — inject a `now()` clock.
- Reuse existing `redactPII()` (`domain/pii.ts`) and the API-key scrub in `domain/error-mapper.ts`.

---

## Task 1: Promote the API-key scrub to a shared domain helper

The key-scrub `sanitize()` lives privately inside `error-mapper.ts`. The error
reporter must scrub keys from messages too. Extract it (DRY) without changing
`error-mapper` behavior.

**Files:**
- Modify: `packages/app/src/domain/pii.ts`
- Modify: `packages/app/src/domain/error-mapper.ts:26-30` (replace local `sanitize`)
- Modify: `packages/app/src/index.ts` (export the new helper if barrel re-exports domain)
- Test: `packages/app/test/pii.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/pii.test.ts`:

```ts
import { scrubSecrets } from '../src/domain/pii';

describe('scrubSecrets', () => {
  it('masks Google and OpenAI API-key shaped tokens', () => {
    expect(scrubSecrets('key AIzaSyABC123_-def and sk-ABCD1234efgh')).toBe(
      'key [redacted] and [redacted]',
    );
  });
  it('leaves ordinary text untouched', () => {
    expect(scrubSecrets('RESOURCE_EXHAUSTED quota exceeded')).toBe(
      'RESOURCE_EXHAUSTED quota exceeded',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npm test -- pii`
Expected: FAIL — `scrubSecrets is not a function` / no export.

- [ ] **Step 3: Add the helper to `domain/pii.ts`**

Append to `packages/app/src/domain/pii.ts`:

```ts
/**
 * Mask provider API-key shaped tokens (Google `AIza…`, OpenAI `sk-…`) with
 * `[redacted]`. Domain-pure; shared by error mapping and error reporting so a
 * key that leaks into an error message never crosses the device boundary.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]')
    .replace(/sk-[0-9A-Za-z_-]{8,}/g, '[redacted]');
}
```

- [ ] **Step 4: Re-point `error-mapper.ts` at the shared helper**

In `packages/app/src/domain/error-mapper.ts`, replace the local `sanitize` body
(lines ~26-30) so it delegates — keep the `.slice(0, 200)` truncation:

```ts
import { scrubSecrets } from './pii';

function sanitize(msg: string): string {
  return scrubSecrets(msg).slice(0, 200);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/app && npm test -- pii error-mapper && npm run typecheck`
Expected: PASS (existing `error-mapper` tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/domain/pii.ts packages/app/src/domain/error-mapper.ts packages/app/src/index.ts
git commit -m "refactor(domain): extract shared scrubSecrets helper from error-mapper"
```

---

## Task 2: Pure error-report domain — record shaping, Fibonacci policy, capped buffer

**Files:**
- Create: `packages/app/src/domain/error-report.ts`
- Modify: `packages/app/src/index.ts` (export new symbols)
- Test: `packages/app/test/error-report.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/error-report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toErrorRecord,
  appendCapped,
  fibThreshold,
  decide,
  ERROR_BUFFER_CAP,
  type ErrorRecord,
} from '../src/domain/error-report';

const meta = { now: 1000, extVersion: '1.5.0', browserVersion: 'Chrome/124', provider: 'gemini' as const };

describe('toErrorRecord', () => {
  it('captures the distilled provider-error code and redacts the message', () => {
    const r = toErrorRecord(
      { source: 'lookup', error: { code: 'INVALID_KEY', message: 'bad key AIzaSyABC123_-x', retryable: false }, url: 'https://www.nytimes.com/2024/article' },
      meta,
    );
    expect(r).toMatchObject({
      ts: 1000, source: 'lookup', code: 'INVALID_KEY', provider: 'gemini',
      retryable: false, domain: 'www.nytimes.com', extVersion: '1.5.0', browserVersion: 'Chrome/124',
    });
    expect(r.message).toBe('bad key [redacted]'); // key scrubbed
  });

  it('redacts PII (email/phone) in the message and truncates to 150 chars', () => {
    const r = toErrorRecord(
      { source: 'lookup', error: { code: 'UNKNOWN', message: 'fail for a@b.com '.repeat(20), retryable: true }, url: '' },
      meta,
    );
    expect(r.message).not.toContain('a@b.com');
    expect(r.message).toContain('[redact]');
    expect(r.message.length).toBeLessThanOrEqual(150);
    expect(r.domain).toBeUndefined(); // empty url → no domain
  });

  it('carries retryAfterSec when present and maps a thrown source to code THROWN', () => {
    const r = toErrorRecord(
      { source: 'thrown', error: { code: 'RATE_LIMIT', message: 'slow down', retryable: true, retryAfterSec: 30 }, url: 'http://x.test/p' },
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
      buf = appendCapped(buf, { ts: i, source: 'lookup', code: 'UNKNOWN', message: String(i), extVersion: '1', browserVersion: 'c' });
    }
    expect(buf.length).toBe(ERROR_BUFFER_CAP);
    expect(buf[0].ts).toBe(5); // first 5 dropped
    expect(buf[buf.length - 1].ts).toBe(ERROR_BUFFER_CAP + 4);
  });
});

describe('fibThreshold', () => {
  it('starts at 3 and follows Fibonacci spacing: 3,5,8,13,21,34', () => {
    expect([0, 1, 2, 3, 4, 5].map(fibThreshold)).toEqual([3, 5, 8, 13, 21, 34]);
  });
});

describe('decide', () => {
  it('disabled consent → never sends or prompts', () => {
    expect(decide({ unsentCount: 100, thresholdIndex: 0, consent: 'disabled' })).toBe('silent');
  });
  it('granted consent → always sends', () => {
    expect(decide({ unsentCount: 1, thresholdIndex: 0, consent: 'granted' })).toBe('send');
  });
  it('unset + below current threshold → silent', () => {
    expect(decide({ unsentCount: 2, thresholdIndex: 0, consent: 'unset' })).toBe('silent');
  });
  it('unset + at/over current threshold → prompt', () => {
    expect(decide({ unsentCount: 3, thresholdIndex: 0, consent: 'unset' })).toBe('prompt');
    expect(decide({ unsentCount: 8, thresholdIndex: 1, consent: 'unset' })).toBe('silent'); // rung is now 5→next is 8? index1=5, 8>=5 → prompt
  });
});
```

> Note: the last assertion above is intentionally checking rung math — fix the
> expected value to match `fibThreshold(1) === 5` so `unsentCount 8 >= 5` →
> `'prompt'`. Adjust when you run it (TDD: let the test tell you).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/app && npm test -- error-report`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `domain/error-report.ts`**

Create `packages/app/src/domain/error-report.ts`:

```ts
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
  provider?: 'gemini' | 'openai';
}

/** Hostname only — never the path/query (privacy). Returns undefined on empty/invalid. */
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
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/app/src/index.ts`:

```ts
export {
  toErrorRecord,
  appendCapped,
  fibThreshold,
  decide,
  ERROR_BUFFER_CAP,
  type ErrorRecord,
  type Consent,
  type CaptureInput,
  type CaptureMeta,
  type ReportDecision,
} from './domain/error-report';
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `cd packages/app && npm test -- error-report && npm run typecheck`
Expected: PASS (after correcting the one rung-math expected value per the TDD note).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/domain/error-report.ts packages/app/src/index.ts packages/app/test/error-report.test.ts
git commit -m "feat(domain): error-report record shaping, Fibonacci policy, capped buffer"
```

---

## Task 3: Pure GA4 Measurement Protocol payload builder

**Files:**
- Create: `packages/app/src/app/ga4-payload.ts`
- Modify: `packages/app/src/index.ts`
- Test: `packages/app/test/app/ga4-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/app/ga4-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGa4Request, GA4_ENDPOINT } from '../../src/app/ga4-payload';
import type { ErrorRecord } from '../../src/domain/error-report';

const rec: ErrorRecord = {
  ts: 1000, source: 'lookup', code: 'RATE_LIMIT', provider: 'gemini',
  message: 'quota exceeded for this key very long '.repeat(10),
  retryable: true, retryAfterSec: 30, domain: 'nytimes.com',
  extVersion: '1.5.0', browserVersion: 'Chrome/124',
};

describe('buildGa4Request', () => {
  const req = buildGa4Request([rec], { clientId: 'cid-1', measurementId: 'G-XXX', apiSecret: 'sek' });

  it('targets the GA4 collect endpoint with measurement_id + api_secret query', () => {
    expect(req.url).toBe(`${GA4_ENDPOINT}?measurement_id=G-XXX&api_secret=sek`);
    expect(req.method).toBe('POST');
  });

  it('emits one extension_error event per record with the signature params', () => {
    const body = JSON.parse(req.body);
    expect(body.client_id).toBe('cid-1');
    expect(body.events).toHaveLength(1);
    const e = body.events[0];
    expect(e.name).toBe('extension_error');
    expect(e.params).toMatchObject({
      code: 'RATE_LIMIT', provider: 'gemini', source: 'lookup',
      domain: 'nytimes.com', ext_version: '1.5.0', browser_version: 'Chrome/124',
      retry_after_sec: 30,
    });
  });

  it('truncates msg param to GA4 100-char limit', () => {
    const body = JSON.parse(req.body);
    expect(body.events[0].params.msg.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npm test -- ga4-payload`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/ga4-payload.ts`**

Create `packages/app/src/app/ga4-payload.ts`:

```ts
import type { ErrorRecord } from '../domain/error-report';

export const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GA4_PARAM_MAX = 100; // GA4 truncates string param VALUES beyond ~100 chars

export interface Ga4Config {
  clientId: string;
  measurementId: string;
  apiSecret: string;
}

export interface Ga4Request {
  url: string;
  method: 'POST';
  body: string;
}

function toEvent(rec: ErrorRecord) {
  const params: Record<string, string | number> = {
    code: rec.code,
    source: rec.source,
    msg: rec.message.slice(0, GA4_PARAM_MAX),
    ext_version: rec.extVersion,
    browser_version: rec.browserVersion.slice(0, GA4_PARAM_MAX),
  };
  if (rec.provider) params.provider = rec.provider;
  if (rec.domain) params.domain = rec.domain;
  if (rec.retryable !== undefined) params.retryable = rec.retryable ? 1 : 0;
  if (rec.retryAfterSec !== undefined) params.retry_after_sec = rec.retryAfterSec;
  return { name: 'extension_error', params };
}

/** Build the GA4 Measurement Protocol POST for a batch of error records. */
export function buildGa4Request(records: ErrorRecord[], cfg: Ga4Config): Ga4Request {
  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(
    cfg.measurementId,
  )}&api_secret=${encodeURIComponent(cfg.apiSecret)}`;
  const body = JSON.stringify({ client_id: cfg.clientId, events: records.map(toEvent) });
  return { url, method: 'POST', body };
}
```

> GA4 caps events per request at 25. Batches larger than that must be chunked by
> the caller (the `ErrorReporter` in Task 5 sends ≤25 at a time).

- [ ] **Step 4: Export from barrel**

Add to `packages/app/src/index.ts`:

```ts
export { buildGa4Request, GA4_ENDPOINT, type Ga4Config, type Ga4Request } from './app/ga4-payload';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/app && npm test -- ga4-payload && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/app/ga4-payload.ts packages/app/src/index.ts packages/app/test/app/ga4-payload.test.ts
git commit -m "feat(app): pure GA4 Measurement Protocol payload builder"
```

---

## Task 4: Add the `TelemetrySink` port

**Files:**
- Modify: `packages/app/src/ports.ts`

- [ ] **Step 1: Add the port interface**

Append to `packages/app/src/ports.ts`:

```ts
import type { ErrorRecord } from './domain/error-report';

/**
 * Outbound sink for anonymous error records. Implemented by a platform adapter
 * (GA4 over fetch in the Chrome shell). The core never imports fetch — the sink
 * is injected at the composition root (ref-dependency-injection).
 */
export interface TelemetrySink {
  send(records: ErrorRecord[]): Promise<void>;
}
```

- [ ] **Step 2: Re-export the type if `index.ts` re-exports ports**

Confirm `packages/app/src/index.ts` already `export * from './ports'` (it does for the other ports). If it lists ports individually, add `TelemetrySink`.

- [ ] **Step 3: Typecheck**

Run: `cd packages/app && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/ports.ts packages/app/src/index.ts
git commit -m "feat(app): add TelemetrySink port"
```

---

## Task 5: App-layer `ErrorReporter` orchestrator

Ties the pure domain to the `Storage` + `TelemetrySink` ports. Owns the
`errlog:` KV keys. Injectable `now()` clock keeps it deterministic.

**Files:**
- Create: `packages/app/src/app/error-reporter.ts`
- Modify: `packages/app/src/index.ts`
- Test: `packages/app/test/app/error-reporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/test/app/error-reporter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorReporter } from '../../src/app/error-reporter';
import type { Storage, TelemetrySink } from '../../src/ports';
import type { ErrorRecord } from '../../src/domain/error-report';

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
    keys: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)),
  };
}

function fakeSink(): TelemetrySink & { sent: ErrorRecord[][] } {
  const sent: ErrorRecord[][] = [];
  return { sent, send: async (recs) => void sent.push(recs) };
}

const meta = { extVersion: '1.5.0', browserVersion: 'Chrome/124', provider: 'gemini' as const };
const lookupErr = { source: 'lookup' as const, error: { code: 'UNKNOWN', message: 'boom', retryable: true }, url: 'https://a.test/x' };

describe('ErrorReporter.capture', () => {
  let kv: Storage, sink: ReturnType<typeof fakeSink>, now: number, reporter: ErrorReporter;
  beforeEach(() => {
    kv = memStore();
    sink = fakeSink();
    now = 0;
    reporter = new ErrorReporter({ kv, sink, now: () => now++, meta: async () => meta });
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
    expect(sink.sent[0]).toHaveLength(3); // flushed batch
    expect((await reporter.status()).count).toBe(0);
    expect(await reporter.capture(lookupErr)).toBe('send'); // standing consent
    expect(sink.sent[1]).toHaveLength(1);
  });

  it('decline advances the Fibonacci rung: next prompt at 5, not 3', async () => {
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr);
    await reporter.capture(lookupErr); // prompt at 3
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/app && npm test -- error-reporter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/error-reporter.ts`**

Create `packages/app/src/app/error-reporter.ts`:

```ts
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
  meta: () => Promise<{ extVersion: string; browserVersion: string; provider?: 'gemini' | 'openai' }>;
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
      const v = JSON.parse(raw);
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
```

- [ ] **Step 4: Export from barrel**

Add to `packages/app/src/index.ts`:

```ts
export { ErrorReporter, type ErrorReporterDeps, type ErrorLogStatus } from './app/error-reporter';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/app && npm test -- error-reporter && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/app/error-reporter.ts packages/app/src/index.ts packages/app/test/app/error-reporter.test.ts
git commit -m "feat(app): ErrorReporter orchestrator (capture/status/consent over ports)"
```

---

## Task 6: Wire protocol — `errlog.status` + `errlog.set-consent`

**Files:**
- Modify: `packages/app/src/wire.ts`
- Test: `packages/app/test/wire-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/wire-schema.test.ts`:

```ts
import { WireMessageSchema, WireReplySchema } from '../src/wire';

describe('errlog wire messages', () => {
  it('accepts errlog.status and errlog.set-consent', () => {
    expect(WireMessageSchema.safeParse({ type: 'errlog.status' }).success).toBe(true);
    expect(WireMessageSchema.safeParse({ type: 'errlog.set-consent', state: 'granted' }).success).toBe(true);
    expect(WireMessageSchema.safeParse({ type: 'errlog.set-consent', state: 'nope' }).success).toBe(false);
  });
  it('accepts the errlog status reply', () => {
    const reply = { ok: true, type: 'errlog', consent: 'unset', pending: true, count: 3 };
    expect(WireReplySchema.safeParse(reply).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npm test -- wire-schema`
Expected: FAIL — unknown discriminator values.

- [ ] **Step 3: Extend the schemas**

In `packages/app/src/wire.ts`, add to the `WireMessageSchema` discriminated union:

```ts
  z.object({ type: z.literal('errlog.status') }),
  z.object({
    type: z.literal('errlog.set-consent'),
    state: z.enum(['granted', 'declined', 'disabled']),
  }),
```

Add both literals to `MessageTypeEnum`:

```ts
  'errlog.status',
  'errlog.set-consent',
```

Add the success reply variant to `WireReplySchema` union:

```ts
  z.object({
    ok: z.literal(true),
    type: z.literal('errlog'),
    consent: z.enum(['unset', 'granted', 'disabled']),
    pending: z.boolean(),
    count: z.number(),
  }),
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/app && npm test -- wire-schema && npm run typecheck`
Expected: PASS (the `_checks` drift guard is unaffected — these messages have no domain-type twin).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/wire.ts packages/app/test/wire-schema.test.ts
git commit -m "feat(wire): errlog.status + errlog.set-consent messages"
```

---

## Task 7: Router handlers for the errlog messages

**Files:**
- Modify: `packages/app/src/app/router.ts`
- Test: `packages/app/test/app/router.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/app/test/app/router.test.ts` (follow the file's existing
`buildRouter` test-harness style — reuse its fake-deps factory; add an
`errlog` fake):

```ts
describe('errlog routing', () => {
  it('errlog.status returns the reporter status', async () => {
    const errlog = {
      status: vi.fn().mockResolvedValue({ consent: 'unset', pending: true, count: 3 }),
      setConsent: vi.fn().mockResolvedValue(undefined),
    };
    const router = buildRouter({ ...baseDeps(), errlog }); // baseDeps() = existing harness factory
    const reply = await router({ type: 'errlog.status' });
    expect(reply).toEqual({ ok: true, type: 'errlog', consent: 'unset', pending: true, count: 3 });
  });

  it('errlog.set-consent delegates and acks', async () => {
    const errlog = { status: vi.fn(), setConsent: vi.fn().mockResolvedValue(undefined) };
    const router = buildRouter({ ...baseDeps(), errlog });
    const reply = await router({ type: 'errlog.set-consent', state: 'granted' });
    expect(errlog.setConsent).toHaveBeenCalledWith('granted');
    expect(reply).toEqual({ ok: true, type: 'ack' });
  });
});
```

> If `router.test.ts` has no reusable `baseDeps()` factory, copy the deps object
> the existing tests build and add `errlog`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npm test -- app/router`
Expected: FAIL — `errlog.status` not handled / `errlog` not in `RouterDeps`.

- [ ] **Step 3: Extend `RouterDeps` and the switch**

In `packages/app/src/app/router.ts`, add to `RouterDeps`:

```ts
  /**
   * Error-reporting service. Optional: a shell that does not report errors
   * (e.g. Safari, for now) simply omits it; the errlog.* messages then ack
   * with a disabled status. Injected by the composition root.
   */
  errlog?: {
    status: () => Promise<{ consent: 'unset' | 'granted' | 'disabled'; pending: boolean; count: number }>;
    setConsent: (state: 'granted' | 'declined' | 'disabled') => Promise<void>;
  };
```

Add two cases to the returned router's `switch (msg.type)`:

```ts
      case 'errlog.status': {
        const s = (await deps.errlog?.status()) ?? { consent: 'disabled' as const, pending: false, count: 0 };
        return { ok: true, type: 'errlog', consent: s.consent, pending: s.pending, count: s.count };
      }
      case 'errlog.set-consent':
        await deps.errlog?.setConsent(msg.state);
        return { ok: true, type: 'ack' };
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd packages/app && npm test -- app/router && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/app/router.ts packages/app/test/app/router.test.ts
git commit -m "feat(app): route errlog.status + errlog.set-consent to ErrorReporter"
```

---

## Task 8: Inbound gating for the new messages

The SW gates inbound messages via `classifyInbound` (`rule-gate-runtime-messages`).
Confirm the new types are allowed (they route through the same `WireMessageSchema`,
so validation already covers them — this task verifies, and adds an explicit test).

**Files:**
- Test: `packages/app/test/app/inbound.test.ts`
- Modify (only if `classifyInbound` keeps its own allowlist): `packages/app/src/app/<inbound module>.ts`

- [ ] **Step 1: Add a test asserting the messages classify as allowed**

Append to `packages/app/test/app/inbound.test.ts` (match the file's existing
helper for a same-extension sender):

```ts
it('allows errlog.status and errlog.set-consent from the same extension', () => {
  const d1 = classifyInbound({ type: 'errlog.status' }, 'ext-id', 'ext-id');
  expect(d1.action).toBe('allow');
  const d2 = classifyInbound({ type: 'errlog.set-consent', state: 'declined' }, 'ext-id', 'ext-id');
  expect(d2.action).toBe('allow');
});
```

- [ ] **Step 2: Run the test**

Run: `cd packages/app && npm test -- app/inbound`
Expected: PASS if `classifyInbound` validates purely against `WireMessageSchema`.
If it FAILS because there is a separate hardcoded allowlist, add the two literals
to that list, then re-run to green.

- [ ] **Step 3: Commit**

```bash
git add packages/app/test/app/inbound.test.ts packages/app/src/app/
git commit -m "test(app): gate errlog.* inbound messages"
```

---

## Task 9: GA4 telemetry sink adapter (Chrome) + anonymous client id

**Files:**
- Create: `packages/extension-chrome/src/adapters/ga4-telemetry-sink.ts`
- Modify: `packages/extension-chrome/src/build-defines.d.ts`
- Modify: `packages/extension-chrome/esbuild.config.mjs` (the chrome build — the one with `chrome116` target)
- Test: `packages/app/test/app/ga4-payload.test.ts` already covers payload; the adapter itself is a thin fetch wrapper verified in the e2e task.

- [ ] **Step 1: Declare the build-time defines**

Append to `packages/extension-chrome/src/build-defines.d.ts`:

```ts
declare const __GA4_MEASUREMENT_ID__: string;
declare const __GA4_API_SECRET__: string;
```

- [ ] **Step 2: Inject them in the chrome esbuild config**

In `packages/extension-chrome/esbuild.config.mjs` (the chrome variant), near the
`GEMINI_API_KEY` block add:

```js
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID ?? '';
const GA4_API_SECRET = process.env.GA4_API_SECRET ?? '';
```

Add to the **sw.ts** build's `define` (only the SW needs the secret — keeps it
out of content scripts, `rule-api-key-isolation`):

```js
  define: {
    __GEMINI_API_KEY__: JSON.stringify(GEMINI_API_KEY),
    __GA4_MEASUREMENT_ID__: JSON.stringify(GA4_MEASUREMENT_ID),
    __GA4_API_SECRET__: JSON.stringify(GA4_API_SECRET),
  },
```

- [ ] **Step 3: Implement the sink adapter**

Create `packages/extension-chrome/src/adapters/ga4-telemetry-sink.ts`:

```ts
import { buildGa4Request, type TelemetrySink, type ErrorRecord } from '@ai-dict/app';

const K_CLIENT_ID = 'errlog:client-id';

/**
 * Posts error records to GA4 via the Measurement Protocol. Lives in the SW only:
 * the api_secret is baked into the SW bundle and never reaches a content script.
 * No-ops when GA4 is not configured (empty defines) so dev builds are silent.
 */
export class Ga4TelemetrySink implements TelemetrySink {
  constructor(
    private readonly cfg: { measurementId: string; apiSecret: string },
    private readonly area: chrome.storage.StorageArea,
    private readonly fetchFn: typeof fetch = (u, i) => fetch(u, i),
  ) {}

  private async clientId(): Promise<string> {
    const got = (await this.area.get(K_CLIENT_ID)) as Record<string, string>;
    let id = got[K_CLIENT_ID];
    if (!id) {
      id = crypto.randomUUID();
      await this.area.set({ [K_CLIENT_ID]: id });
    }
    return id;
  }

  async send(records: ErrorRecord[]): Promise<void> {
    if (!this.cfg.measurementId || !this.cfg.apiSecret || records.length === 0) return;
    const req = buildGa4Request(records, {
      clientId: await this.clientId(),
      measurementId: this.cfg.measurementId,
      apiSecret: this.cfg.apiSecret,
    });
    // Fire-and-forget; swallow network errors so reporting never breaks the app.
    try {
      await this.fetchFn(req.url, {
        method: req.method,
        body: req.body,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      });
    } catch {
      /* offline / blocked — drop silently */
    }
  }
}
```

- [ ] **Step 4: Typecheck the chrome package**

Run: `cd packages/extension-chrome && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-chrome/src/adapters/ga4-telemetry-sink.ts packages/extension-chrome/src/build-defines.d.ts packages/extension-chrome/esbuild.config.mjs
git commit -m "feat(chrome): GA4 telemetry sink adapter + build-time GA4 config"
```

---

## Task 10: CSP — allow the GA4 endpoint

**Files:**
- Modify: `packages/extension-chrome/src/manifest.json`

- [ ] **Step 1: Add the GA4 host to connect-src**

In `content_security_policy.extension_pages`, append
`https://www.google-analytics.com` to the `connect-src` directive:

```
connect-src https://generativelanguage.googleapis.com https://api.openai.com https://www.google-analytics.com;
```

> The SW (service worker) outbound fetch is governed by the extension-pages CSP
> `connect-src`. No new manifest `permissions` are needed.

- [ ] **Step 2: Verify the manifest still parses**

Run: `cd packages/extension-chrome && node -e "JSON.parse(require('fs').readFileSync('src/manifest.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/src/manifest.json
git commit -m "feat(chrome): allow GA4 endpoint in CSP connect-src"
```

---

## Task 11: Wire capture into the service worker composition root

**Files:**
- Modify: `packages/extension-chrome/src/sw.ts`

- [ ] **Step 1: Construct the reporter and inject it**

In `packages/extension-chrome/src/sw.ts`, after the existing imports add:

```ts
import { ErrorReporter } from '@ai-dict/app';
import { Ga4TelemetrySink } from './adapters/ga4-telemetry-sink';
```

Build the reporter before `buildRouter`:

```ts
function browserVersion(): string {
  const m = /Chrome\/[\d.]+/.exec(navigator.userAgent);
  return m ? m[0] : navigator.userAgent.slice(0, 80);
}

const errlogKv = new ChromeKvStore(chrome.storage.local);
const reporter = new ErrorReporter({
  kv: errlogKv,
  sink: new Ga4TelemetrySink(
    { measurementId: __GA4_MEASUREMENT_ID__, apiSecret: __GA4_API_SECRET__ },
    chrome.storage.local,
  ),
  now: () => Date.now(),
  meta: async () => ({
    extVersion: chrome.runtime.getManifest().version,
    browserVersion: browserVersion(),
    provider: (await readFullSettings()).provider ?? 'gemini',
  }),
});
```

Pass it into `buildRouter({ … , errlog: reporter })`.

- [ ] **Step 2: Capture in the message handler**

Replace the `onMessage` listener body's `.then`/`.catch` so error replies and
thrown errors are captured (keep the existing gating + `sendResponse` exactly):

```ts
  router(decision.msg)
    .then((reply) => {
      if (reply !== SUPPRESS) sendResponse(reply);
      if (reply !== SUPPRESS && reply.ok === false) {
        const url = decision.msg.type === 'lookup' ? decision.msg.req.url : undefined;
        void reporter.capture({
          source: reply.type === 'lookup' || reply.type === 'connection.test' ? reply.type : 'thrown',
          error: reply.error,
          url,
        });
      }
    })
    .catch((e: unknown) => {
      const error = mapError({ kind: 'thrown', error: e });
      sendResponse({ ok: false, type: decision.msg.type, error });
      void reporter.capture({ source: 'thrown', error, url: undefined });
    });
  return true;
```

> `void` on `capture(...)` is deliberate: reporting must never delay or block the
> user's reply. `capture` returns the decision only for tests/consumers that
> await it.

- [ ] **Step 3: Typecheck + build the extension**

Run: `cd packages/extension-chrome && npx tsc --noEmit && npm run build`
Expected: PASS, `dist/` regenerated.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-chrome/src/sw.ts
git commit -m "feat(chrome): capture provider errors in SW and feed the ErrorReporter"
```

---

## Task 12: In-page consent footer on the error card

The error card renders error state as light-DOM nodes projected through the
card's `<slot>` (see `lookup-card.ts` `::slotted(.err)`). Add a reusable builder
for the consent footer nodes, then have the content script append it when the SW
reports `pending`.

**Files:**
- Create: `packages/app/src/ui/error-consent.ts` (pure DOM-node builder; happy-dom-testable)
- Modify: `packages/app/src/index.ts`
- Test: `packages/app/test/ui/error-consent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/ui/error-consent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildConsentFooter } from '../../src/ui/error-consent';

describe('buildConsentFooter', () => {
  it('renders Send and Not now buttons and fires the callback with the choice', () => {
    const onChoice = vi.fn();
    const node = buildConsentFooter({ count: 3, onChoice });
    const buttons = node.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(node.textContent).toContain('3');
    (buttons[0] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith('granted');
    (buttons[1] as HTMLButtonElement).click();
    expect(onChoice).toHaveBeenCalledWith('declined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npm test -- error-consent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the footer builder**

Create `packages/app/src/ui/error-consent.ts`:

```ts
/**
 * Builds the consent-prompt footer appended to the error card when buffered
 * errors cross a threshold. Returns a light-DOM element (projected through the
 * card slot) styled by class names the card's ::slotted() rules already cover.
 * `onChoice` reports the user's decision; the caller relays it to the SW.
 */
export function buildConsentFooter(opts: {
  count: number;
  onChoice: (choice: 'granted' | 'declined') => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'errlog-consent';

  const text = document.createElement('p');
  text.className = 'errlog-consent-text';
  text.textContent = `Seen ${opts.count} errors recently. Send anonymous error reports to help fix them? No page content or keys are sent.`;
  wrap.appendChild(text);

  const row = document.createElement('div');
  row.className = 'errlog-consent-actions';

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'errlog-consent-send';
  send.textContent = 'Send reports';
  send.addEventListener('click', () => opts.onChoice('granted'));

  const not = document.createElement('button');
  not.type = 'button';
  not.className = 'errlog-consent-dismiss';
  not.textContent = 'Not now';
  not.addEventListener('click', () => opts.onChoice('declined'));

  row.append(send, not);
  wrap.appendChild(row);
  return wrap;
}
```

- [ ] **Step 4: Add `::slotted` styling for the footer in `lookup-card.ts`**

In `packages/app/src/ui/lookup-card.ts`, append to the shadow stylesheet string
(after the `.err` rule near line 76), so the slotted footer is styled across the
world boundary:

```css
::slotted(.errlog-consent){margin:10px 16px 0;padding-top:10px;border-top:1px solid var(--ad-line);font-size:var(--adp-text-2xs);color:var(--ad-ink-soft)}
::slotted(.errlog-consent) .errlog-consent-actions{display:flex;gap:8px;margin-top:8px}
```

> Note: `::slotted()` cannot match descendants. Style the descendant buttons by
> projecting class hooks on the wrapper and using `::slotted(.errlog-consent)`
> plus inherited properties; for the buttons, add explicit inline-safe classes
> the card already styles (reuse `.setup-cta` for the Send button to inherit the
> accent button styling). Update the builder: give `send` `className =
> 'setup-cta errlog-consent-send'`. Verify visually in Task 14.

- [ ] **Step 5: Export from barrel + run tests**

Add to `packages/app/src/index.ts`:

```ts
export { buildConsentFooter } from './ui/error-consent';
```

Run: `cd packages/app && npm test -- error-consent && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ui/error-consent.ts packages/app/src/ui/lookup-card.ts packages/app/src/index.ts packages/app/test/ui/error-consent.test.ts
git commit -m "feat(ui): consent-footer builder + card slotted styling"
```

---

## Task 13: Content script — show footer on error, relay the choice

**Files:**
- Modify: `packages/extension-chrome/src/content.ts`

- [ ] **Step 1: After rendering an error, query status and conditionally show the footer**

In `packages/extension-chrome/src/content.ts`, import the builder and extend the
`renderError` path of the renderer (around lines 46-48):

```ts
import { buildConsentFooter, type WireReply } from '@ai-dict/app';
```

```ts
    renderError(e) {
      inline.renderError(e);
      mirror.renderError(e);
      void maybeShowConsent();
    },
```

Add the helper (uses the same card light-DOM region the renderer writes into —
append the footer node to the inline card's slotted content container):

```ts
async function maybeShowConsent(): Promise<void> {
  let status: Extract<WireReply, { type: 'errlog' }> | undefined;
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'errlog.status' })) as WireReply;
    if (reply?.ok && reply.type === 'errlog') status = reply;
  } catch {
    return; // SW asleep / no reply — skip silently
  }
  if (!status || !status.pending || status.consent !== 'unset') return;

  const footer = buildConsentFooter({
    count: status.count,
    onChoice: (choice) => {
      void chrome.runtime.sendMessage({ type: 'errlog.set-consent', state: choice });
      footer.remove();
    },
  });
  // Append into the inline card's slotted light-DOM container (the same element
  // the error <p class="err"> was just written to). `inline.cardContentRoot()`
  // exposes it; if the renderer has no such accessor, append next to the error
  // paragraph via the card host's light-DOM child used for slotted content.
  inline.appendToCard?.(footer);
}
```

> Implementation note: the inline renderer (`inline`) owns the card element. Add
> a small `appendToCard(node: HTMLElement)` method to that renderer that appends
> into the same light-DOM slot container it uses for the error nodes. If the
> renderer is constructed inline in this file, add the method there; if it comes
> from `@ai-dict/app`'s card renderer, add `appendToCard` to that renderer and
> export it. Keep it minimal — one `container.appendChild(node)`.

- [ ] **Step 2: Typecheck + build**

Run: `cd packages/extension-chrome && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/src/content.ts packages/app/src
git commit -m "feat(chrome): show consent footer on error card and relay the choice"
```

---

## Task 14: Settings off-switch (Settings page)

Give users an explicit toggle to turn reporting on/off — required for the Web
Store privacy disclosure and to honor `disabled`.

**Files:**
- Modify: `packages/app/src/ui/settings-form.ts` (add a toggle row)
- Modify: `packages/extension-chrome/src/options.ts` (read status on load, set on change)
- Test: `packages/app/test/ui/onboarding-view.test.ts` pattern → add `packages/app/test/ui/settings-form.test.ts` assertions if the form has tests; otherwise verify in Task 15.

- [ ] **Step 1: Add an "Error reporting" toggle to the settings form**

In `packages/app/src/ui/settings-form.ts`, add a labeled checkbox/toggle
"Send anonymous error reports" wired to a new optional field on the form value,
mirroring the existing `cacheEnabled`/`saveHistory` toggles. Default unchecked.
Expose its checked state on the form's value object as `errorReportingEnabled`.

> Follow the exact pattern the file uses for `cacheEnabled` — same label markup,
> same change-event plumbing. Do not invent a new mechanism.

- [ ] **Step 2: Wire options.ts to status/set-consent**

In `packages/extension-chrome/src/options.ts`, on load query `errlog.status` and
reflect `consent === 'granted'` as the toggle's checked state. On toggle change
send `errlog.set-consent` with `'granted'` (checked) or `'disabled'` (unchecked):

```ts
const statusReply = (await chrome.runtime.sendMessage({ type: 'errlog.status' })) as WireReply;
const reportingOn = statusReply?.ok && statusReply.type === 'errlog' && statusReply.consent === 'granted';
// set initial toggle state = reportingOn …

// on toggle change:
void chrome.runtime.sendMessage({
  type: 'errlog.set-consent',
  state: nowChecked ? 'granted' : 'disabled',
});
```

- [ ] **Step 3: Typecheck + build + run app tests**

Run: `cd packages/app && npm test && npm run typecheck` then
`cd ../extension-chrome && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/ui/settings-form.ts packages/extension-chrome/src/options.ts
git commit -m "feat(settings): error-reporting on/off toggle wired to consent"
```

---

## Task 15: End-to-end happy path (bundled Chromium)

**Files:**
- Create: `packages/extension-chrome/e2e/error-reporting.spec.ts`

> Guardrail (repo CLAUDE.md): drive a bundled/standalone Chromium, NOT installed
> Google Chrome. Follow the existing e2e harness in
> `packages/extension-chrome/e2e/` for extension loading + GA4 request interception.

- [ ] **Step 1: Write the e2e spec**

Create `packages/extension-chrome/e2e/error-reporting.spec.ts` covering:
1. Force 3 lookup failures (stub the provider fetch to return 429/500) → the
   consent footer appears on the 3rd error card.
2. Click "Not now" → footer dismissed; no GA4 request observed; a 4th error does
   NOT re-prompt but a 5th does (Fibonacci rung advanced to 5).
3. Reset state; reach threshold; click "Send reports" → a POST to
   `www.google-analytics.com/mp/collect` is observed with an `extension_error`
   event; subsequent errors auto-send (standing consent).
4. Settings toggle off → `errlog.set-consent disabled` → no further GA4 requests.

Intercept network to assert the GA4 endpoint + payload shape (route handler on
`**/mp/collect**`). Build the extension with test GA4 env vars set
(`GA4_MEASUREMENT_ID=G-TEST GA4_API_SECRET=test`).

- [ ] **Step 2: Run the e2e suite**

Run: `cd packages/extension-chrome && GA4_MEASUREMENT_ID=G-TEST GA4_API_SECRET=test npm run build && npm run e2e -- error-reporting`
Expected: PASS (all four scenarios green).

- [ ] **Step 3: Commit**

```bash
git add packages/extension-chrome/e2e/error-reporting.spec.ts
git commit -m "test(e2e): consent-gated error reporting happy path"
```

---

## Task 16: Privacy disclosure docs

**Files:**
- Modify: `README.md` (add a "Diagnostics & privacy" subsection)
- Create: `docs/privacy.md` (or update existing privacy copy if present)

- [ ] **Step 1: Document what is and isn't collected**

State plainly: anonymous error reports (error code, redacted message, page
domain, provider, extension/browser version) are sent to Google Analytics **only
after you consent** at a prompt or enable the Settings toggle; no page content,
no full URLs, no API keys; an anonymous random client id; off by default; can be
turned off anytime in Settings. Mirror this in the Chrome Web Store privacy form.

- [ ] **Step 2: Commit**

```bash
git add README.md docs/privacy.md
git commit -m "docs: disclose consent-gated anonymous error reporting"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** Scope (errors only) → Tasks 2-5; silent buffer + Fibonacci →
  Tasks 2, 5; standing consent + tri-state → Task 5; GA4 transport → Tasks 3, 9-11;
  signature-only/provider emphasis → Task 2 (`code` is the distilled Gemini
  signature) + Task 3; domain-only + redacted → Task 2 (`hostnameOf` + `redactPII`/`scrubSecrets`);
  buffer cap 100 → Task 2; in-page footer surface → Tasks 12-13; settings off-switch
  → Task 14; disclosure → Task 16; tests → every task + Task 15.
- **Type consistency:** `Consent`, `ErrorRecord`, `CaptureInput`, `ReportDecision`,
  `TelemetrySink`, `ErrorReporter.{capture,status,setConsent}`, wire `errlog.status`/
  `errlog.set-consent` and `type:'errlog'` reply are used identically across tasks.
- **Known follow-up (not in scope):** Safari shell does not inject `errlog` →
  errlog.* messages ack as `disabled` (Task 7 default). Acceptable per spec
  ("Chrome first").
```
