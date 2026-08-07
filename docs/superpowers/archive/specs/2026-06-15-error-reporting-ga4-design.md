# Consent-Gated Error Reporting → GA4

**Date:** 2026-06-15
**Status:** Approved design, pending spec review
**Component scope:** `c3-1 app` (domain + ports + UI), `c3-2 extension-chrome` (adapters + composition root + manifest)

## Problem

AI Dictionary is shipping to the Chrome Web Store. It is fully client-side —
the user brings their own Gemini/OpenAI key and "nothing leaves the machine"
is a core selling point. We still need to learn when the extension breaks in
the wild **without** running a server or silently exfiltrating data. The most
valuable signal is the **provider API error response** (Gemini/OpenAI): that is
where most real-world failures originate (bad keys, quota, model errors,
malformed responses).

## Goal

Capture client-side errors, hold them locally, and — only after the user
consents — forward an **anonymous error signature** to Google Analytics 4 via
the Measurement Protocol (no server, Google-native, free).

## Decisions (locked)

| Decision          | Choice                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Scope             | **Bug/error reports only** — no usage analytics.                                                                    |
| Trigger           | **Silent local buffer + escalating consent prompts.**                                                               |
| Transport         | **GA4 Measurement Protocol** (`google-analytics.com/mp/collect`).                                                   |
| Consent memory    | **Standing consent.** First "Yes" → auto-send afterward; settings off-switch.                                       |
| Prompt thresholds | First prompt at **3** buffered unsent errors, then **Fibonacci**: 3 → 5 → 8 → 13 → 21 … (advances on each decline). |
| Payload           | **Signature only** (no full stack traces). Emphasis on the **provider error response**.                             |
| Page identity     | **Domain only** (hostname, never full URL/path) + PII-redacted context snippet.                                     |
| Buffer cap        | **Last 100** errors (oldest dropped).                                                                               |

## Architecture (fits the C3 lean hexagon)

One-way deps; pure domain; communication only through ports
(`ref-core-dependency-rule`, `ref-dependency-injection`).

### Pure domain — `packages/app/src/domain/` (`rule-domain-purity`, zero platform deps)

- **`error-record.ts`** — `toErrorRecord(input: ErrorInput, meta): ErrorRecord`.
  Reuses the existing `ErrorInput` taxonomy from `error-mapper.ts`. Emphasis on
  `kind: 'http'` (provider response): captures `status`, `geminiStatus`,
  `retryAfterSec`, `provider`. Applies `redactPII()` (existing) + the API-key
  `sanitize()` scrub (existing, lift/share from `error-mapper.ts`) over every
  free-text field. `domain` = hostname only.
- **`report-policy.ts`** — pure decision function:
  `decide({ unsentCount, thresholdIndex, consent }) → 'silent' | 'prompt' | 'send'`.
  Encodes Fibonacci thresholds + standing consent. No I/O. Fully unit-testable.
- **`error-buffer.ts`** — pure `append(buffer, record, cap=100)` (drops oldest
  beyond cap) and `clear()`.

### Ports — `packages/app/src/ports.ts`

- **`TelemetrySink { send(events: ErrorRecord[]): Promise<void> }`** — new port.
- Reuse the existing **`Storage`** port for the buffer (new KV prefix
  `errlog:`, per `ref-kv-storage-prefixes`).

### Data model

The achievable provider-error **signature**. Discovered during planning:
`mapError()` _consumes_ the raw HTTP status and `geminiStatus` to choose a
`LookupErrorCode`, so by the time an error reaches the message boundary only the
distilled `code` survives. That enum **is** the Gemini-response signature
(`INVALID_KEY` = bad/expired key, `RATE_LIMIT` = quota/429, `PARSE` = malformed
model output, `NETWORK` = offline/timeout, `UNKNOWN` = 5xx/other). We capture
that — no plumbing of raw status, no wire-schema change.

```ts
interface ErrorRecord {
  ts: number; // epoch ms
  source: 'lookup' | 'connection.test' | 'thrown'; // originating message type
  code: string; // LookupErrorCode ('NO_KEY'|'INVALID_KEY'|…) or 'THROWN'
  provider?: 'gemini' | 'openai'; // active provider, read from settings at capture
  message: string; // redacted + key-scrubbed, ≤150 chars (provider-derived)
  retryable?: boolean;
  retryAfterSec?: number;
  domain?: string; // hostname only, e.g. 'nytimes.com' (from req.url)
  extVersion: string; // chrome.runtime.getManifest().version
  browserVersion: string; // parsed from navigator.userAgent
}
```

### Capture mechanism (zero domain/wire change)

All errors already funnel to the SW's `chrome.runtime.onMessage` handler as
either a resolved `{ ok: false, type, error }` reply (lookup/connection.test
provider errors) or a thrown rejection. The reporter hooks **there** — inspect
`reply.ok === false` in the existing `.then`, and the existing `.catch` for
thrown — so the pure router and domain are untouched (`rule-domain-purity`,
`ref-core-dependency-rule` preserved).

### KV state (`errlog:` prefix)

| Key                      | Value                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `errlog:buffer`          | JSON array of `ErrorRecord` (capped at 100).                                                                               |
| `errlog:consent`         | `'unset' \| 'granted' \| 'disabled'`. `granted` = standing auto-send; `disabled` = user turned it off (never prompt/send). |
| `errlog:threshold-index` | integer index into the Fibonacci ladder; advances on each decline.                                                         |
| `errlog:client-id`       | random UUID (anonymous GA4 `client_id`, persisted).                                                                        |

### New wire messages (extension surfaces ↔ SW)

- `errlog.status` → reply `{ ok, type: 'errlog', consent, pending, count }` —
  read by the content script (to decide whether to show the card footer) and by
  the settings toggle.
- `errlog.set-consent { state: 'granted' | 'declined' | 'disabled' }` → ack.
  `granted` flushes the buffer to GA4 + sets standing consent; `declined`
  advances the Fibonacci rung (soft no); `disabled` is the settings off-switch.

### Prompt surface: in-page error card footer

When a lookup fails, the in-page result card is already rendering the error.
After rendering, the content script sends `errlog.status`; if `pending` and
`consent === 'unset'`, it appends a consent footer to the card
("Seen a few errors — send anonymous reports to help fix them? [Send] [Not
now]"). Contextual, no random popups, highest reach. Buttons send
`errlog.set-consent`.

### Adapters / composition root — `packages/extension-chrome/src/`

GA4 calls live **only in `sw.ts`** so the `api_secret` never reaches a content
script (`rule-api-key-isolation` S1; inbound messages still gated by
`rule-gate-runtime-messages` S3).

- **GA4 adapter** (`adapters/`): `TelemetrySink` impl. POSTs to
  `https://www.google-analytics.com/mp/collect?measurement_id=…&api_secret=…`.
  One GA4 event per record: `event_name: 'extension_error'`, params:
  `code`, `provider`, `http_status`, `provider_status`, `domain`,
  `ext_version`, `browser_version`, `msg` (≤100 chars). Uses persisted
  anonymous `client_id`.
  - **GA4 constraints accepted:** param values truncate at ~100 chars, ~25
    params/event. We send a **signature only** — no multi-line stack traces.
    This is sufficient because the target signal is the short provider status +
    HTTP code.
- **Consent-prompt web component** (`packages/app/src/ui/`, shadow DOM per
  `ref-web-components-shadow-dom`): shows the buffered count **and the exact
  redacted payload that would be sent** (transparency = the privacy-brand
  answer) with **Yes / No**.

### Build-time secrets

`measurement_id` + `api_secret` injected via `build-defines` (see
`build-defines.d.ts`) — not committed in source. GA4 MP `api_secret` is
write-only (cannot read data), low-sensitivity, but still kept out of the repo
and out of content scripts.

### Manifest / CSP change

Add `https://www.google-analytics.com` to `connect-src` in
`manifest.json` `content_security_policy.extension_pages`.

## Data flow

1. An error occurs (lookup failure or thrown in SW) → SW builds a redacted
   `ErrorRecord` → `append()` to `errlog:buffer`.
2. SW calls `decide({ unsentCount, thresholdIndex, consent })`:
   - `consent === 'granted'` → **send** buffer to GA4, clear buffer (silent
     auto-send from here on).
   - `unsentCount >= fib(thresholdIndex)` (ladder starting at 3) → **prompt**.
   - else → **silent**.
3. Consent prompt → Yes / No:
   - **Yes** → `consent = 'granted'`; flush buffer to GA4; clear buffer. Future
     errors auto-send silently.
   - **No** → advance `threshold-index` to next Fibonacci rung; keep buffering;
     back off.
4. **Settings** gains: an **off-switch** (revoke standing consent → back to
   `unset`) and **"Clear buffered reports"**. Required for the Web Store
   privacy disclosure and user control.

## Privacy & Web Store disclosure

- Disclose: "Collects anonymous error reports (error type, provider HTTP
  status, redacted message, page domain, extension/browser version) **only
  after you consent**. No page content, no full URLs, no API keys. Anonymous
  random client id." Add to README + Web Store privacy form.
- `client_id` is a random UUID, not tied to any identity.
- Redaction reuses the audited domain-pure `redactPII()` + key scrub.

## Testing (TDD)

- **Pure domain unit tests:**
  - `report-policy`: Fibonacci progression 3 → 5 → 8 → 13 → 21; decline advances
    rung; grant short-circuits to `send`; standing consent → always `send`.
  - `error-buffer`: cap at 100, oldest dropped, clear empties.
  - `error-record`: redaction + key-scrub applied to every free-text field;
    domain reduced to hostname; provider HTTP fields captured.
- **Adapter test:** GA4 payload shape (event name, params, truncation),
  redaction present, `client_id` stable.
- **e2e (bundled Chromium, not installed Chrome):** 3 errors → prompt appears;
  decline → silent until 5th; accept → buffer flushed + send invoked; settings
  off-switch stops sending.

## Out of scope (YAGNI)

- Usage/product analytics, funnels, retention.
- Full stack-trace capture or local "export reports" UI.
- Safari shell wiring (Chrome first; Safari mirrors later if needed).
- Server-side aggregation beyond the GA4 dashboard.

## Open risks

- **GA4 readability:** GA4 is built for aggregate metrics, not reading
  individual bug reports. Expect to diagnose from _signatures and counts_
  (which provider status spikes, on which version), not from rich repro detail.
  Accepted trade-off of choosing GA4 over a Google Form.
