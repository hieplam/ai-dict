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

// Verbatim from error-mapper.ts. Transport is matched FIRST so a card that somehow carries
// both messages can never be reported as drift — a false drift alarm would burn the signal.
const TRANSPORT = [
  'Network failed. Check connection and retry.',
  'Gemini server error. Retry.',
  'Hit Gemini rate limit.',
];
const SETUP = ['Google rejected the API key.', 'Add your Gemini API key in Settings.'];
const CONTRACT = ['Gemini returned unexpected output.'];

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
