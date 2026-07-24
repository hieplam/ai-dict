import type { Provider } from './types';

/** Which known provider's key shape a prefix matches, or 'unknown' if it matches none. */
export type KeyPrefixClass = Provider | 'unknown';

/** A non-blocking hint to show inline next to a key field (roadmap C5 scope fence: hints only). */
export interface KeyHint {
  tone: 'warning';
  message: string;
}

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
];

/**
 * Clean up paste artifacts before a key is stored: trim surrounding whitespace (incl. the
 * trailing newline a copy from a terminal or key-issuing page commonly carries), then strip ONE
 * layer of matching wrapping quotes (straight or "smart" — a paste from a chat app or notes file
 * commonly adds these), re-trimming afterward for `" AIza… "`-shaped input. Only one layer is
 * stripped, so a key that legitimately contains a quote character elsewhere is untouched.
 */
export function normalize(raw: string): string {
  const trimmed = raw.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Classify an (already-normalized) key by its known prefix. `sk-ant-` is checked before the
 * shorter `sk-` so an Anthropic key is never misclassified as OpenAI's.
 */
export function classifyPrefix(key: string): KeyPrefixClass {
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  return 'unknown';
}

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

// A real key from any of the three providers is comfortably longer than this — Gemini's AIza…
// keys, the shortest of the three shapes this product talks to, run ~39 chars. Anything shorter
// reads as a truncated paste or placeholder text, not a real key from any provider.
const MIN_PLAUSIBLE_LENGTH = 20;

function looksMalformed(key: string): boolean {
  return key.length < MIN_PLAUSIBLE_LENGTH || /\s/.test(key);
}

/**
 * Heuristic hint for `normalizedKey` pasted into `targetProvider`'s field. `null` when nothing
 * looks off, including for an empty key (emptiness is the caller's own required-field validation,
 * not this module's concern). A recognized OTHER provider's prefix is reported first (most
 * specific, most actionable); otherwise a generic too-short/has-whitespace check applies
 * regardless of prefix match, since a matching prefix alone doesn't guarantee a well-formed key.
 * Never echoes `normalizedKey` in the message (S1) — only provider labels appear in copy.
 */
export function hintFor(targetProvider: Provider, normalizedKey: string): KeyHint | null {
  if (normalizedKey.length === 0) return null;
  const cls = classifyPrefix(normalizedKey);
  if (cls !== 'unknown' && cls !== targetProvider) {
    return {
      tone: 'warning',
      message: `This looks like a ${PROVIDER_LABEL[cls]} key, not a ${PROVIDER_LABEL[targetProvider]} key.`,
    };
  }
  if (looksMalformed(normalizedKey)) {
    return {
      tone: 'warning',
      message: `This doesn't look like a typical ${PROVIDER_LABEL[targetProvider]} API key.`,
    };
  }
  return null;
}
