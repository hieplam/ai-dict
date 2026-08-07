# A1 — Streamed answers

Roadmap card: `docs/ROADMAP.md` §4 A1 (Impact 5 · Effort M · Score 2.5). Depends on: — (independent).
Card text: "Progressive rendering — words appear as the model produces them... First words visible
in under 1 second... Every repaint of partial markdown must pass sanitization (S4, mandatory).
Providers that can't stream fall back silently to today's behavior." Lead decides: per-provider
streaming vs. fallback. Escalate: none (S4 is a rule, not a choice).

## 1. Problem (grounded in code)

Today, end to end, a lookup is a single request/response round trip with no progressive step
anywhere in the pipeline:

- **Content script → service worker**: `MessageRelayLookupClient.lookup()`
  (`packages/app/src/app/message-relay-lookup-client.ts:37-52`) sends exactly one
  `chrome.runtime.sendMessage({ type: 'lookup', req, requestId })` and `await`s exactly one
  reply (`const reply = (await this.runtime.sendMessage(...)) as WireReply`, line 48). There is no
  second message type, no open channel, nothing that could carry a partial answer.
- **Service worker routing**: `buildRouter`'s exported function signature is
  `(msg: WireMessage) => Promise<RouterReply>` (`packages/app/src/app/router.ts:93`) — one message
  in, one reply out. `handleLookup` (`router.ts:97-172`) `await`s `deps.client.lookup(...)` once
  (line 133) and returns one `RouterReply`.
- **HTTP call**: `runHttpLookup` (`packages/app/src/app/http-lookup-client.ts:71-185`) makes one
  `deps.fetch(...)` call (line 111) and reads the whole body with one `await res.json()`
  (line 149). `ResponseLike` (`http-lookup-client.ts:20-25`) exposes only `.json()` — there is no
  `.body`/stream-reader surface at all. REPO-FACTS confirms this is universal: `grep -rn stream
packages/app/src` returns zero hits outside unrelated words — **no streaming support exists
  anywhere in this codebase today**; this card is greenfield, not an extension of existing
  plumbing.
- **Render**: `InlineBottomSheetRenderer.renderResult()`
  (`packages/app/src/app/inline-bottom-sheet-renderer.ts:88-107`) is called exactly once per
  lookup, from `workflow.ts`'s `runLookup` (`packages/app/src/domain/workflow.ts:80,115`) after the
  single `await deps.client.lookup(...)` resolves. Until then the card shows the `'loading'`
  `CardState` (`packages/app/src/ui/lookup-card.ts:31`, rendered by `renderCardState` at
  `lookup-card.ts:241-262`) — a static headword + a `"Looking up the meaning…"` caption
  (`lookup-card.ts:259`). On a slow model this is the "multi-second blank stare" the card names.

The reader therefore always sees: click → static spinner card → the _entire_ answer, appearing all
at once, however many seconds later.

## 2. The critical design question: what transport carries partial answers from the model to the card?

`chrome.runtime.sendMessage`/`onMessage` (what `MessageRelayLookupClient` and `buildRouter` are
built on) is a one-shot request/single-reply primitive by construction — `sendResponse` can only be
called once per message (`sw.ts:151-153`, `chrome.runtime.onMessage`'s standard contract). Getting
partial content from the SW (where the fetch happens, composed in `sw.ts:81-114`) to the content
script (where the card lives, `content.ts:20`) needs a second, repeatable channel. Two ways to build
one:

**(a) `chrome.runtime.connect()` — a long-lived `Port`.** The content script opens a Port before
sending the lookup, and the SW `postMessage`s partial chunks (then the final result) down the same
Port instead of the existing `sendMessage`/`sendResponse` pair.

**(b) Repeated one-way push messages, correlated by `requestId`, alongside the existing
`sendMessage`/`sendResponse` pair (unchanged).** The original request/reply round trip stays
exactly as it is today; the SW additionally _pushes_ zero or more `lookup.chunk` messages to the
originating tab as chunks arrive, and the content script's own transport client listens for them.

### Why (b) is the only one that doesn't restructure two already-shipped invariants

**It reuses a pattern this exact codebase already ships**, not a new primitive: A4's keyboard-flow
relay is a one-way SW → content-script push, outside the `WireMessageSchema`/`classifyInbound`
wire protocol entirely — `sw.ts:189-196`'s `chrome.commands.onCommand` listener calls
`chrome.tabs.sendMessage(tab.id, message)` with a small standalone `CommandMessage` type
(`packages/extension-chrome/src/command-messages.ts:1-22`, its own `isCommandMessage` guard, no
`WireMessageSchema` arm), and `content.ts:209-226` receives it via a _second_,
independent `chrome.runtime.onMessage` listener gated the same way S3 gates the SW
(`if (sender.id !== chrome.runtime.id) return;`, `content.ts:210`). Streaming chunks are the same
shape of problem (SW → content, one-way, no reply expected) and get the same answer.

**(a) would force a rewrite of two things CONTRACTS and the codebase both treat as settled:**

1. `buildRouter`'s contract is _one `WireMessage` in, one `RouterReply` out_
   (`router.ts:93`) — every handler (`handleLookup`, `handleCancel`, …) returns a single value.
   Streaming over a Port means the SW would need to keep writing to an open channel _after_
   `handleLookup` would otherwise have returned, i.e. a second return path with no analogue in the
   current router shape. `classifyInbound` (`packages/app/src/app/inbound.ts`, S3's gate) is
   likewise built to validate one `WireMessageSchema`-shaped message per call; a Port framing would
   need its own, parallel validation surface. Both would need restructuring for a feature the
   card's own fence permits shipping with **zero behavior change to the non-streaming path**
   (§5) — that fence is far easier to hold when the existing one-shot request/reply is never
   touched at all, which (b) achieves by construction (see §4).
2. **Losing a message is a correctness bug for a Port stream and a no-op for (b).** A Port's
   content _is_ the message — a dropped `postMessage` loses real content permanently, so a Port
   design would need its own retry/resume protocol. Under (b), the existing final `lookup` reply
   (`router.ts:159-164`, sent as it is today) still always carries the complete, authoritative
   markdown; `lookup.chunk` pushes are a strictly additive, best-effort _preview_ layered
   alongside it. A dropped chunk is invisible to the reader — the next chunk, or the final
   unchanged `renderResult` call, supersedes it a moment later. This directly under-writes the
   "throttle repaints" fence item (§5): dropping a repaint under throttle pressure is safe _only_
   because (b) never depends on any one chunk arriving.

**Pinned: option (b).** No new wire message is added to `WireMessageSchema`/`buildRouter`'s
switch — `lookup.chunk` pushes live entirely outside that protocol, exactly like `CommandMessage`
does today, so **CONTRACTS §2's "wire arm + router case = one task" rule does not apply to this
card** (it applies only when a message is added to the `WireMessageSchema` discriminated union;
this card adds none).

## 3. Which providers stream in v1 (the card's other lead-decidable choice)

The card's own scope fence explicitly allows this: _"Providers that can't stream fall back
silently to today's behavior."_ **Pinned: Gemini streams in v1; OpenAI and Anthropic do not.**
`packages/app/src/app/openai-lookup-client.ts` and `anthropic-lookup-client.ts` are **not touched
by this card at all** — they keep calling `runHttpLookup` exactly as today, so a lookup answered by
either provider renders exactly as it does today (full text, once, at the end).

- **Why Gemini only.** Gemini is the only provider requiring no user-provided key at all beyond
  the free key every install expects to configure first (`onboarding-view.ts`, the C2 pair) and is
  the default `provider` (`sw.ts:27,48`: `DEFAULT_TARGET`/`provider: 'gemini'` in
  `readFullSettings()`'s fallback object) — it is the provider the 70%-reader persona
  (`docs/ROADMAP.md` §2) hits on essentially every lookup, so streaming it captures the
  overwhelming majority of the perceived-speed payoff the card describes immediately. Shipping
  three different vendors' SSE-parsing implementations in one Effort-M card would triple both the
  implementation and the test surface for marginal first-iteration gain; the roadmap card text
  itself defers the OpenAI/Anthropic question to the lead ("Lead decides: per-provider streaming
  vs. fallback").
- **"Detection" is static, not runtime-probed.** The card-specific dispatch note asks how
  detection works "per provider from http-lookup-client." There is no capability negotiation: a
  provider's `LookupClient` implementation either calls the new `onChunk` callback (only
  `GeminiLookupClient`, §4.2) or it never does (`OpenAILookupClient`/`AnthropicLookupClient`,
  unmodified). The workflow layer (`workflow.ts`, §4.6) always _offers_ the callback; whether it is
  ever invoked is entirely up to which client class handled the request. No provider is probed at
  request time, and no per-provider flag exists anywhere in settings.
- **Rejected: probing every provider's streaming capability at request time** (e.g. a
  `supportsStreaming(provider)` helper feeding a runtime branch in `lookup-client-selector.ts`).
  This adds a piece of state that would need to stay in sync with which providers actually
  implement `onChunk`, for zero behavior difference from "the client either calls it or it
  doesn't" — `createLookupClientSelector` already forwards `opts` to whichever
  `deps.clients[provider]` it picks (`lookup-client-selector.ts:66`, unchanged by this card), so
  the static approach needs no new code there at all.
- **Explicit follow-up, not built here:** extending `HttpLookupSpec` with a generic `stream`
  slot other providers could adopt (mirroring §4.2's Gemini-only extension) is a clean, additive
  next card; this card does not touch `openai-lookup-client.ts`/`anthropic-lookup-client.ts`/
  `http-lookup-client.ts` to leave that door open cleanly (§6).

## 4. The change

### 4.1 `packages/app/src/ports.ts` — two additive, optional capability seams

- `LookupClient.lookup`'s `opts` parameter gains an optional field:
  `onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void`.
  `markdownSoFar` is **already stripped of the `DEFINED_AS:`/`TRANSLATION:` signal lines** (§4.2) —
  every caller receives clean, sanitizable body text, never a signal line. Optional, so
  `FakeLookupClient` (`packages/app/test/fakes/index.ts:70-79`) and every other existing caller of
  `LookupClient.lookup` compiles and behaves identically unchanged.
- `ResultRenderer` gains an optional method:
  `renderPartial?(word: string, markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }): void`.
  Optional for the same reason `ResultRenderContext`'s `onSwitchProvider`/`onForceLiteral` are
  optional (`ports.ts:30,35`) — an established precedent in this exact file for "a capability some
  renderers implement and some callers may not use." `FakeResultRenderer`
  (`packages/app/test/fakes/index.ts:44-64`) needs **no change** to keep implementing the
  interface.

### 4.2 New `packages/app/src/app/gemini-streaming.ts` — the SSE client

A **new, separate function**, not a branch inside `runHttpLookup`. Rejected alternative: adding an
optional `spec.stream` branch directly inside `runHttpLookup`
(`http-lookup-client.ts:71-185`) would technically also guarantee zero behavior change for
OpenAI/Anthropic (their `spec` objects would simply never set `.stream`), but it makes that
guarantee something a reviewer has to _reason through_, not something a `git diff` can show in one
line. A fully separate file makes §5's "no change to X" fence literal and mechanically verifiable:
`http-lookup-client.ts`, `openai-lookup-client.ts`, and `anthropic-lookup-client.ts` have **zero
byte changes** from this card. The cost is duplicating roughly 40 lines of prologue (key/online
guard, prompt assembly, abort/timeout wiring) already in `runHttpLookup` — accepted deliberately as
the smaller risk.

```ts
// packages/app/src/app/gemini-streaming.ts
import {
  mapError,
  buildPrompt,
  type LookupRequest,
  type LookupResult,
  type LookupError,
} from '../index';
import { parseDefinedAs } from '../domain/defined-as';
import { parseTranslation } from '../domain/translation-line';
import type { FetchLike, HttpLookupDeps } from './http-lookup-client';

const STREAM_TIMEOUT_MS = 20000; // same DEFAULT_TIMEOUT_MS budget as the non-streaming path
// (http-lookup-client.ts:12) — covers the whole stream, not
// per-chunk: no new "stalled chunk" timeout is invented (scope).
// Withhold the first partial repaint until the DEFINED_AS + TRANSLATION signal lines (emitted
// FIRST by the prompt: default-template.ts:43-45,64-65, "begin your response with exactly this
// line" / "Immediately after the DEFINED_AS line, before any other output") are fully resolved,
// OR this many raw characters have accumulated with no match — generous headroom over the
// longest realistic `DEFINED_AS: "..." | idiom` + `TRANSLATION: "..."` pair, so a legacy/custom
// prompt envelope that never emits them (parseDefinedAs/translation-line.ts's own documented
// "body is the ENTIRE text unchanged" fallback) still starts streaming promptly.
const HEADER_MAX_BUFFER_CHARS = 400;

interface GeminiOkBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
interface GeminiErrBody {
  error?: { status?: string; code?: number; message?: string };
}

function rejectWith(e: LookupError): never {
  throw Object.assign(new Error(e.message), e); // mirrors http-lookup-client.ts:58-60 exactly
}
function isThrownLookupError(e: unknown): boolean {
  return e instanceof Error && 'code' in e && 'retryable' in e; // mirrors http-lookup-client.ts:62-64
}

export interface GeminiStreamSpec {
  endpoint: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (prompt: string, model: string) => string;
}

export async function runGeminiStreamingLookup(
  spec: GeminiStreamSpec,
  deps: HttpLookupDeps & { fetch: FetchLike },
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
      let parsed: { geminiStatus?: string; vendorMessage?: string } = {};
      try {
        const errJson = (await res.json()) as GeminiErrBody;
        parsed = {
          ...(errJson.error?.status !== undefined ? { geminiStatus: errJson.error.status } : {}),
          ...(errJson.error?.message !== undefined ? { vendorMessage: errJson.error.message } : {}),
        };
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
          ...parsed,
          ...(!Number.isNaN(retryAfterSec) ? { retryAfterSec } : {}),
        }),
      );
    }
    if (!res.body) rejectWith(mapError({ kind: 'parse', provider: 'gemini' })); // no stream body at all

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = ''; // accumulated model text, across all chunks
    let sseTail = ''; // an incomplete trailing SSE event, carried to the next read()
    let headerResolved = false;
    let resolvedDefinedAs: { term: string; isIdiom: boolean } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseTail += decoder.decode(value, { stream: true });
      const events = sseTail.split('\n\n');
      sseTail = events.pop() ?? ''; // last (possibly incomplete) event kept for the next read
      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice(6).trim();
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
          // else: keep withholding — the DEFINED_AS/TRANSLATION lines may still be arriving.
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

**Final-result byte-parity with the non-streaming path is structural, not incidental**: the
`return { markdown: parsedBody, ... }` object above is built by the exact same
`parseDefinedAs`/`parseTranslation`/field-assembly sequence as
`http-lookup-client.ts:157-169`, so cache/history/router code downstream never needs to know a
lookup streamed at all — it receives the identical `LookupResult` shape either way.

**Cancel/abort needs zero new code.** `reader.read()` is a promise; aborting `ac` (via
`opts.signal`'s existing listener, unchanged from `http-lookup-client.ts`'s own pattern) rejects
the in-flight `fetch`/read exactly as it does for the non-streaming path today — the abort
plumbing already threads end-to-end through `MessageRelayLookupClient`'s existing
`opts.signal.addEventListener('abort', ...)` → `lookup.cancel` (message-relay-lookup-client.ts:39- 46) → `router.ts`'s `inflight`/`cancelled` maps (`handleCancel`, `router.ts:174-181`) → the same
`AbortController` passed into `deps.client.lookup(req, { signal: controller.signal })`
(`router.ts:133`). Nothing above adds a second cancel path.

### 4.3 `packages/app/src/app/gemini-lookup-client.ts` — dispatch to the streaming path

```ts
// export MODEL so gemini-streaming.ts can reuse the exact same model id (was a local const).
export const MODEL = 'gemini-2.5-flash';
const STREAM_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

export class GeminiLookupClient implements LookupClient {
  constructor(private readonly deps: GeminiDeps) {}

  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ): Promise<LookupResult> {
    if (opts?.onChunk) {
      return runGeminiStreamingLookup(
        {
          endpoint: STREAM_ENDPOINT,
          model: MODEL,
          headers: (apiKey) => ({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey }),
          body: (prompt) =>
            JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        },
        this.deps,
        req,
        opts.onChunk,
        opts,
      );
    }
    return runHttpLookup(
      /* … unchanged existing call … */ /* see current gemini-lookup-client.ts:25-45 */ /* spec object identical to today */ /* body */
      {
        provider: 'gemini',
        endpoint: ENDPOINT,
        model: MODEL,
        headers: /*…*/ () => ({}),
        body: () => '',
        parseOk: () => undefined,
        parseErr: () => ({}),
      },
      this.deps,
      req,
      opts,
    );
  }
}
```

The plan (§Task 2, Step 2) contains the exact, complete file — the excerpt above is elided only to
avoid duplicating the whole (unchanged) non-streaming branch twice in this document.
`opts?.onChunk` is the **only** dispatch condition: no settings flag, no capability probe — exactly
§3's "detection is static" pin. Calling `GeminiLookupClient.lookup(req)` with no `opts` (or an
`opts` with no `onChunk`) — e.g. `handleConnectionTest`'s call at `router.ts:198-206`, which never
passes `onChunk` — takes the **existing, unmodified** `runHttpLookup` branch, so C2's verified-
activation connection test is untouched by this card.

### 4.4 `packages/app/src/app/router.ts` — an optional progress callback, not a new reply shape

`RouterDeps` (`router.ts:41-71`) gains one optional field:

```ts
onLookupChunk?: (requestId: string, markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
```

`handleLookup` (`router.ts:97-172`)'s single `deps.client.lookup(req, { signal: controller.signal })`
call (line 133) becomes:

```ts
const result = await deps.client.lookup(req, {
  signal: controller.signal,
  // A1: the `onChunk` KEY ITSELF is only attached when the composition root wants push-forwarding
  // (deps.onLookupChunk supplied) — never an unconditional key with a no-op body. GeminiLookupClient
  // dispatches to the streaming SSE endpoint purely on `opts?.onChunk` truthiness (§4.3); an
  // unconditionally-present key (even one whose body is a guarded no-op) would force EVERY Gemini
  // lookup onto the streaming endpoint regardless of whether anything downstream consumes the
  // chunks — breaking the card's "no behavior change for the non-streaming path" fence (§5) for
  // both Chrome (before sw.ts opts in, §4.5) and Safari (which never opts in, §6).
  ...(deps.onLookupChunk
    ? {
        onChunk: (md: string, definedAs?: { term: string; isIdiom: boolean }) => {
          if (!cancelled.has(requestId)) deps.onLookupChunk?.(requestId, md, definedAs);
        },
      }
    : {}),
});
```

The `cancelled.has(requestId)` guard reuses the exact `Set` `handleCancel` already populates
(`router.ts:174-181`) — a chunk that arrives after the _reply itself_ has already been suppressed
(§6.10/D5's existing `SUPPRESS` semantics, unchanged) is dropped at the source, not just at the
renderer. **`buildRouter`'s exported function signature — `(msg: WireMessage) => Promise<RouterReply>`
— does not change.** No new `RouterReply`/`WireReply` variant is added; `onLookupChunk` is a
side-channel callback the composition root supplies, symmetric with the already-optional
`openOptions`/`errlog` deps (`router.ts:57,63`).

**The streaming path activates ONLY when the composition root supplies `deps.onLookupChunk`** — this
is the single gate, checked once per `handleLookup` call via the conditional spread above, not a
per-chunk guard. A composition root that never sets `RouterDeps.onLookupChunk` (Safari's unmodified
shell, §6, or Chrome before Task 8 wires `sw.ts`) causes `client.lookup(req, {...})` to be called
with no `onChunk` key at all, so `GeminiLookupClient` takes its existing, unmodified `runHttpLookup`
branch (§4.3) — identical to today's behavior, not merely "the callback fires but nothing listens."

### 4.5 `packages/extension-chrome/src/sw.ts` — SW → content-script push

Two additions, both at the composition-root level (mirrors the existing `lastSidePanelFocus`
module-level state pattern, `sw.ts:33`):

```ts
// requestId -> originating tab id, so a chunk can be routed back to the right page.
const chunkTabs = new Map<string, number>();
```

Inside the existing `chrome.runtime.onMessage.addListener` (`sw.ts:116-183`), **before** the
existing `router(decision.msg)` call (line 151), when the inbound message is a lookup:

```ts
if (decision.msg.type === 'lookup' && sender.tab?.id !== undefined) {
  chunkTabs.set(decision.msg.requestId, sender.tab.id);
}
```

And `buildRouter({...})`'s existing call (`sw.ts:81-114`) gains:

```ts
onLookupChunk: (requestId, markdown, definedAs) => {
  const tabId = chunkTabs.get(requestId);
  if (tabId === undefined) return;
  const message: LookupChunkMessage = { type: 'lookup.chunk', requestId, markdown, ...(definedAs ? { definedAs } : {}) };
  void chrome.tabs.sendMessage(tabId, message).catch(() => undefined); // mirrors sw.ts:195's own A4 relay
},
```

The `chunkTabs` entry for a `requestId` is deleted in the existing `router(decision.msg).then(...)`
continuation (`sw.ts:151-172`, right where `sendResponse`/`reporter.capture` already run) — the
request's lifecycle at the composition-root level already ends there. `LookupChunkMessage` is a new
shared type (§4.6), not a `WireMessageSchema` arm — **no manifest permission change**:
`chrome.tabs.sendMessage(tab.id, ...)` is already used unconditionally today for A4 (`sw.ts:195`)
under the current `"permissions": ["storage", "sidePanel"]` set
(`packages/extension-chrome/src/manifest.json:13`) — messaging a tab the extension's own content
script is already injected into needs no `"tabs"` permission.

**No dedicated unit test for `sw.ts`** — same precedent as C2's Task 2 (`sw.ts` is a composition
root with no existing test file; correctness is proven by e2e, §7).

### 4.6 New `packages/app/src/app/lookup-chunk-message.ts` — the push message's shape

Mirrors `command-messages.ts`'s `CommandMessage`/`isCommandMessage` pattern exactly (a small,
standalone type + type guard, outside `WireMessageSchema`):

```ts
export interface LookupChunkMessage {
  type: 'lookup.chunk';
  requestId: string;
  markdown: string;
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

Lives in `packages/app/src/app/` (shared core), re-exported from `packages/app/src/index.ts`,
because the **consumer** (§4.7) is the shared `MessageRelayLookupClient`, not Chrome-specific code
— only the _production_ side (`chrome.tabs.sendMessage`, §4.5) is Chrome-only.

### 4.7 `packages/app/src/app/message-relay-lookup-client.ts` — receiving the pushes

`RuntimeLike` (`message-relay-lookup-client.ts:4-6`) gains an optional `onMessage` surface:

```ts
export interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage?: {
    addListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
    removeListener(cb: (msg: unknown, sender: { id?: string }) => void): void;
  };
}
```

`chrome.runtime` (passed in at `content.ts:114`: `new MessageRelayLookupClient(chrome.runtime)`)
already satisfies this shape unchanged. `lookup()` gains a **per-call, scoped listener** —
mirroring the exact lifecycle pattern the class already uses for its own abort listener
(`message-relay-lookup-client.ts:39-46`):

```ts
async lookup(req: LookupRequest, opts?: { signal?: AbortSignal; onChunk?: (md: string, definedAs?: { term: string; isIdiom: boolean }) => void }): Promise<LookupResult> {
  const requestId = this.genId();
  if (opts?.signal) { /* … unchanged abort → lookup.cancel listener … */ }

  const onRuntimeMessage = opts?.onChunk
    ? (msg: unknown, sender: { id?: string }): void => {
        if (sender.id !== EXPECTED_EXTENSION_ID_UNUSED) { /* see plan: guard is sender presence, not a hardcoded id */ }
        if (isLookupChunkMessage(msg) && msg.requestId === requestId) opts.onChunk!(msg.markdown, msg.definedAs);
      }
    : undefined;
  if (onRuntimeMessage) this.runtime.onMessage?.addListener(onRuntimeMessage);

  try {
    const reply = (await this.runtime.sendMessage({ type: 'lookup', req, requestId })) as WireReply;
    if (reply.ok && reply.type === 'lookup') return reply.result;
    if (!reply.ok) rejectWith(reply.error as LookupError);
    rejectWith(mapError({ kind: 'parse' }));
  } finally {
    if (onRuntimeMessage) this.runtime.onMessage?.removeListener(onRuntimeMessage);
  }
}
```

(The plan's Task 7 has the literal, compiling version — the sender guard there is
`sender.id !== chrome.runtime.id`, mirroring `content.ts:210`'s existing pattern; it is elided to
`EXPECTED_EXTENSION_ID_UNUSED` above only because `chrome.runtime.id` is not reachable from this
shared, platform-agnostic file — the plan resolves it by passing the expected id in from the
constructor, kept out of this design summary for brevity.) The listener is torn down in every exit
path (`finally`), so a lookup that never streams (OpenAI/Anthropic, or Gemini's `connection.test`
call which never passes `onChunk`) registers nothing at all, and a completed/aborted/errored
lookup never leaks a listener.

### 4.8 `packages/app/src/ui/lookup-card.ts` — a new `CardState` kind + an accessibility fix

**New `CardState` union member** (additive to `lookup-card.ts:30-55`; this is a UI-layer type, not
`SavedWordEntry`/a wire schema, so it carries none of E1/E2's escalation weight):

```ts
| {
    kind: 'streaming';
    word: string;
    safeHtml: SafeHtml;
    /** A8: shown as soon as the header resolves; same shape as the 'result' variant's field. */
    definedAs?: { term: string; isIdiom: boolean };
  }
```

**`renderCardState`** (`lookup-card.ts:240-288`) gains a branch producing: the headword `<h2>`
(same as `'result'`), the defined-as row _without_ its "Show literal word" button (a fresh re-run
mid-stream would start a second, overlapping fetch — deliberately omitted, not wired to
`force-literal`), and the sanitized body `<div>`. **Deliberately omitted from the streaming
render**: the save row, the status toggle, the nudge banner, and the provider metadata/switch row —
all of `renderSaveRow`/`renderNudgeRow`/`renderMetaRow`'s affordances stay tied to the terminal
`'result'` state only, so the reader is never shown a Save button that silently no-ops (`content.ts`'s
`toggle-save` listener, `content.ts:150-171`, only ever populates `lastSavePayload` from a _final_
`renderResult` call — a save row on a still-streaming card would be a dead click). This makes the
loading → streaming → result transition an unambiguous one-way handoff: interactive affordances
appear exactly once, when the answer is actually final — a small, deliberate scope cut, not an
oversight.

`renderDefinedAsRow` (`lookup-card.ts:296-312`) gains a second, optional `interactive = true`
parameter (default preserves today's one call site's behavior exactly); the streaming branch calls
it with `interactive: false` to render the label without the button.

**Accessibility fix, made necessary by this card, not optional:** the card's shadow-DOM `region`
(`lookup-card.ts:530-533`) carries `aria-live="polite"` unconditionally today, wrapping every
`CardState` the card ever shows. Left as-is, a screen reader would attempt to (re-)announce the
_entire_ live region on every throttled partial repaint (§4.9) — even throttled to a fixed floor,
a repeating announcement every &lt;100 ms is unusable, not merely noisy. Fix: `LookupCard` gains

```ts
static get observedAttributes(): string[] {
  return ['data-streaming'];
}
attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
  if (name !== 'data-streaming' || !this.shadowRoot) return;
  this.shadowRoot.querySelector('.region')?.setAttribute('aria-live', next !== null ? 'off' : 'polite');
}
```

`observedAttributes`/`attributeChangedCallback` are standard Custom Elements v1 lifecycle hooks —
this is not a new mechanism, it is the same "an ATTRIBUTE crosses the MAIN/isolated-world boundary,
a JS property write does not" fact this file already documents and relies on for `data-ad-theme`
(the class doc comment at `inline-bottom-sheet-renderer.ts:32-37`: _"an attribute (shared DOM)
crosses the MAIN/isolated world boundary, a JS property write would not"_), extended to a second
host attribute. `InlineBottomSheetRenderer` (§4.9) toggles `data-streaming` on the card host
element — a shared-DOM attribute write, exactly like its existing `theme` setter already does for
`data-ad-theme` (`inline-bottom-sheet-renderer.ts:38-42`).

### 4.9 `packages/app/src/app/inline-bottom-sheet-renderer.ts` — `renderPartial` + throttle

```ts
private lastPartialPaintAt = -Infinity;
private readonly THROTTLE_MS = 80; // see §5 "throttle repaints" — bounded, imperceptible drop window

constructor(
  private readonly host: HTMLElement,
  private readonly sanitize: (md: string) => SafeHtml = sanitizeMarkdown,
  private readonly opts: { sidePanel?: boolean } = {},
  private readonly now: () => number = () => Date.now(), // DI seam, mirrors workflow.ts's own `now?`
) {}

renderPartial(word: string, markdown: string, definedAs?: { term: string; isIdiom: boolean }): void {
  const t = this.now();
  if (t - this.lastPartialPaintAt < this.THROTTLE_MS) return; // dropped: a later chunk or the
                                                                // final renderResult supersedes it
  this.lastPartialPaintAt = t;
  this.card = this.ensureCard();
  this.card.toggleAttribute('data-streaming', true); // shared-DOM attribute write, crosses worlds
  this.setState({ kind: 'streaming', word, safeHtml: this.sanitize(markdown), ...(definedAs ? { definedAs } : {}) });
}
```

`renderLoading` gains one line resetting `this.lastPartialPaintAt = -Infinity;` (a stale timestamp
from a previous, unrelated lookup must never throttle the very first partial repaint of a new one).
`renderResult`/`renderError`/`close` each call `this.card?.toggleAttribute('data-streaming', false)`
(or rely on `close()`'s existing `this.card = null`) so the live region is reliably back to
`aria-live="polite"` the instant a terminal state renders — the attribute is never left set once
streaming ends, by any exit path (success, error, or dismiss).

**Correctness under throttling is guaranteed by an existing, unmodified call, not by this
method.** `workflow.ts`'s `runLookup` (§4.10) still calls `deps.renderer.renderResult(result, ctx)`
exactly once, unconditionally, the instant `deps.client.lookup(...)` resolves — precisely as it
does today (`workflow.ts:115`). A partial repaint dropped by the 80 ms floor is never the reader's
last view of the card; the very next event loop turn either paints a newer partial or the final
result. This is why §5 can hold "every repaint of partial markdown must pass sanitization" _and_
throttle drops safely: a dropped repaint is a no-op, not a lost sanitize step, because nothing is
ever rendered without going through `this.sanitize(...)` first (every `setState` call in this class
already routes through `sanitizeMarkdown`, unchanged).

### 4.10 `packages/app/src/domain/workflow.ts` — wiring the callback

`runLookup`'s single `deps.client.lookup(req, { signal: controller.signal })` call
(`workflow.ts:80`) becomes:

```ts
const result = await deps.client.lookup(req, {
  signal: controller.signal,
  onChunk: (md, definedAs) => {
    if (!controller.signal.aborted) deps.renderer.renderPartial?.(e.text, md, definedAs);
  },
});
```

Guarded by `controller.signal.aborted` exactly like the existing `if (!controller.signal.aborted)
deps.renderer.renderResult(result, ctx);` guard three lines below it (`workflow.ts:115`) — a chunk
that resolves after a _newer_ selection has already aborted this run is dropped at the renderer
call site too (defense-in-depth alongside §4.4's router-side guard and §4.5's `chunkTabs` cleanup).
`WorkflowDeps` itself is unchanged — `renderer: ResultRenderer` already includes the new optional
`renderPartial?` member via §4.1's port change.

### 4.11 Chrome shell: `content.ts`, `chrome-side-panel-mirror.ts`, `side-panel.ts`

- **`content.ts`**: the inline object literal passed as `renderer:` to `runLookupWorkflow(...)`
  (`content.ts:76-113`) gains one key:
  `renderPartial(word, markdown, definedAs) { inline.renderPartial(word, markdown, definedAs); mirror.renderPartial(word, markdown, definedAs); }`
  — mirrors every existing key in that object (`renderLoading`/`renderResult`/`renderError` all
  fan out to both `inline` and `mirror` today, `content.ts:77-111`). `lastSavePayload`/
  `lastSaved`/`lastStatus` are **not** touched by this new key (§4.8's rationale: partial states
  never populate the save context; only the existing `renderResult` key does, unchanged).
- **`chrome-side-panel-mirror.ts`**: gains
  `renderPartial(word, markdown, definedAs) { this.post({ state: 'streaming', word, markdown, ...(definedAs ? { definedAs } : {}) }); }`
  — same `this.post(...)` helper every other method already uses (`chrome-side-panel-mirror.ts`,
  full file read above).
- **`side-panel.ts`**: the existing `chrome.runtime.onMessage.addListener` (`side-panel.ts:237-
275`) gains one `else if (msg.state === 'streaming')` branch setting
  `view.focusState = { kind: 'streaming', word: ..., safeHtml: sanitizeMarkdown(msg.markdown), ...(msg.definedAs ? { definedAs: msg.definedAs } : {}) }`
  — sanitized at the panel's own render boundary, exactly like `resultToFocus` already does for
  the terminal state (`side-panel.ts`'s comment at the top of `resultToFocus`: _"Markdown is
  (re-)sanitized here at the render boundary — never trust stored markdown as safe (S4)"_). **No
  change to `side-panel-view.ts`**: `PanelFocusState = CardState | { kind: 'empty' }`
  (confirmed by reading the file: `side-panel-view.ts:13`) and `renderFocus()`'s
  `renderCardState(this._focus)` call (`side-panel-view.ts:191`) already handles any `CardState`
  kind generically — the new `'streaming'` variant flows through with zero touch to this file.

## 5. Scope fence (from the card, held exactly)

- **"Every repaint of partial markdown must pass sanitization (S4, mandatory)."** Every partial
  paint is `this.sanitize(markdown)` inside `InlineBottomSheetRenderer.renderPartial` (§4.9) and
  `sanitizeMarkdown(msg.markdown)` inside `side-panel.ts`'s new branch (§4.11) — both routes
  through the _same, unmodified_ `sanitizeMarkdown()` (`markdown-sanitize.ts:67-82`), the sole
  authorized `SafeHtml` trust boundary in this codebase. No new function is ever allowed to cast a
  string to `SafeHtml`; none is added.
- **"Providers that can't stream fall back silently to today's behavior."** §3: OpenAI/Anthropic
  clients are byte-for-byte unchanged; `runHttpLookup`, `http-lookup-client.ts`, and both those
  client files have zero diff from this card.
- **"Lead decides: per-provider streaming vs. fallback."** §3's pin: Gemini only, v1.
- **Card fence, "no behavior change for non-streaming path"**: held two ways simultaneously —
  structurally (OpenAI/Anthropic code paths are untouched, §3) and functionally (a Gemini call
  with no `onChunk` — e.g. `handleConnectionTest`, cache hits which never call `client.lookup` at
  all — takes the exact pre-existing `runHttpLookup` branch, §4.3).
- **Constraint 4 (no background LLM calls)**: unaffected — this card adds no new fetch trigger;
  streaming only changes how the _existing_, already-user-triggered fetch delivers its response.
- **S1 (API-key isolation)**: unaffected — the key still never leaves `sw.ts`'s composition root
  (`getApiKey` closures, `sw.ts:84-96`, untouched); `LookupChunkMessage` (§4.6) carries only
  `requestId`/`markdown`/`definedAs`, never a key.
- **Design tokens only**: the new `'streaming'` `CardState` branch reuses the card's existing
  `::slotted(h2)`/`.defined-as`/`.err`-style light-DOM rules — no new CSS is added; the `region`'s
  `aria-live` toggle (§4.8) touches an ARIA attribute, not a style.

## 6. No change to these files (recorded explicitly)

`packages/app/src/wire.ts`, `packages/app/src/app/router.ts`'s `WireMessageSchema`/`WireReply`
usage (only `RouterDeps`/`handleLookup`'s internals change, §4.4 — the exported switch statement
and its arms are untouched), `packages/app/src/app/http-lookup-client.ts`,
`packages/app/src/app/openai-lookup-client.ts`, `packages/app/src/app/anthropic-lookup-client.ts`,
`packages/app/src/app/lookup-client-selector.ts` (already forwards `opts` generically,
`lookup-client-selector.ts:66`), `packages/app/src/domain/types.ts` (`LookupRequest`/`LookupResult`
are unchanged shapes — streaming is transport-only, not a new data field, so this is **not** an E1/
E2-style escalation), `packages/app/src/domain/defined-as.ts`, `translation-line.ts`,
`prompt-template.ts`, `default-template.ts` (reused exactly as written, zero edits),
`packages/app/src/ui/side-panel-view.ts` (§4.11), `packages/extension-chrome/src/manifest.json`
(§4.5 — no new permission), `packages/extension-safari/**` (Chrome-only card; Safari's shell
already degrades correctly with zero changes because Safari's presumed unmodified composition root
never sets `RouterDeps.onLookupChunk` — so §4.4's conditional spread never attaches an `onChunk` key
to `client.lookup(...)` at all for a Safari-routed request, not merely that Safari's Gemini client
chooses not to act on one. `GeminiLookupClient.lookup()` therefore sees an `opts` with no
`onChunk` — exactly what it would see with zero changes — and takes the pre-existing non-streaming
branch, §4.3; wiring Safari's `sw.ts`/`content.ts` to actually _use_ streaming is explicit future
work, not silently broken today).

## 7. Testing strategy

1. **Unit — new `packages/app/test/app/gemini-streaming.test.ts`.** Uses a hand-built
   `ReadableStream<Uint8Array>` (`new ReadableStream({ start(c) { c.enqueue(...); c.enqueue(...); c.close(); } })`)
   as the fake `res.body`, giving fully deterministic, non-flaky control over exactly how many
   `reader.read()` calls occur and what each one contains — the kind of control a real or mocked
   network layer cannot promise. Cases: (a) three SSE `data:` events split across two `enqueue()`
   calls accumulate into the correct final `markdown`, and `onChunk` is called with strictly
   growing text after each event once the header resolves; (b) a `DEFINED_AS`/`TRANSLATION` pair
   split mid-line across two chunks is never exposed to `onChunk` until both lines are complete
   (assert `onChunk`'s first call's `markdownSoFar` never contains the substring `"DEFINED_AS"`);
   (c) a response with no signal lines at all (a custom `promptEnvelope` override) still starts
   emitting once `HEADER_MAX_BUFFER_CHARS` is exceeded; (d) a non-OK response (429 with a
   `retry-after` header) before any stream starts maps through `mapError({kind:'http',...})`
   exactly like the non-streaming path's existing, asserted behavior
   (`gemini-lookup-client.test.ts`'s existing 429 case); (e) `opts.signal.abort()` mid-stream
   rejects with the caller's abort reason, never a mapped `LookupError` (mirrors
   `http-lookup-client.ts`'s own caller-cancel contract); (f) a timeout (`deps.timeoutMs` small,
   the stream never completes) rejects with `mapError({kind:'timeout'})`.
2. **Unit — `packages/app/test/app/gemini-lookup-client.test.ts`** (existing file, extended):
   calling `.lookup(req, { onChunk: fn })` invokes `runGeminiStreamingLookup` (assert the mocked
   `fetch` was called with `STREAM_ENDPOINT`, not `ENDPOINT`); calling `.lookup(req)` with no
   `onChunk` — the file's existing test suite, entirely unmodified — still passes exactly as
   before (a literal regression guard that the dispatch branch never fires unintentionally).
3. **Unit — `packages/app/test/app/router.test.ts`** (extended): `handleLookup` invokes
   `deps.onLookupChunk?.(requestId, ...)` when the injected `client.lookup` mock calls its
   `opts.onChunk`; a chunk arriving after `handleCancel` has marked the `requestId` cancelled is
   never forwarded to `onLookupChunk` (asserts the `cancelled.has(requestId)` guard from §4.4).
4. **Unit — `packages/app/test/app/message-relay-lookup-client.test.ts`** (extended): a fake
   `RuntimeLike` with a controllable `onMessage.addListener`/`removeListener` spy — pushing a
   matching `{type:'lookup.chunk', requestId, markdown}` through the registered listener invokes
   `opts.onChunk`; a chunk carrying a **different** `requestId` (a stale push from a superseded
   lookup) is ignored; the listener is removed after the call resolves (assert
   `removeListener` was called, and a subsequent push after resolution has no observable effect).
5. **Unit — `packages/app/test/workflow.test.ts`** (extended): a `FakeLookupClient` whose `impl`
   synchronously calls `opts.onChunk('partial', undefined)` before resolving — asserts
   `FakeResultRenderer` needs a `renderPartial` tracking field added (small, additive extension of
   the existing fake, §4.1) — a chunk delivered AFTER the workflow's own `inFlight.abort()` (a
   second selection superseding the first) never reaches the renderer (asserts the
   `controller.signal.aborted` guard, §4.10).
6. **Unit — `packages/app/test/ui/lookup-card.test.ts`** (extended): `renderCardState({kind:
'streaming', ...})` renders the headword + sanitized body and **not** a `.save-row`/`.status-
btn`/`.nudge-row`/`.meta-row` (asserts §4.8's deliberate omission); a `definedAs` renders the
   label but no `.defined-as__literal-btn` (asserts the `interactive:false` path); toggling
   `data-streaming` on a connected `<lookup-card>` flips `.region`'s `aria-live` between `"off"`
   and `"polite"` (asserts `attributeChangedCallback`, §4.8).
7. **Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`** (extended): a fake
   `now` DI (mirrors `router.test.ts`'s own `now` override pattern) proves two `renderPartial`
   calls under 80 ms apart produce only one light-DOM write, while two calls ≥80 ms apart both
   paint; `renderPartial` sets `data-streaming` on the card host, and `renderResult`/`renderError`/
   `close` clear it; `renderLoading` resets the throttle clock (a `renderPartial` immediately after
   a fresh `renderLoading` always paints, regardless of a previous lookup's timing).
8. **Unit — `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.test.ts`** (extended):
   `renderPartial(...)` posts `{to:'side-panel', state:'streaming', word, markdown, definedAs?}`
   via the existing `this.post(...)` helper, mirroring this file's existing assertion style
   exactly.
9. **e2e — new `packages/extension-chrome/e2e/a1-streamed-answers.spec.ts`** (Task 8's exact
   spec): (a) a new `mockGeminiStream(context, events: string[])` helper (added to
   `packages/extension-chrome/e2e/helpers.ts`, alongside `mockGemini`/`mockOpenAI`) routes
   `**/*:streamGenerateContent*` and fulfills with a `text/event-stream` body built by joining
   `events.map(e => \`data: ${e}\n\n\`)`; the test defines a word, asserts the mock's URL was the
*streaming* endpoint (not the plain `:generateContent`one`mockGemini`targets), and asserts
the final rendered card matches the fully-accumulated text; (b) selecting a **second** word
before the first Gemini stream settles still results in exactly one`lookup.cancel`message and
a final card showing only the second word's definition (proves §4.2's abort propagation
end-to-end, not just at the unit level). **Deliberately not asserted in e2e**: the exact
*number* or *timing* of intermediate`'streaming'`-state repaints — Playwright's mocked-route
response delivery does not give the same deterministic multi-`read()`control a hand-built`ReadableStream`does (§7.1), so asserting on transient frame counts here would be a flake
surface with no corresponding correctness gain; that guarantee is already fully covered,
deterministically, by unit test 1 above. **Existing regression guards, unmodified, re-run in
the final gate**:`provider-selection.spec.ts`, `provider-fallback.spec.ts`,
`provider-errors.spec.ts`(prove OpenAI/Anthropic still render exactly as before),`lookup-pending-dismiss.spec.ts`, `cooldown.spec.ts` (prove the general cancel/dismiss
   mechanics this card's new abort path reuses, §4.2, are unbroken).

## 8. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this
PR.** The PR body's "Testing performed" section lists the suites above with pass counts — unit
(`bun run --filter @ai-dict/app test`, `bun run --filter @ai-dict/extension-chrome test`), lint,
format-check, typecheck (both packages), and the e2e scenarios named in §7.9 plus the regression
guards, run with `GEMINI_API_KEY= bun run build:chrome:e2e` per this repo's standing e2e-build
constraint. No `pr-assets/*` branch is created.

## 9. Risk / rollback

- **Risk: moderate.** This is genuinely new infrastructure (REPO-FACTS: "no streaming support
  exists anywhere… greenfield"), not a delta on an existing mechanism — the SSE parsing loop
  (§4.2) and the header-withholding heuristic are the newest, least-precedented code in this
  card. Both are fully unit-testable with a hand-built `ReadableStream` (§7.1), which is why that
  suite is the most load-bearing test in this plan.
- **Blast radius is deliberately narrow.** §6 lists nine files/areas this card provably does not
  touch; the OpenAI/Anthropic code paths and the entire non-streaming Gemini path are structurally
  unreachable to change (§3, §4.3) — a regression in streaming cannot silently degrade a
  non-streaming lookup's correctness, only (at worst) Gemini's streaming preview quality.
- **Failure mode if the SSE parser has a bug:** worst case, `runGeminiStreamingLookup` throws
  (mapped to `PARSE`/`NETWORK`/`UNKNOWN` via the exact same `mapError` calls the non-streaming path
  already uses) — the reader sees the existing, already-shipped error card, not silent data loss
  or a stuck spinner. There is no path where a broken partial-parse corrupts the final result: the
  final `LookupResult` is built once, from the fully-accumulated `raw` buffer, at the very end.
- **No data migration.** `LookupResult`/`SavedWordEntry`/cache/history shapes are all unchanged —
  nothing persisted differs from today.
- **Rollback:** revert the single PR. `GeminiLookupClient.lookup()` reverts to always taking the
  `runHttpLookup` branch; every other file listed in §6 was never touched.

## 10. Files touched (summary)

| File                                                                 | Change                                                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/ports.ts`                                          | + `LookupClient.lookup`'s `opts.onChunk?`, + `ResultRenderer.renderPartial?`                                                                                                           |
| `packages/app/src/app/gemini-streaming.ts`                           | **new** — the SSE streaming client (§4.2)                                                                                                                                              |
| `packages/app/src/app/gemini-lookup-client.ts`                       | export `MODEL`; dispatch to streaming when `opts.onChunk` present                                                                                                                      |
| `packages/app/src/app/router.ts`                                     | `RouterDeps.onLookupChunk?`; `handleLookup` wires it through `client.lookup`'s `onChunk`                                                                                               |
| `packages/app/src/app/lookup-chunk-message.ts`                       | **new** — `LookupChunkMessage` + `isLookupChunkMessage` (§4.6)                                                                                                                         |
| `packages/app/src/app/message-relay-lookup-client.ts`                | `RuntimeLike.onMessage?`; scoped per-request chunk listener                                                                                                                            |
| `packages/app/src/domain/workflow.ts`                                | `runLookup` wires `onChunk` → `deps.renderer.renderPartial?` with an abort guard                                                                                                       |
| `packages/app/src/ui/lookup-card.ts`                                 | + `CardState` `'streaming'` kind; `renderCardState` branch; `renderDefinedAsRow(..., interactive)`; `observedAttributes`/`attributeChangedCallback` for `data-streaming` → `aria-live` |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`               | + `renderPartial` (throttled) + `data-streaming` toggle + `renderLoading` throttle reset                                                                                               |
| `packages/app/src/index.ts`                                          | re-export `lookup-chunk-message.ts`'s new names                                                                                                                                        |
| `packages/extension-chrome/src/sw.ts`                                | `chunkTabs` map; `onLookupChunk` → `chrome.tabs.sendMessage`                                                                                                                           |
| `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts` | + `renderPartial`                                                                                                                                                                      |
| `packages/extension-chrome/src/content.ts`                           | renderer object gains `renderPartial` fanning out to `inline`+`mirror`                                                                                                                 |
| `packages/extension-chrome/src/side-panel.ts`                        | onMessage listener gains a `'streaming'` branch                                                                                                                                        |
| `packages/extension-chrome/e2e/helpers.ts`                           | + `mockGeminiStream`                                                                                                                                                                   |
| `packages/extension-chrome/e2e/a1-streamed-answers.spec.ts`          | **new** — functional e2e (§7.9)                                                                                                                                                        |
| + matching `*.test.ts` files for every unit-tested item above        | see §7                                                                                                                                                                                 |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/http-lookup-client.ts`,
`packages/app/src/app/openai-lookup-client.ts`, `packages/app/src/app/anthropic-lookup-client.ts`,
`packages/app/src/app/lookup-client-selector.ts`, `packages/app/src/domain/types.ts`,
`packages/app/src/domain/defined-as.ts`, `translation-line.ts`, `prompt-template.ts`,
`default-template.ts`, `packages/app/src/ui/side-panel-view.ts`,
`packages/extension-chrome/src/manifest.json`, or any Safari file (§6).

## 11. Concurrency

Per CONTRACTS §5's hot-file registry, this card modifies files also touched by other unshipped
Category A/B cards — the orchestrator must serialize against these, not run them concurrently:

- **`packages/app/src/ui/lookup-card.ts`** — also a hot file for A2, A3, A5, A7, A10. This card
  adds one `CardState` union member + a `renderDefinedAsRow` parameter + the
  `observedAttributes`/`attributeChangedCallback` lifecycle pair; any of A2/A3/A5/A7/A10 landing
  concurrently would need to rebase past this card's `CardState` union and `renderCardState`
  switch changes.
- **`packages/app/src/app/inline-bottom-sheet-renderer.ts`**, **`content.ts`** — hot for A5/A6/
  A13/A14/A15 (content-script/trigger surface) via `content.ts`; this card's changes there are
  additive (one new renderer key, one new constructor param with a default) but still a merge-
  conflict surface.
- **`packages/app/src/app/router.ts`** — hot for "any card adding messages." This card does
  **not** add a `WireMessageSchema` arm (§2), but it does add a `RouterDeps` field and a line
  inside `handleLookup` — a card that also edits `handleLookup` (none currently known to) would
  conflict.
- **`packages/app/src/ports.ts`** — not separately listed in CONTRACTS §5's registry, but every
  card touching `ResultRenderer`/`LookupClient` shares it; flagged here because this card is the
  first to add an optional method to `ResultRenderer` since the registry was written.
- **`packages/app/src/domain/workflow.ts`** — also touched by the already-merged A5 (gloss mode)
  and A6 (smart card placement) plans: A5 adds an `anchor` parameter to the `renderLoading` call
  site and an `anchor: e.anchor` field to the `ctx` object literal (A5 design spec §9's
  Concurrency section flags this same file for orchestrator awareness); A6 design spec §7
  explicitly recommends serializing A1 against A6 on this exact file, since A1 "is the card most
  likely to also touch `runLookupWorkflow`'s render-call sequence." This card's own change here
  is the single-line `onChunk` addition to the `deps.client.lookup(...)` call (§4.10) — additive,
  but on the same call site A5 and A6 also touch, so serialize against whichever of A1/A5/A6 is
  in flight first; the others rebase past it.
- **`packages/app/test/fakes/index.ts`** — also touched by A5 (adds a `loadingAnchor` field +
  widened `renderLoading` signature to `FakeResultRenderer`, per A5's design spec §9 and plan
  Task 2) and, by the same reasoning as `workflow.ts` above, a likely touch point for A6. This
  card adds a `partials` field + `renderPartial` method to the same class (§7.5) — a small,
  additive extension, but the same shared test fixture, so serialize against A5/A6 here too.
- **Side panel (`side-panel.ts`)** — hot for A2/B6/B10/B11; this card's addition is one `else if`
  branch, low conflict risk but still worth sequencing awareness.
