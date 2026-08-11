import { mapError } from './error-mapper';

/**
 * The verdict for one live-API e2e run, decided from the card's rendered text alone.
 *
 * - `transport` — the provider was momentarily unreachable or refusing (timeout, 5xx, 429).
 *   Not our defect and genuinely intermittent, so callers warn instead of failing.
 * - `setup`     — our credentials are wrong or missing. Deterministic and actionable; failing
 *   loudly is what stops live coverage from silently disappearing behind a dead key.
 * - `contract`  — the provider answered but our parser produced nothing usable. This is the
 *   drift case the live spec exists to catch, and it is deterministic: the 2026-08-09 SSE
 *   framing bug failed 100/100 lookups.
 * - `ok`        — a definition rendered.
 */
export type LiveOutcome =
  | { kind: 'ok' }
  | { kind: 'transport'; detail: string }
  | { kind: 'setup'; detail: string }
  | { kind: 'contract'; detail: string };

// Derived from error-mapper.ts's actual mapError() output for the gemini provider — NOT
// retyped literals — so a future wording tweak to error-mapper.ts changes these automatically
// instead of silently drifting out of sync with what the card can actually render. Transport is
// matched FIRST so a card that somehow carries both messages can never be reported as drift — a
// false drift alarm would burn the signal.
const TRANSPORT = [
  mapError({ kind: 'offline' }).message, // 'Network failed. Check connection and retry.'
  mapError({ kind: 'http', status: 500 }).message, // 'Gemini server error. Retry.'
  mapError({ kind: 'http', status: 429 }).message, // 'Hit Gemini rate limit.'
];
const SETUP = [
  mapError({ kind: 'http', status: 401 }).message, // 'Google rejected the API key.'
  mapError({ kind: 'no-key' }).message, // 'Add your Gemini API key in Settings.'
];
const CONTRACT = [mapError({ kind: 'parse' }).message]; // 'Gemini returned unexpected output.'

/** Minimum body length that separates a rendered definition from an empty/stub card. */
export const MIN_DEFINITION_CHARS = 60;

export function classifyCardText(text: string): LiveOutcome {
  const hit = (needles: string[]): string | undefined => needles.find((n) => text.includes(n));

  const transport = hit(TRANSPORT);
  if (transport !== undefined) return { kind: 'transport', detail: transport };

  const setup = hit(SETUP);
  if (setup !== undefined) return { kind: 'setup', detail: setup };

  const contract = hit(CONTRACT);
  if (contract !== undefined) return { kind: 'contract', detail: contract };

  if (text.trim().length < MIN_DEFINITION_CHARS)
    return { kind: 'contract', detail: `card rendered only ${text.trim().length} characters` };

  return { kind: 'ok' };
}

/**
 * Decide whether one poll of the card counts as "settled" or must keep polling, given its
 * rendered text and whether the DOM still carries the `data-streaming` attribute. Pure — takes
 * both DOM reads as plain values (the caller is responsible for performing them) so the decision
 * is unit-testable without a browser, per pure-core.md: I/O stays at the edge, the verdict is a
 * function of its inputs alone.
 *
 * - A short, message-free card ('contract' by length alone, no matched error string) is "still
 *   loading" — never settle on it.
 * - Any other non-'ok' kind (transport/setup, or 'contract' WITH a matched message) can only be
 *   produced by a terminal renderError — settled on sight.
 * - 'ok' can still be a mid-stream repaint (renderPartial keeps painting `{kind:'streaming'}`
 *   past MIN_DEFINITION_CHARS), so it additionally requires `isStreaming` to be false.
 */
export function classifyPoll(text: string, isStreaming: boolean): 'settled' | 'poll' {
  const outcome = classifyCardText(text);
  const belowThreshold = outcome.kind === 'contract' && !text.includes('unexpected output');
  if (belowThreshold) return 'poll';
  if (outcome.kind !== 'ok') return 'settled';
  return isStreaming ? 'poll' : 'settled';
}

/**
 * Decide the verdict when the card never settled within the poll timeout. `sawStreaming` records
 * whether `data-streaming` was ever observed true during polling — its presence proves Gemini
 * answered and bytes reached the renderer, so a subsequent timeout is a rendering regression
 * (`contract`) at least as severe as the 2026-08-09 SSE-framing bug, not a transport symptom. Its
 * absence means the card never even started streaming, which IS a transport symptom.
 */
export function classifyTimeout(sawStreaming: boolean, timeoutMs: number): LiveOutcome {
  if (sawStreaming) {
    return {
      kind: 'contract',
      detail:
        `card began streaming but never reached a terminal state within ${timeoutMs}ms ` +
        '(data-streaming stuck true) — Gemini answered but rendering never completed',
    };
  }
  return {
    kind: 'transport',
    detail: `card never settled within ${timeoutMs}ms`,
  };
}
