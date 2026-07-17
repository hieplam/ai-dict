# A1 Streamed Answers Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clicking Define on a Gemini lookup shows the model's answer appearing progressively
(first partial text under ~1s, growing until complete) instead of a static spinner until the whole
answer lands; the card, the side panel mirror, and the final saved/cached/history data are all
otherwise byte-identical to today. OpenAI and Anthropic lookups, and any Gemini call that doesn't
ask for streaming (e.g. `connection.test`), are completely unmodified — same code path, same
timing, same output.

**Architecture:** a new, additive push channel — `lookup.chunk` messages — sits alongside the
existing one-shot `chrome.runtime.sendMessage({type:'lookup',...})` request/reply, which is never
modified. The service worker pushes chunks to the originating tab via `chrome.tabs.sendMessage`
(the exact mechanism A4's keyboard-command relay already uses, `sw.ts:189-196`), outside the
`WireMessageSchema`/`classifyInbound` wire protocol entirely — this card adds **zero** wire-message
arms, so CONTRACTS §2's "wire arm + router case = one task" rule does not apply. A brand-new file,
`gemini-streaming.ts`, does the actual SSE HTTP call; `runHttpLookup`/`http-lookup-client.ts` and
the OpenAI/Anthropic clients are never touched. Full design rationale, including both rejected
alternatives (a `chrome.runtime.connect` Port transport; streaming all three providers in v1):
`docs/superpowers/specs/2026-07-17-a1-streamed-answers-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- **Do not touch `packages/app/src/wire.ts`.** This card adds no `WireMessageSchema` arm. If a
  task in this plan seems to need one, stop — that means the "push message outside the wire
  protocol" design (spec §2) broke somewhere and the plan needs re-grounding, not an ad hoc schema
  edit.
- **Do not touch `packages/app/src/app/http-lookup-client.ts`,
  `packages/app/src/app/openai-lookup-client.ts`, or
  `packages/app/src/app/anthropic-lookup-client.ts`.** The design spec's §3/§4.2 pin streaming to
  Gemini only, in a brand-new, separate file — these three files must show **zero diff** at the
  end of this plan. Run `git diff --stat` against these three paths before the final commit and
  confirm it is empty.
- Every partial repaint MUST go through `sanitizeMarkdown()` (S4) — never assign raw model text to
  `innerHTML` and never introduce a second place that casts a string to `SafeHtml`.
- S1 is unaffected by this card (the key never appears in `LookupChunkMessage` or anywhere new) —
  do not add a key field to any new message/type in this plan.
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the streaming
  `CardState` branch reuses the card's existing `::slotted(h2)`/`.defined-as`/`.err` rules; no new
  CSS is added in this plan.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` green; from Task 8 on, also
  `cd packages/extension-chrome && bun run typecheck`.
- The e2e build must clear any ambient `GEMINI_API_KEY`
  (`GEMINI_API_KEY= bun run build:chrome:e2e`).
- Commit subject convention for every task in this plan:
  `feat: streamed answers — <task summary> (A1)`.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A1StreamedAnswers`.

---

### Task 1: shared types — `onChunk`/`renderPartial` ports + the `lookup.chunk` message shape

**Files:**

- Modify: `packages/app/src/ports.ts`
- Create: `packages/app/src/app/lookup-chunk-message.ts`
- Create: `packages/app/test/app/lookup-chunk-message.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
// ports.ts additions
interface LookupClient {
  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult>;
}
interface ResultRenderer {
  renderPartial?(
    word: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void;
}
// lookup-chunk-message.ts
interface LookupChunkMessage {
  type: 'lookup.chunk';
  requestId: string;
  markdown: string;
  definedAs?: { term: string; isIdiom: boolean };
}
function isLookupChunkMessage(msg: unknown): msg is LookupChunkMessage;
```

- [ ] **Step 1: Write the failing test.** Create `packages/app/test/app/lookup-chunk-message.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isLookupChunkMessage } from '../../src/app/lookup-chunk-message';

describe('lookup chunk message guard (A1)', () => {
  it('accepts a minimal chunk message', () => {
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 'r1', markdown: 'hi' })).toBe(
      true,
    );
  });

  it('accepts a chunk message with definedAs', () => {
    expect(
      isLookupChunkMessage({
        type: 'lookup.chunk',
        requestId: 'r1',
        markdown: 'hi',
        definedAs: { term: 'kick the bucket', isIdiom: true },
      }),
    ).toBe(true);
  });

  it('rejects a missing/wrong-typed requestId or markdown', () => {
    expect(isLookupChunkMessage({ type: 'lookup.chunk', markdown: 'hi' })).toBe(false);
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 'r1' })).toBe(false);
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 1, markdown: 'hi' })).toBe(
      false,
    );
  });

  it('rejects other shapes', () => {
    expect(isLookupChunkMessage({ type: 'lookup' })).toBe(false);
    expect(isLookupChunkMessage(null)).toBe(false);
    expect(isLookupChunkMessage(undefined)).toBe(false);
    expect(isLookupChunkMessage('lookup.chunk')).toBe(false);
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/lookup-chunk-message.test.ts`
Expected: failure — `../../src/app/lookup-chunk-message` does not exist.

- [ ] **Step 2: Implement.** Create `packages/app/src/app/lookup-chunk-message.ts`:

```ts
/**
 * A1 — streamed answers. A one-way push the service worker sends to the originating tab's
 * content script as a Gemini answer streams in, OUTSIDE the WireMessageSchema/classifyInbound
 * wire protocol entirely — mirrors command-messages.ts's CommandMessage exactly (A4's own
 * one-way SW -> content-script relay). requestId correlates a chunk to the in-flight lookup that
 * requested it (MessageRelayLookupClient.lookup's own requestId, message-relay-lookup-client.ts).
 * `markdown` is already stripped of any DEFINED_AS:/TRANSLATION: signal lines by the producer
 * (gemini-streaming.ts) — every consumer receives clean, directly-sanitizable body text.
 */
export interface LookupChunkMessage {
  type: 'lookup.chunk';
  requestId: string;
  markdown: string;
  /** A8: present once the model's DEFINED_AS line has resolved; same shape as LookupResult's. */
  definedAs?: { term: string; isIdiom: boolean };
}

function hasType(msg: unknown): msg is { type: unknown } {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isLookupChunkMessage(msg: unknown): msg is LookupChunkMessage {
  return (
    hasType(msg) &&
    msg.type === 'lookup.chunk' &&
    'requestId' in msg &&
    typeof (msg as { requestId: unknown }).requestId === 'string' &&
    'markdown' in msg &&
    typeof (msg as { markdown: unknown }).markdown === 'string'
  );
}
```

Modify `packages/app/src/ports.ts`: replace the `LookupClient` interface (currently lines 62-64)
with:

```ts
export interface LookupClient {
  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      /**
       * A1: called zero or more times with the accumulated, already-stripped-of-signal-lines
       * markdown as a Gemini answer streams in. Only GeminiLookupClient ever invokes this
       * (gemini-lookup-client.ts) — OpenAI/Anthropic clients never call it, which IS how "provider
       * can't stream, falls back silently" is implemented (design spec §3): no capability probe,
       * just whether the concrete client class ever calls the callback it was handed.
       */
      onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult>;
}
```

And replace the `ResultRenderer` interface (currently lines 50-60) with:

```ts
export interface ResultRenderer {
  renderLoading(word?: string): void;
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void;
  renderError(e: LookupError): void;
  /**
   * A1: an optional in-progress preview, called zero or more times between renderLoading and the
   * terminal renderResult/renderError. Optional — mirrors ResultRenderContext's own
   * onSwitchProvider/onForceLiteral precedent (both optional, lines 30/35 above) — so an
   * implementer that never streams (or a test fake) needs no change to keep compiling.
   */
  renderPartial?(
    word: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void;
  close(): void;
}
```

Modify `packages/app/src/index.ts`: add, right after the existing
`export * from './app/message-relay-lookup-client';` line (line 38):

```ts
export * from './app/lookup-chunk-message';
```

Run: `cd packages/app && bunx vitest run test/app/lookup-chunk-message.test.ts && bun run typecheck`
Expected: the new test file passes (4 tests); typecheck clean (no existing `LookupClient`/
`ResultRenderer` implementer breaks, since both new members are optional).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ports.ts packages/app/src/app/lookup-chunk-message.ts packages/app/test/app/lookup-chunk-message.test.ts packages/app/src/index.ts
git commit -m "feat: streamed answers — onChunk/renderPartial ports + lookup.chunk message shape (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 1/9'
```

---

### Task 2: `gemini-streaming.ts` — the SSE client + `gemini-lookup-client.ts` dispatch

**Files:**

- Create: `packages/app/src/app/gemini-streaming.ts`
- Create: `packages/app/test/app/gemini-streaming.test.ts`
- Modify: `packages/app/src/app/gemini-lookup-client.ts`
- Modify: `packages/app/test/app/gemini-lookup-client.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export interface GeminiStreamSpec {
  endpoint: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (prompt: string, model: string) => string;
}
export function runGeminiStreamingLookup(
  spec: GeminiStreamSpec,
  deps: HttpLookupDeps,
  req: LookupRequest,
  onChunk: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void,
  opts?: { signal?: AbortSignal },
): Promise<LookupResult>;
```

- [ ] **Step 1: Write the failing tests.** First, extend `ResponseLike` usage: this test needs a
      fake `Response`-shaped object exposing a real `ReadableStream<Uint8Array>` as `.body`, which
      `http-lookup-client.ts`'s existing `ResponseLike` (`.json()` only) does not model — this test
      file defines its own local fake shape, it does not modify `http-lookup-client.ts`. Create
      `packages/app/test/app/gemini-streaming.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runGeminiStreamingLookup, type GeminiStreamSpec } from '../../src/app/gemini-streaming';
import { isLookupError, type LookupRequest } from '../../src';

const req: LookupRequest = {
  word: 'bank',
  context: 'river bank',
  url: 'https://x',
  title: 'T',
  target: 'vi',
  outputFormat: 'Define {word} in {target_lang}: {context}',
  promptEnvelope: '',
};

const spec: GeminiStreamSpec = {
  endpoint: 'https://stream.example/gemini',
  model: 'gemini-2.5-flash',
  headers: (apiKey) => ({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey }),
  body: (prompt) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
};

function sseEvent(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
}

/** A real ReadableStream<Uint8Array>, chunked exactly per `pieces` — gives fully deterministic,
 * non-flaky control over how many reader.read() calls occur (design spec §7.1). */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= pieces.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(pieces[i]!));
      i++;
    },
  });
}

function okFetch(pieces: string[]) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.reject(new Error('should not be called on the streaming OK path')),
      body: streamOf(pieces),
    }),
  );
}

function client(fetchImpl: ReturnType<typeof okFetch>, timeoutMs?: number) {
  return {
    fetch: fetchImpl as unknown as typeof fetch extends never ? never : never,
  };
}

describe('runGeminiStreamingLookup', () => {
  it('accumulates three SSE events split across two reads into the final markdown', async () => {
    const onChunk = vi.fn();
    const fetchImpl = okFetch([
      sseEvent('DEFINED_AS: "bank" | literal\n') + sseEvent('TRANSLATION: "bờ sông"\n\n'),
      sseEvent('The land ') + sseEvent('alongside a river.'),
    ]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const result = await runGeminiStreamingLookup(spec, deps, req, onChunk);
    expect(result.markdown).toBe('The land alongside a river.');
    expect(result.definedAs).toEqual({ term: 'bank', isIdiom: false });
    expect(result.translation).toBe('bờ sông');
    expect(result.provider).toBe('gemini');
    expect(result.fromCache).toBe(false);
    // At least one call after the header resolved, with strictly growing text.
    expect(onChunk.mock.calls.length).toBeGreaterThanOrEqual(1);
    const texts = onChunk.mock.calls.map((c) => c[0] as string);
    for (let i = 1; i < texts.length; i++)
      expect(texts[i]!.length).toBeGreaterThanOrEqual(texts[i - 1]!.length);
  });

  it('never exposes a partial/incomplete DEFINED_AS line to onChunk', async () => {
    const onChunk = vi.fn();
    // Split mid-line: "DEFINED_AS: \"ba" then "nk\" | literal\n" then the body.
    const fetchImpl = okFetch([
      'data: ' +
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'DEFINED_AS: "ba' }] } }] }) +
        '\n\n',
      sseEvent('nk" | literal\n\n') + sseEvent('A riverbank.'),
    ]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    await runGeminiStreamingLookup(spec, deps, req, onChunk);
    for (const call of onChunk.mock.calls) {
      expect(call[0] as string).not.toContain('DEFINED_AS');
    }
  });

  it('starts streaming once HEADER_MAX_BUFFER_CHARS is exceeded with no signal lines at all', async () => {
    const onChunk = vi.fn();
    const longPlainText = 'x'.repeat(450); // > HEADER_MAX_BUFFER_CHARS, no DEFINED_AS/TRANSLATION
    const fetchImpl = okFetch([sseEvent(longPlainText)]);
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const result = await runGeminiStreamingLookup(spec, deps, req, onChunk);
    expect(onChunk).toHaveBeenCalled();
    expect(result.markdown).toBe(longPlainText);
    expect(result.definedAs).toBeUndefined();
  });

  it('maps a non-OK response before any stream starts through mapError, like the non-streaming path', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '12' : null) },
        json: () =>
          Promise.resolve({ error: { status: 'RESOURCE_EXHAUSTED', message: 'slow down' } }),
        body: null,
      }),
    );
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const err = await runGeminiStreamingLookup(spec, deps, req, vi.fn()).catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('RATE_LIMIT');
    expect((err as { retryAfterSec: number }).retryAfterSec).toBe(12);
  });

  it('rejects with the caller abort reason when opts.signal aborts mid-stream', async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          ac.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key' };
    const p = runGeminiStreamingLookup(spec, deps, req, vi.fn(), { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });

  it('maps a stall past the timeout to a timeout LookupError', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {})); // never resolves
    const deps = { fetch: fetchImpl, getApiKey: () => 'AIza-key', timeoutMs: 5 };
    const err = await runGeminiStreamingLookup(spec, deps, req, vi.fn()).catch((e: unknown) => e);
    expect(isLookupError(err)).toBe(true);
    expect((err as { code: string }).code).toBe('NETWORK');
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/gemini-streaming.test.ts`
Expected: failure — `../../src/app/gemini-streaming` does not exist. (Delete the unused `client()`
helper above before implementing if the linter flags it as dead code — it is left from drafting
and is not referenced by any test; remove it.)

- [ ] **Step 2: Implement.** Create `packages/app/src/app/gemini-streaming.ts`:

```ts
import {
  mapError,
  buildPrompt,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';
import { parseDefinedAs } from '../domain/defined-as';
import { parseTranslation } from '../domain/translation-line';
import type { HttpLookupDeps } from './http-lookup-client';

// Same DEFAULT_TIMEOUT_MS budget as the non-streaming path (http-lookup-client.ts:12) — covers
// the WHOLE stream, not per-chunk: no new "stalled chunk" timeout is invented (design spec §4.2).
const STREAM_TIMEOUT_MS = 20000;

// Withhold the first partial repaint until the DEFINED_AS + TRANSLATION signal lines (emitted
// FIRST by the prompt: default-template.ts:43-45,64-65) are fully resolved, or this many raw
// characters have accumulated with no match — generous headroom over the longest realistic
// DEFINED_AS + TRANSLATION line pair, so a legacy/custom prompt envelope that never emits them
// still starts streaming promptly (see parseDefinedAs/parseTranslation's own documented
// "body is the ENTIRE text unchanged" fallback).
const HEADER_MAX_BUFFER_CHARS = 400;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

// Throw an Error instance carrying LookupError fields, satisfying @typescript-eslint/only-throw-error
// — mirrors http-lookup-client.ts's own rejectWith exactly.
function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e);
}
function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e;
}

export interface GeminiStreamSpec {
  endpoint: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (prompt: string, model: string) => string;
}

/**
 * A1: Gemini's SSE streaming client — a separate function from runHttpLookup (http-lookup-client.ts),
 * deliberately, so http-lookup-client.ts / openai-lookup-client.ts / anthropic-lookup-client.ts stay
 * byte-for-byte unchanged (design spec §4.2's rationale). Calls `onChunk` zero or more times with
 * the accumulated markdown, ALREADY stripped of DEFINED_AS:/TRANSLATION: signal lines, once those
 * lines (or HEADER_MAX_BUFFER_CHARS) have resolved. Returns the exact same LookupResult shape
 * runHttpLookup returns, built via the identical parseDefinedAs/parseTranslation tail.
 */
export async function runGeminiStreamingLookup(
  spec: GeminiStreamSpec,
  deps: HttpLookupDeps,
  req: LookupRequest,
  onChunk: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void,
  opts?: { signal?: AbortSignal },
): Promise<LookupResult> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) rejectWith(mapError({ kind: 'no-key', provider: 'gemini' }));
  if (navigator.onLine === false) rejectWith(mapError({ kind: 'offline' }));

  const prompt = buildPrompt(
    req.outputFormat,
    {
      word: req.word,
      context: req.context,
      target_lang: req.target,
      url: req.url,
      title: req.title,
    },
    req.promptEnvelope,
    req.forceLiteral,
  );
  const body = spec.body(prompt, spec.model);

  const ac = new AbortController();
  const onAbort = (): void => ac.abort(opts?.signal?.reason);
  if (opts?.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new DOMException('timeout', 'TimeoutError'));
  }, deps.timeoutMs ?? STREAM_TIMEOUT_MS);

  try {
    const res = await deps.fetch(spec.endpoint, {
      method: 'POST',
      headers: spec.headers(apiKey),
      body,
      signal: ac.signal,
    });

    if (!res.ok) {
      // Identical shape to http-lookup-client.ts:118-144: a rejected/malformed request fails
      // BEFORE any SSE stream begins, so Gemini returns one plain JSON error body, not SSE.
      let geminiStatus: string | undefined;
      let vendorMessage: string | undefined;
      try {
        const errJson = (await res.json()) as GeminiErrBody;
        geminiStatus = errJson.error?.status;
        vendorMessage = errJson.error?.message;
      } catch {
        /* non-JSON body: map by status alone */
      }
      const ra = res.headers.get('retry-after');
      const retryAfterSec = ra !== null ? Number(ra) : NaN;
      rejectWith(
        mapError({
          kind: 'http',
          status: res.status,
          provider: 'gemini',
          ...(geminiStatus !== undefined ? { geminiStatus } : {}),
          ...(vendorMessage !== undefined ? { vendorMessage } : {}),
          ...(!Number.isNaN(retryAfterSec) ? { retryAfterSec } : {}),
        }),
      );
    }
    const streamBody = (res as unknown as { body: ReadableStream<Uint8Array> | null }).body;
    if (!streamBody) rejectWith(mapError({ kind: 'parse', provider: 'gemini' }));

    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let sseTail = '';
    let headerResolved = false;
    let resolvedDefinedAs: { term: string; isIdiom: boolean } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseTail += decoder.decode(value, { stream: true });
      const events = sseTail.split('\n\n');
      sseTail = events.pop() ?? '';
      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice('data: '.length).trim();
        if (payload.length === 0) continue;
        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // a malformed frame is skipped, not fatal — later frames still accumulate
        }
        const delta = (json as GeminiOkBody).candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof delta === 'string') raw += delta;

        if (!headerResolved) {
          const { definedAs, body: afterDefined } = parseDefinedAs(raw);
          const { translation, body: afterBoth } = parseTranslation(afterDefined);
          const bothResolved = definedAs !== undefined && translation !== undefined;
          if (bothResolved || raw.length >= HEADER_MAX_BUFFER_CHARS) {
            headerResolved = true;
            resolvedDefinedAs = definedAs;
            onChunk(afterBoth, resolvedDefinedAs);
          }
        } else {
          const { body: afterDefined } = parseDefinedAs(raw);
          const { body: afterBoth } = parseTranslation(afterDefined);
          onChunk(afterBoth, resolvedDefinedAs);
        }
      }
    }

    if (raw.length === 0) rejectWith(mapError({ kind: 'parse', provider: 'gemini' }));
    const { definedAs, body: afterDefinedAs } = parseDefinedAs(raw);
    const { translation, body: parsedBody } = parseTranslation(afterDefinedAs);
    return {
      markdown: parsedBody,
      word: req.word,
      target: req.target,
      model: spec.model,
      provider: 'gemini',
      fromCache: false,
      fetchedAt: Date.now(),
      ...(definedAs !== undefined ? { definedAs } : {}),
      ...(translation !== undefined ? { translation } : {}),
    };
  } catch (err) {
    if (opts?.signal?.aborted && !isThrownLookupError(err)) throw err;
    if (timedOut) rejectWith(mapError({ kind: 'timeout' }));
    if (isThrownLookupError(err)) throw err;
    rejectWith(mapError({ kind: 'offline' }));
  } finally {
    clearTimeout(timer);
    if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
  }
  return rejectWith(mapError({ kind: 'offline' })); // unreachable; mirrors http-lookup-client.ts:182-184
}
```

`HttpLookupDeps` (imported, unchanged) already has the exact `{ fetch, getApiKey, timeoutMs? }`
shape this file needs — no change to `http-lookup-client.ts` required to reuse its type. Remove the
unused `client()` helper from the test file drafted in Step 1 if the linter flags it.

Run: `cd packages/app && bunx vitest run test/app/gemini-streaming.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 3: Wire `GeminiLookupClient` to dispatch to it.** Modify
      `packages/app/src/app/gemini-lookup-client.ts` in full:

```ts
import type { LookupClient, LookupRequest, LookupResult } from '../index';
import { runHttpLookup, type HttpLookupDeps } from './http-lookup-client';
import { runGeminiStreamingLookup } from './gemini-streaming';

// Re-exported for the existing test import path (`src/app/gemini-lookup-client`); the fetch
// abstraction now lives in the shared http-lookup-client helper.
export type { FetchLike, ResponseLike } from './http-lookup-client';

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
// A1: streaming endpoint, same model — exported so gemini-streaming.test.ts / other callers can
// reference it without duplicating the literal.
export const MODEL = 'gemini-2.5-flash';
const STREAM_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

export type GeminiDeps = HttpLookupDeps;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

const HEADERS = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-Goog-Api-Key': apiKey,
});
const BODY = (prompt: string): string =>
  JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });

export class GeminiLookupClient implements LookupClient {
  constructor(private readonly deps: GeminiDeps) {}

  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult> {
    // A1: the ONLY dispatch condition — no settings flag, no capability probe (design spec §3).
    if (opts?.onChunk) {
      return runGeminiStreamingLookup(
        { endpoint: STREAM_ENDPOINT, model: MODEL, headers: HEADERS, body: BODY },
        this.deps,
        req,
        opts.onChunk,
        opts,
      );
    }
    // Unchanged non-streaming path — byte-identical to the pre-A1 implementation.
    return runHttpLookup(
      {
        provider: 'gemini',
        endpoint: ENDPOINT,
        model: MODEL,
        headers: HEADERS,
        body: BODY,
        parseOk: (json) => (json as GeminiOkBody).candidates?.[0]?.content?.parts?.[0]?.text,
        parseErr: (json) => {
          const err = (json as GeminiErrBody).error;
          return {
            ...(err?.status !== undefined ? { geminiStatus: err.status } : {}),
            ...(err?.message !== undefined ? { vendorMessage: err.message } : {}),
          };
        },
      },
      this.deps,
      req,
      opts,
    );
  }
}
```

- [ ] **Step 4: Extend `gemini-lookup-client.test.ts`.** Add, inside the existing top-level
      `describe` block (after the existing tests, do not remove or modify any of them — they are
      the regression guard proving the non-streaming path is unchanged):

```ts
import { runGeminiStreamingLookup } from '../../src/app/gemini-streaming';

// ... inside describe(...):

it('with opts.onChunk, dispatches to the streaming endpoint (A1)', async () => {
  const fetchImpl: FetchLike = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.reject(new Error('non-streaming path should not be used')),
      body: new ReadableStream({
        start(controller) {
          const chunk =
            'data: ' +
            JSON.stringify({ candidates: [{ content: { parts: [{ text: '# def' }] } }] }) +
            '\n\n';
          controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
    } as unknown as ReturnType<FetchLike> extends Promise<infer R> ? R : never),
  );
  const c = client(fetchImpl);
  const result = await c.lookup(req, { onChunk: vi.fn() });
  expect(result.markdown).toBe('# def');
  expect(fetchImpl).toHaveBeenCalledWith(
    expect.stringContaining(':streamGenerateContent?alt=sse'),
    expect.anything(),
  );
});

it('with no opts.onChunk, still uses the unchanged non-streaming endpoint (A1 regression guard)', async () => {
  const fetchImpl = vi.fn(() => Promise.resolve(res({ ok: true, status: 200, body: okBody })));
  const c = client(fetchImpl);
  await c.lookup(req);
  expect(fetchImpl).toHaveBeenCalledWith(
    expect.not.stringContaining('streamGenerateContent'),
    expect.anything(),
  );
});
```

Run: `cd packages/app && bunx vitest run test/app/gemini-streaming.test.ts test/app/gemini-lookup-client.test.ts`
Expected: all tests pass, including every pre-existing `gemini-lookup-client.test.ts` test
unmodified.

Modify `packages/app/src/index.ts`: add, right after
`export * from './app/gemini-lookup-client';` (line 28):

```ts
export * from './app/gemini-streaming';
```

- [ ] **Step 5: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
git diff --stat packages/app/src/app/http-lookup-client.ts packages/app/src/app/openai-lookup-client.ts packages/app/src/app/anthropic-lookup-client.ts
```

The last command MUST print nothing (empty diff) — if it prints anything, stop and re-check
Step 3's `GeminiLookupClient` edit did not accidentally touch a shared file.

Commit:

```
git add packages/app/src/app/gemini-streaming.ts packages/app/test/app/gemini-streaming.test.ts packages/app/src/app/gemini-lookup-client.ts packages/app/test/app/gemini-lookup-client.test.ts packages/app/src/index.ts
git commit -m "feat: streamed answers — Gemini SSE streaming client + dispatch (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 2/9'
```

---

### Task 3: `router.ts` — `onLookupChunk` wiring

**Files:**

- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
interface RouterDeps {
  onLookupChunk?: (
    requestId: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ) => void;
}
```

- [ ] **Step 1: Write the failing test.** Add, inside `router.test.ts`'s existing `describe`
      block:

```ts
it('forwards client.lookup onChunk calls to deps.onLookupChunk, keyed by requestId (A1)', async () => {
  const onLookupChunk = vi.fn();
  const d = deps({
    client: {
      lookup: makeLookupMock((_req, opts) => {
        opts?.onChunk?.('partial one');
        opts?.onChunk?.('partial one two');
        return Promise.resolve(result);
      }),
    },
  });
  const router = buildRouter({ ...d, onLookupChunk });
  await router(lookupMsg('r1'));
  expect(onLookupChunk).toHaveBeenNthCalledWith(1, 'r1', 'partial one', undefined);
  expect(onLookupChunk).toHaveBeenNthCalledWith(2, 'r1', 'partial one two', undefined);
});

it('never forwards a chunk for a requestId that lookup.cancel already marked cancelled (A1)', async () => {
  const onLookupChunk = vi.fn();
  let capturedOnChunk: ((md: string) => void) | undefined;
  const d = deps({
    client: {
      lookup: makeLookupMock((_req, opts) => {
        capturedOnChunk = opts?.onChunk;
        return new Promise(() => {}); // never resolves; cancel fires while this is in flight
      }),
    },
  });
  const router = buildRouter({ ...d, onLookupChunk });
  void router(lookupMsg('r2'));
  await Promise.resolve(); // let handleLookup register the controller + reach client.lookup
  router({ type: 'lookup.cancel', requestId: 'r2' });
  capturedOnChunk?.('should not be forwarded');
  expect(onLookupChunk).not.toHaveBeenCalled();
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: failures — `onLookupChunk` is never called (not wired yet).

- [ ] **Step 2: Implement.** In `packages/app/src/app/router.ts`, add to `RouterDeps` (currently
      lines 41-71), right after the existing `now?` field:

```ts
  /**
   * A1: called zero or more times per in-flight lookup as a streaming provider's answer arrives.
   * Optional — a shell that never streams (or hasn't wired the SW->content push yet) omits it.
   * Injected by the composition root (sw.ts): it owns HOW a chunk reaches the originating tab
   * (chrome.tabs.sendMessage), which this pure router has no business knowing about.
   */
  onLookupChunk?: (
    requestId: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ) => void;
```

And replace `handleLookup`'s single `const result = await deps.client.lookup(req, { signal:
controller.signal });` line (currently line 133) with:

```ts
const result = await deps.client.lookup(req, {
  signal: controller.signal,
  // A1: forward to the composition root's push mechanism, but never for a requestId
  // lookup.cancel has already marked — mirrors the `cancelled.has(requestId)` check just
  // below this call, so a cancelled lookup's stray late chunks are dropped at the source.
  onChunk: (md, definedAs) => {
    if (!cancelled.has(requestId)) deps.onLookupChunk?.(requestId, md, definedAs);
  },
});
```

Run: `cd packages/app && bunx vitest run test/app/router.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/router.ts packages/app/test/app/router.test.ts
git commit -m "feat: streamed answers — router onLookupChunk wiring (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 3/9'
```

---

### Task 4: `workflow.ts` — wire `onChunk` to `renderer.renderPartial`

**Files:**

- Modify: `packages/app/src/domain/workflow.ts`
- Modify: `packages/app/test/fakes/index.ts`
- Modify: `packages/app/test/workflow.test.ts`

- [ ] **Step 1: Extend the shared fake first (needed by the failing test).** In
      `packages/app/test/fakes/index.ts`, replace the `FakeResultRenderer` class body with:

```ts
export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastCtx: ResultRenderContext | undefined;
  lastError: LookupError | null = null;
  loadingWord: string | undefined;
  // A1: every renderPartial call, in order — [word, markdownSoFar, definedAs].
  partials: [string, string, { term: string; isIdiom: boolean } | undefined][] = [];
  renderLoading(word?: string) {
    this.calls.push('loading');
    this.loadingWord = word;
  }
  renderResult(r: LookupResult, ctx?: ResultRenderContext) {
    this.calls.push('result');
    this.lastResult = r;
    this.lastCtx = ctx;
  }
  renderError(e: LookupError) {
    this.calls.push('error');
    this.lastError = e;
  }
  renderPartial(
    word: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ) {
    this.calls.push('partial');
    this.partials.push([word, markdownSoFar, definedAs]);
  }
  close() {
    this.calls.push('close');
  }
}
```

- [ ] **Step 2: Write the failing test.** Add, inside `workflow.test.ts`'s existing `describe('runLookupWorkflow', ...)`
      block:

```ts
it('forwards client.lookup onChunk calls to renderer.renderPartial with the selected word (A1)', async () => {
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient((_req, opts) => {
    opts?.onChunk?.('partial def', undefined);
    return Promise.resolve({
      markdown: 'full def',
      word: 'bank',
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1,
    });
  });
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const settings = new FakeSettingsStore({
    targetLang: 'vi',
    outputFormat: 'tpl',
    promptEnvelope: '',
    hasKey: true,
    theme: 'sepia',
    configuredProviders: ['gemini'],
  });
  runLookupWorkflow({ selection, trigger, renderer, client, settings });
  selection.emit({
    text: 'bank',
    sentence: 'river bank',
    url: '',
    title: '',
    anchor: { x: 0, y: 0, w: 0, h: 0 },
  });
  trigger.click();
  await vi.waitFor(() => expect(renderer.calls).toContain('result'));
  expect(renderer.partials).toEqual([['bank', 'partial def', undefined]]);
});

it('drops a chunk that resolves after a newer selection has aborted this run (A1)', async () => {
  const renderer = new FakeResultRenderer();
  let capturedOnChunk: ((md: string) => void) | undefined;
  const client = new FakeLookupClient((req, opts) => {
    if (req.word === 'first') {
      capturedOnChunk = opts?.onChunk;
      return new Promise(() => {}); // never resolves; superseded before it would
    }
    return Promise.resolve({
      markdown: 'second def',
      word: 'second',
      target: 'vi',
      model: 'gemini-2.5-flash',
      fromCache: false,
      fetchedAt: 1,
    });
  });
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const settings = new FakeSettingsStore({
    targetLang: 'vi',
    outputFormat: 'tpl',
    promptEnvelope: '',
    hasKey: true,
    theme: 'sepia',
    configuredProviders: ['gemini'],
  });
  runLookupWorkflow({ selection, trigger, renderer, client, settings });
  selection.emit({
    text: 'first',
    sentence: 's',
    url: '',
    title: '',
    anchor: { x: 0, y: 0, w: 0, h: 0 },
  });
  trigger.click();
  await Promise.resolve();
  selection.emit({
    text: 'second',
    sentence: 's',
    url: '',
    title: '',
    anchor: { x: 0, y: 0, w: 0, h: 0 },
  });
  trigger.click();
  await vi.waitFor(() => expect(renderer.calls).toContain('result'));
  capturedOnChunk?.('stale, should not render');
  expect(renderer.partials).toEqual([]);
});
```

(Check the top of `workflow.test.ts` for the exact existing `SelectionEvent`/anchor shape and
`FakeSettingsStore`/`FakeLookupClient`/`FakeSelectionSource`/`FakeTriggerUI` import path — reuse
them verbatim; do not redefine.)

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: failures — `renderer.partials` stays empty (not wired yet).

- [ ] **Step 3: Implement.** In `packages/app/src/domain/workflow.ts`, replace the single line
      `const result = await deps.client.lookup(req, { signal: controller.signal });` (currently
      line 80) with:

```ts
const result = await deps.client.lookup(req, {
  signal: controller.signal,
  // A1: forward streaming previews to the renderer, guarded exactly like the terminal
  // renderResult call three lines below — a chunk that resolves after a NEWER selection has
  // already aborted this run must never repaint a stale card.
  onChunk: (md, definedAs) => {
    if (!controller.signal.aborted) deps.renderer.renderPartial?.(e.text, md, definedAs);
  },
});
```

Run: `cd packages/app && bunx vitest run test/workflow.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/workflow.ts packages/app/test/fakes/index.ts packages/app/test/workflow.test.ts
git commit -m "feat: streamed answers — workflow wires onChunk to renderer.renderPartial (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 4/9'
```

---

### Task 5: `lookup-card.ts` — `'streaming'` `CardState` + accessibility fix

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

```ts
type CardState =
  | { kind: 'loading'; word?: string }
  | { kind: 'result' /* unchanged */ }
  | {
      kind: 'streaming';
      word: string;
      safeHtml: SafeHtml;
      definedAs?: { term: string; isIdiom: boolean };
    }
  | { kind: 'error'; error: LookupError };
```

- [ ] **Step 1: Write the failing tests.** Add, inside `lookup-card.test.ts`'s existing top-level
      `describe` block (check the file's existing helper for building a sanitized-looking
      `SafeHtml` test value and reuse it — do not hand-cast a raw string without going through
      that helper's pattern):

```ts
describe('renderCardState — streaming (A1)', () => {
  it('renders the headword + sanitized body and nothing interactive', () => {
    const nodes = renderCardState({
      kind: 'streaming',
      word: 'bank',
      safeHtml: '<p>The land alongside a river.</p>' as SafeHtml,
    });
    const wrap = document.createElement('div');
    wrap.append(...nodes);
    expect(wrap.querySelector('h2')!.textContent).toBe('bank');
    expect(wrap.textContent).toContain('The land alongside a river.');
    expect(wrap.querySelector('.save-row')).toBeNull();
    expect(wrap.querySelector('.status-btn')).toBeNull();
    expect(wrap.querySelector('.nudge-row')).toBeNull();
    expect(wrap.querySelector('.meta-row')).toBeNull();
  });

  it('shows the defined-as label without the literal-word button while streaming', () => {
    const nodes = renderCardState({
      kind: 'streaming',
      word: 'bucket',
      safeHtml: '<p>...</p>' as SafeHtml,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    });
    const wrap = document.createElement('div');
    wrap.append(...nodes);
    expect(wrap.querySelector('.defined-as__label')!.textContent).toContain('kick the bucket');
    expect(wrap.querySelector('.defined-as__literal-btn')).toBeNull();
  });
});

describe('LookupCard — data-streaming aria-live toggle (A1)', () => {
  it('flips the region aria-live between "off" and "polite"', () => {
    const el = document.createElement('lookup-card') as LookupCard;
    document.body.append(el);
    const region = el.shadowRoot!.querySelector('.region')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    el.toggleAttribute('data-streaming', true);
    expect(region.getAttribute('aria-live')).toBe('off');
    el.toggleAttribute('data-streaming', false);
    expect(region.getAttribute('aria-live')).toBe('polite');
    el.remove();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: failures — the `'streaming'` kind doesn't type-check/render, and the `data-streaming`
attribute has no observed effect yet.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:

1. Extend the `CardState` union (currently lines 30-55) — insert a new member between the
   `'result'` and `'error'` variants:

```ts
  | {
      kind: 'streaming';
      word: string;
      safeHtml: SafeHtml;
      /** A8: shown as soon as the header resolves; same shape as the 'result' variant's field. */
      definedAs?: { term: string; isIdiom: boolean };
    }
```

2. Give `renderDefinedAsRow` (currently lines 296-312) a second, optional parameter defaulting to
   today's behavior:

```ts
function renderDefinedAsRow(
  definedAs: { term: string; isIdiom: boolean },
  interactive = true,
): HTMLElement | null {
  if (!definedAs.isIdiom) return null;
  const row = document.createElement('div');
  row.className = 'defined-as';
  const label = document.createElement('span');
  label.className = 'defined-as__label';
  label.textContent = `Defined as "${definedAs.term}" (idiom)`;
  row.append(label);
  if (interactive) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'defined-as__literal-btn';
    btn.textContent = 'Show literal word';
    btn.addEventListener('click', () =>
      btn.dispatchEvent(new CustomEvent('force-literal', { bubbles: true, composed: true })),
    );
    row.append(btn);
  }
  return row;
}
```

3. In `renderCardState` (currently lines 240-288), add a new branch — insert it right after the
   existing `if (state.kind === 'error') { ... }` block and before the final `'result'` handling
   code:

```ts
if (state.kind === 'streaming') {
  const h = document.createElement('h2');
  h.textContent = state.word;
  const body = document.createElement('div');
  body.innerHTML = state.safeHtml; // trusted: sanitized upstream (S4)
  const nodes: Node[] = [h];
  // A8: label only, no "Show literal word" button — a re-run mid-stream would start a second,
  // overlapping fetch (design spec §4.8).
  const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs, false) : null;
  if (definedAsRow) nodes.push(definedAsRow);
  nodes.push(body);
  return nodes;
}
```

4. Add the accessibility lifecycle hooks to the `LookupCard` class (currently lines 505-595) —
   insert right after `connectedCallback` (which ends at line 550):

```ts
  static get observedAttributes(): string[] {
    return ['data-streaming'];
  }

  /**
   * A1: while streaming, the light-DOM content inside the shadow region's aria-live="polite"
   * wrapper mutates far too often (throttled to ~80ms, inline-bottom-sheet-renderer.ts) for a
   * screen reader to usefully announce every change — flip the live region to aria-live="off" for
   * the duration and back to "polite" the instant a terminal state renders. data-streaming is a
   * shared-DOM ATTRIBUTE (crosses the MV3 MAIN/isolated-world boundary, unlike a JS property —
   * same fact data-ad-theme already relies on, see inline-bottom-sheet-renderer.ts's theme setter).
   */
  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (name !== 'data-streaming' || !this.shadowRoot) return;
    this.shadowRoot.querySelector('.region')?.setAttribute('aria-live', next !== null ? 'off' : 'polite');
  }
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "feat: streamed answers — streaming CardState + aria-live toggle on lookup-card (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 5/9'
```

---

### Task 6: `inline-bottom-sheet-renderer.ts` — `renderPartial` + throttle

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:**

```ts
class InlineBottomSheetRenderer implements ResultRenderer {
  constructor(
    host: HTMLElement,
    sanitize?: (md: string) => SafeHtml,
    opts?: { sidePanel?: boolean },
    now?: () => number,
  );
  renderPartial(
    word: string,
    markdown: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void;
}
```

- [ ] **Step 1: Write the failing tests.** Add, inside `inline-bottom-sheet-renderer.test.ts`'s
      existing `describe` block:

```ts
describe('renderPartial (A1)', () => {
  it('paints a streaming CardState with the sanitized body and no interactive rows', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderPartial('bank', '**The land** alongside a river.');
    const c = card(h);
    expect(c.querySelector('h2')!.textContent).toBe('bank');
    expect(c.textContent).toContain('The land alongside a river.');
    expect(c.querySelector('.save-row')).toBeNull();
  });

  it('sets data-streaming on the card host while streaming, clears it on renderResult/renderError/close', () => {
    const h = host();
    const r = new InlineBottomSheetRenderer(h);
    r.renderPartial('bank', 'partial');
    expect(card(h).hasAttribute('data-streaming')).toBe(true);
    r.renderResult(result);
    expect(card(h).hasAttribute('data-streaming')).toBe(false);
    r.renderPartial('bank', 'partial again');
    expect(card(h).hasAttribute('data-streaming')).toBe(true);
    r.renderError(error);
    expect(card(h).hasAttribute('data-streaming')).toBe(false);
  });

  it('throttles repaints under the 80ms floor, using the injected clock', () => {
    const h = host();
    let t = 0;
    const r = new InlineBottomSheetRenderer(h, undefined, {}, () => t);
    r.renderLoading('bank');
    t = 0;
    r.renderPartial('bank', 'a');
    expect(card(h).textContent).toContain('a');
    t = 10; // under the 80ms floor
    r.renderPartial('bank', 'ab');
    expect(card(h).textContent).not.toContain('ab');
    t = 90; // past the floor from the last PAINTED call (t=0)
    r.renderPartial('bank', 'abc');
    expect(card(h).textContent).toContain('abc');
  });

  it('renderLoading resets the throttle clock so the next lookup always paints its first frame', () => {
    const h = host();
    let t = 0;
    const r = new InlineBottomSheetRenderer(h, undefined, {}, () => t);
    r.renderPartial('bank', 'a');
    t = 5; // still under 80ms of the previous lookup's timing
    r.renderLoading('shore');
    r.renderPartial('shore', 'b');
    expect(card(h).textContent).toContain('b');
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: failures — `renderPartial` does not exist yet.

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`:

1. Extend the constructor and add the throttle field, right after the existing `lastState` field
   declaration (currently line 24):

```ts
  // A1: throttle floor between two renderPartial repaints — a dropped intermediate frame is
  // always safe (design spec §4.9): the very next partial, or the unthrottled terminal
  // renderResult call, supersedes it a moment later.
  private readonly THROTTLE_MS = 80;
  private lastPartialPaintAt = -Infinity;

  constructor(
    private readonly host: HTMLElement,
    private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
    private readonly opts: { sidePanel?: boolean } = {},
    private readonly now: () => number = () => Date.now(),
  ) {}
```

(This REPLACES the existing constructor, currently lines 26-30.)

2. Add one line to the top of `renderLoading` (currently lines 84-86):

```ts
  renderLoading(word?: string): void {
    this.lastPartialPaintAt = -Infinity; // A1: a stale timestamp from a prior lookup must never
                                          // throttle this new lookup's very first partial repaint
    this.setState(word === undefined ? { kind: 'loading' } : { kind: 'loading', word });
  }
```

3. Add the new method, right after `renderLoading`:

```ts
  /**
   * A1: an in-progress preview between renderLoading and the terminal renderResult/renderError.
   * `markdown` is ALREADY stripped of DEFINED_AS:/TRANSLATION: signal lines by the producer
   * (gemini-streaming.ts) — sanitized here, same trust boundary as renderResult (S4).
   */
  renderPartial(word: string, markdown: string, definedAs?: { term: string; isIdiom: boolean }): void {
    const t = this.now();
    if (t - this.lastPartialPaintAt < this.THROTTLE_MS) return; // dropped — see THROTTLE_MS's doc
    this.lastPartialPaintAt = t;
    const card = this.ensureCard();
    card.toggleAttribute('data-streaming', true); // shared-DOM attribute write, crosses worlds
    this.setState({
      kind: 'streaming',
      word,
      safeHtml: this.sanitize(markdown),
      ...(definedAs ? { definedAs } : {}),
    });
  }
```

4. In `renderResult` (currently lines 88-107), add one line right after `this.onForceLiteral =
ctx?.onForceLiteral;`:

```ts
this.card?.toggleAttribute('data-streaming', false);
```

5. In `renderError` (currently lines 109-111), add the same line right before `this.setState(...)`:

```ts
  renderError(e: LookupError): void {
    this.card?.toggleAttribute('data-streaming', false);
    this.setState({ kind: 'error', error: e });
  }
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "feat: streamed answers — InlineBottomSheetRenderer.renderPartial with throttle (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 6/9'
```

---

### Task 7: `message-relay-lookup-client.ts` — receiving the pushes in the content script

**Files:**

- Modify: `packages/app/src/app/message-relay-lookup-client.ts`
- Modify: `packages/app/test/app/message-relay-lookup-client.test.ts`

**Interfaces:**

```ts
interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage?: {
    addListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
    removeListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
  };
}
class MessageRelayLookupClient {
  constructor(runtime: RuntimeLike, genId?: () => string, extensionId?: string);
}
```

- [ ] **Step 1: Write the failing tests.** Add, inside `message-relay-lookup-client.test.ts`'s
      existing `describe` block:

```ts
function fakeRuntimeWithOnMessage(sendMessage: ReturnType<typeof vi.fn>) {
  const listeners: ((msg: unknown, sender: { id?: string }) => void)[] = [];
  return {
    sendMessage,
    onMessage: {
      addListener: (cb: (msg: unknown, sender: { id?: string }) => void) => listeners.push(cb),
      removeListener: (cb: (msg: unknown, sender: { id?: string }) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    push: (msg: unknown, sender: { id?: string } = { id: 'this-ext' }) =>
      listeners.forEach((l) => l(msg, sender)),
    listenerCount: () => listeners.length,
  };
}

it("invokes onChunk for a lookup.chunk push matching this call's requestId (A1)", async () => {
  let resolveReply!: (v: unknown) => void;
  const sendMessage = vi.fn(() => new Promise((r) => (resolveReply = r)));
  const runtime = fakeRuntimeWithOnMessage(sendMessage);
  const c = new MessageRelayLookupClient(runtime, () => 'id-1', 'this-ext');
  const onChunk = vi.fn();
  const p = c.lookup(req, { onChunk });
  runtime.push({ type: 'lookup.chunk', requestId: 'id-1', markdown: 'partial' });
  resolveReply({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' });
  await p;
  expect(onChunk).toHaveBeenCalledWith('partial', undefined);
});

it('ignores a lookup.chunk push for a DIFFERENT requestId (a stale/superseded lookup) (A1)', async () => {
  let resolveReply!: (v: unknown) => void;
  const sendMessage = vi.fn(() => new Promise((r) => (resolveReply = r)));
  const runtime = fakeRuntimeWithOnMessage(sendMessage);
  const c = new MessageRelayLookupClient(runtime, () => 'id-1', 'this-ext');
  const onChunk = vi.fn();
  const p = c.lookup(req, { onChunk });
  runtime.push({ type: 'lookup.chunk', requestId: 'id-OTHER', markdown: 'not mine' });
  resolveReply({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' });
  await p;
  expect(onChunk).not.toHaveBeenCalled();
});

it('removes its listener once the call settles, so a later push is a no-op (A1)', async () => {
  const sendMessage = vi.fn(() =>
    Promise.resolve({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' }),
  );
  const runtime = fakeRuntimeWithOnMessage(sendMessage);
  const c = new MessageRelayLookupClient(runtime, () => 'id-1', 'this-ext');
  const onChunk = vi.fn();
  await c.lookup(req, { onChunk });
  expect(runtime.listenerCount()).toBe(0);
  runtime.push({ type: 'lookup.chunk', requestId: 'id-1', markdown: 'too late' });
  expect(onChunk).not.toHaveBeenCalled();
});

it('never registers a listener when opts.onChunk is not passed', async () => {
  const sendMessage = vi.fn(() =>
    Promise.resolve({ ok: true, type: 'lookup', result: okResult, requestId: 'id-1' }),
  );
  const runtime = fakeRuntimeWithOnMessage(sendMessage);
  const c = new MessageRelayLookupClient(runtime, () => 'id-1', 'this-ext');
  await c.lookup(req);
  expect(runtime.listenerCount()).toBe(0);
});
```

Run: `cd packages/app && bunx vitest run test/app/message-relay-lookup-client.test.ts`
Expected: failures — the 3-arg constructor and `onChunk` wiring don't exist yet.

- [ ] **Step 2: Implement.** Replace `packages/app/src/app/message-relay-lookup-client.ts` in
      full:

```ts
import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '../index';
import { mapError } from '../index';
import { isLookupChunkMessage } from './lookup-chunk-message';

export interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
  /**
   * A1: optional — only needed by a caller that passes opts.onChunk to lookup(). chrome.runtime
   * (passed in at content.ts) already satisfies this shape; a test fake omits it entirely when a
   * test never exercises streaming.
   */
  onMessage?: {
    addListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
    removeListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
  };
}

// `crypto.randomUUID()` only exists in a SECURE context. Content scripts run on arbitrary
// pages, including plain `http://`, where it is `undefined` — calling it there throws
// "crypto.randomUUID is not a function" and the whole lookup fails before it reaches the SW.
// `crypto.getRandomValues` IS available in non-secure contexts, so build a v4 UUID from it.
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const withBits = Array.from(bytes, (b, i) =>
    i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b,
  );
  const hex = withBits.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rejectWith(e: LookupError): never {
  const err = new Error(e.message);
  (err as unknown as Record<string, unknown>)['code'] = e.code;
  (err as unknown as Record<string, unknown>)['message'] = e.message;
  (err as unknown as Record<string, unknown>)['retryable'] = e.retryable;
  if (e.retryAfterSec !== undefined)
    (err as unknown as Record<string, unknown>)['retryAfterSec'] = e.retryAfterSec;
  throw err;
}

export class MessageRelayLookupClient implements LookupClient {
  constructor(
    private readonly runtime: RuntimeLike,
    private readonly genId: () => string = randomId,
    // A1: the extension id to gate an inbound lookup.chunk push against (S3-style hygiene,
    // mirrors content.ts:210's `if (sender.id !== chrome.runtime.id) return;`). Optional so
    // existing non-Chrome-specific callers/tests that never stream need not supply it.
    private readonly extensionId?: string,
  ) {}

  async lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult> {
    const requestId = this.genId();
    if (opts?.signal) {
      opts.signal.addEventListener(
        'abort',
        () => {
          void this.runtime.sendMessage({ type: 'lookup.cancel', requestId });
        },
        { once: true },
      );
    }

    // A1: a per-call, scoped listener for this request's chunks — mirrors the abort listener
    // above's exact lifecycle (registered per call, torn down when the call settles).
    const onChunk = opts?.onChunk;
    const onRuntimeMessage = onChunk
      ? (msg: unknown, sender: { id?: string }): void => {
          if (this.extensionId !== undefined && sender.id !== this.extensionId) return;
          if (isLookupChunkMessage(msg) && msg.requestId === requestId) {
            onChunk(msg.markdown, msg.definedAs);
          }
        }
      : undefined;
    if (onRuntimeMessage) this.runtime.onMessage?.addListener(onRuntimeMessage);

    try {
      const reply = (await this.runtime.sendMessage({
        type: 'lookup',
        req,
        requestId,
      })) as WireReply;
      if (reply.ok && reply.type === 'lookup') return reply.result;
      if (!reply.ok) rejectWith(reply.error as LookupError);
      rejectWith(mapError({ kind: 'parse' })); // unexpected reply shape
    } finally {
      if (onRuntimeMessage) this.runtime.onMessage?.removeListener(onRuntimeMessage);
    }
  }
}
```

Run: `cd packages/app && bunx vitest run test/app/message-relay-lookup-client.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified (they
construct `MessageRelayLookupClient` with only `{ sendMessage }`, which still satisfies
`RuntimeLike` since `onMessage`/`extensionId` are both optional).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd .. && cd .. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/message-relay-lookup-client.ts packages/app/test/app/message-relay-lookup-client.test.ts
git commit -m "feat: streamed answers — MessageRelayLookupClient receives lookup.chunk pushes (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 7/9'
```

---

### Task 8: Chrome shell wiring — `sw.ts`, `content.ts`, `chrome-side-panel-mirror.ts`, `side-panel.ts`

**Files:**

- Modify: `packages/extension-chrome/src/sw.ts`
- Modify: `packages/extension-chrome/src/content.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.test.ts`
- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `sw.ts`, `content.ts`, or `side-panel.ts` in this repo (all three
are composition roots, covered by e2e only — same precedent C2's plan documented for `options.ts`).
This task's correctness there is proven by Task 9's e2e; `chrome-side-panel-mirror.ts` DOES have a
dedicated unit test file and gets one here.

- [ ] **Step 1: `chrome-side-panel-mirror.ts` — TDD the one piece with a unit test.** Add, inside
      `chrome-side-panel-mirror.test.ts`'s existing `describe` block:

```ts
it('renderPartial posts the streaming state to the side panel (A1)', async () => {
  const sendMessage = vi.fn(() => Promise.resolve({}));
  const m = new ChromeSidePanelMirror({ sendMessage });
  m.renderPartial('bank', 'partial def', { term: 'bank', isIdiom: false });
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledWith({
    to: 'side-panel',
    state: 'streaming',
    word: 'bank',
    markdown: 'partial def',
    definedAs: { term: 'bank', isIdiom: false },
  });
});
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-side-panel-mirror.test.ts`
Expected: failure — `renderPartial` does not exist yet.

Implement — replace `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts` in full:

```ts
import type {
  ResultRenderer,
  ResultRenderContext,
  LookupResult,
  LookupError,
  RuntimeLike,
} from '@ai-dict/app';

export class ChromeSidePanelMirror implements ResultRenderer {
  constructor(private readonly runtime: RuntimeLike) {}
  private post(msg: Record<string, unknown>): void {
    void Promise.resolve(this.runtime.sendMessage({ to: 'side-panel', ...msg })).catch(
      () => undefined,
    );
  }
  renderLoading(word?: string): void {
    this.post({ state: 'loading', word });
  }
  /**
   * B1: also broadcasts sentence/url/title (from ResultRenderContext, when present) so the side
   * panel's own composition root can build a full save payload independently of the in-page
   * card — the panel is a live mirror, not a re-derivation of the in-page DOM.
   */
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.post({
      state: 'result',
      payload: r,
      ...(ctx?.sentence !== undefined ? { sentence: ctx.sentence } : {}),
      ...(ctx?.url !== undefined ? { url: ctx.url } : {}),
      ...(ctx?.title !== undefined ? { title: ctx.title } : {}),
    });
  }
  renderError(e: LookupError): void {
    this.post({ state: 'error', payload: e });
  }
  /** A1: mirrors the in-page card's in-progress preview to the panel. */
  renderPartial(
    word: string,
    markdown: string,
    definedAs?: { term: string; isIdiom: boolean },
  ): void {
    this.post({ state: 'streaming', word, markdown, ...(definedAs ? { definedAs } : {}) });
  }
  close(): void {
    this.post({ state: 'close' });
  }
}
```

Run: `cd packages/extension-chrome && bunx vitest run src/adapters/chrome-side-panel-mirror.test.ts`
Expected: all tests pass, including every pre-existing test in this file unmodified.

- [ ] **Step 2: `sw.ts` — the requestId→tab push.** In `packages/extension-chrome/src/sw.ts`:

1. Add, right after the existing `let lastSidePanelFocus: SidePanelFocus | null = null;` (line 33):

```ts
// A1: requestId -> originating tab id, so a lookup.chunk push can be routed to the right page.
// Populated just before router(...) is called for a 'lookup' message; deleted once that call's
// continuation runs (mirrors the existing sendResponse/reporter.capture cleanup site below).
const chunkTabs = new Map<string, number>();
```

2. Add the import for `LookupChunkMessage`, extending the existing `@ai-dict/app` import (add
   `LookupChunkMessage` to the type-only names already imported there):

```ts
import {
  // ...existing named imports unchanged...
  type LookupChunkMessage,
} from '@ai-dict/app';
```

3. Add `onLookupChunk` to the existing `buildRouter({...})` call (currently `sw.ts:81-114`), right
   after the existing `errlog: reporter,` line:

```ts
  // A1: push a chunk to the tab that originated the requestId, outside the wire protocol
  // entirely — the exact same chrome.tabs.sendMessage mechanism the A4 command relay already
  // uses below (chrome.commands.onCommand.addListener).
  onLookupChunk: (requestId, markdown, definedAs) => {
    const tabId = chunkTabs.get(requestId);
    if (tabId === undefined) return;
    const message: LookupChunkMessage = {
      type: 'lookup.chunk',
      requestId,
      markdown,
      ...(definedAs ? { definedAs } : {}),
    };
    void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  },
```

4. In the existing `chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {...})`
   body (currently `sw.ts:116-183`), right after the existing
   `const decision = classifyInbound(msg, sender.id, chrome.runtime.id);` line, add:

```ts
if (
  decision.action === 'accept' &&
  decision.msg.type === 'lookup' &&
  sender.tab?.id !== undefined
) {
  chunkTabs.set(decision.msg.requestId, sender.tab.id);
}
```

5. In the same listener's existing `router(decision.msg).then((reply) => { ... })` continuation,
   add a `chunkTabs.delete(...)` at the very top of the `.then` callback body (before the existing
   `if (reply !== SUPPRESS) sendResponse(reply);` line):

```ts
    .then((reply) => {
      if (decision.msg.type === 'lookup') chunkTabs.delete(decision.msg.requestId);
      if (reply !== SUPPRESS) sendResponse(reply);
      // ...rest of the existing body unchanged...
```

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean.

- [ ] **Step 3: `content.ts` — fan `renderPartial` out to both surfaces.** In
      `packages/extension-chrome/src/content.ts`, add a key to the existing renderer object literal
      passed to `runLookupWorkflow({...})` (currently `content.ts:76-113`), right after the
      existing `renderLoading(word) { ... }` method:

```ts
    renderPartial(word, markdown, definedAs) {
      // A1: never touches lastSavePayload/lastSaved/lastStatus — a partial preview never
      // populates the save context; only the terminal renderResult below does (design spec §4.8).
      inline.renderPartial(word, markdown, definedAs);
      mirror.renderPartial(word, markdown, definedAs);
    },
```

- [ ] **Step 4: `side-panel.ts` — receive the streaming broadcast.** In
      `packages/extension-chrome/src/side-panel.ts`, extend the existing
      `chrome.runtime.onMessage.addListener((msg, sender) => {...})` handler (currently lines
      237-275): widen its inline `msg` type annotation to add `markdown?: unknown` and
      `definedAs?: unknown`, and add a new branch right after the existing `else if (msg.state ===
'error') { ... }` branch:

```ts
    } else if (msg.state === 'streaming') {
      if (typeof msg.word !== 'string' || typeof msg.markdown !== 'string') return;
      const definedAs =
        msg.definedAs !== null &&
        typeof msg.definedAs === 'object' &&
        'term' in (msg.definedAs as Record<string, unknown>)
          ? (msg.definedAs as { term: string; isIdiom: boolean })
          : undefined;
      view.focusState = {
        kind: 'streaming',
        word: msg.word,
        safeHtml: sanitizeMarkdown(msg.markdown), // S4: sanitized at this render boundary, exactly
                                                    // like resultToFocus() already does above
        ...(definedAs ? { definedAs } : {}),
      };
```

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/sw.ts packages/extension-chrome/src/content.ts packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts packages/extension-chrome/src/adapters/chrome-side-panel-mirror.test.ts packages/extension-chrome/src/side-panel.ts
git commit -m "feat: streamed answers — Chrome SW->content->panel chunk transport wiring (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 8/9'
```

---

### Task 9: e2e coverage

**Files:**

- Modify: `packages/extension-chrome/e2e/helpers.ts`
- Create: `packages/extension-chrome/e2e/a1-streamed-answers.spec.ts`

- [ ] **Step 1: Add a streaming mock helper.** In `packages/extension-chrome/e2e/helpers.ts`, add,
      near the existing `mockGemini` export:

```ts
export const GEMINI_STREAM_GLOB = '**/*:streamGenerateContent*';

/**
 * A1: fulfills Gemini's SSE streaming endpoint with `events` joined as `data: <event>\n\n` frames
 * (each `event` a pre-serialized JSON string, e.g. the same shape mockGemini's OK body uses per
 * chunk). Routes on the CONTEXT (not the page), same reasoning mockGemini already documents —
 * the fetch originates in the service worker.
 */
export async function mockGeminiStream(
  context: BrowserContext,
  events: string[],
): Promise<{ count: number }> {
  const calls = { count: 0 };
  await context.route(GEMINI_STREAM_GLOB, async (route) => {
    calls.count++;
    const body = events.map((e) => `data: ${e}\n\n`).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  return calls;
}
```

(Match this file's existing import style — `BrowserContext` is already imported from
`@playwright/test` at the top of `helpers.ts`; reuse it, do not re-import.)

- [ ] **Step 2: Write the e2e spec.** Create
      `packages/extension-chrome/e2e/a1-streamed-answers.spec.ts`:

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  gotoFixture,
  selectWord,
  openTrigger,
  mockGeminiStream,
  mockGemini,
} from './helpers';

function chunk(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

test.describe('A1 streamed answers', () => {
  test('a Gemini lookup hits the streaming endpoint and renders the fully-accumulated answer', async ({
    context,
    page,
    extensionId,
  }) => {
    const calls = await mockGeminiStream(context, [
      chunk('DEFINED_AS: "bank" | literal\n'),
      chunk('TRANSLATION: "bờ sông"\n\n'),
      chunk('The land '),
      chunk('alongside a river.'),
    ]);
    await seedSettings(page, {});
    await gotoFixture(page, 'She sat on the bank of the river.');
    await selectWord(page, 'w1', 'bank');
    await openTrigger(page);

    await expect(page.locator('lookup-card h2').first()).toHaveText('bank', { timeout: 10_000 });
    await expect(page.locator('lookup-card')).toContainText('The land alongside a river.', {
      timeout: 10_000,
    });
    expect(calls.count).toBe(1);
  });

  test('selecting a second word mid-stream cancels the first and shows only the second definition', async ({
    context,
    page,
    extensionId,
  }) => {
    // The first mock never completes (no final chunk closes cleanly before the second lookup
    // fires) — proves the abort path, not a race on which response wins.
    await context.route('**/*:streamGenerateContent*', async (route) => {
      // Never fulfills — simulates a still-streaming request that gets cancelled.
      await new Promise(() => {});
    });
    const secondCalls = await mockGemini(context); // the SECOND word uses openTrigger's default
    // provider selection unaffected by this card
    await seedSettings(page, {});
    await gotoFixture(page, 'She sat on the bank of the river, reading a book.');
    await selectWord(page, 'w1', 'bank');
    await openTrigger(page);
    await selectWord(page, 'w2', 'book');
    await openTrigger(page);

    await expect(page.locator('lookup-card h2').first()).toHaveText('book', { timeout: 10_000 });
    expect(secondCalls.count).toBe(1);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a1-streamed-answers
```

Expected: 2 passed. (If the second test's route-never-resolving pattern causes Playwright to hang
waiting on an outstanding request during teardown, replace the never-resolving route with
`await route.abort();` immediately — still exercises the cancel path, since the content script's
`lookup.cancel` fires from the workflow's own `inFlight?.abort()` before the first request would
otherwise be awaited to completion; either form proves the same functional guarantee.)

- [ ] **Step 3: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/helpers.ts packages/extension-chrome/e2e/a1-streamed-answers.spec.ts
git commit -m "feat: streamed answers — e2e coverage for the Gemini streaming flow (A1)" \
  -m $'Tribe-Card: a1-streamed-answers\nTribe-Task: 9/9'
```

---

## Final gate (run once, after Task 9, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
git diff --stat origin/master -- packages/app/src/app/http-lookup-client.ts packages/app/src/app/openai-lookup-client.ts packages/app/src/app/anthropic-lookup-client.ts packages/app/src/app/lookup-client-selector.ts packages/app/src/wire.ts packages/app/src/domain/types.ts packages/app/src/ui/side-panel-view.ts packages/extension-chrome/src/manifest.json
GEMINI_API_KEY= bun run build:chrome:e2e
cd packages/extension-chrome && bunx playwright test a1-streamed-answers provider-selection provider-fallback provider-errors lookup-pending-dismiss cooldown onboarding
```

Expected: typecheck clean on both packages; the full Vitest suite green (including every new file
in §Files-touched); lint/format clean; the `git diff --stat` command against the nine explicitly
untouched files prints **nothing**; the Chrome e2e build succeeds with the env key cleared; the new
`a1-streamed-answers.spec.ts` plus the regression guards (`provider-selection.spec.ts`,
`provider-fallback.spec.ts`, `provider-errors.spec.ts` prove OpenAI/Anthropic are unchanged;
`lookup-pending-dismiss.spec.ts`, `cooldown.spec.ts` prove the general cancel/dismiss mechanics are
unbroken; `onboarding.spec.ts` guards C2's `connection.test` path, which never passes `onChunk`)
all pass.

## PR

Regular merge (no squash). Jira link per the repo convention. Include a **"Testing performed"**
section per this worktree's evidence policy (§8 of the design spec) instead of screenshots/video —
list the suites above with pass counts, explicitly noting the empty `git diff --stat` proof that
`http-lookup-client.ts`/`openai-lookup-client.ts`/`anthropic-lookup-client.ts` are untouched.
