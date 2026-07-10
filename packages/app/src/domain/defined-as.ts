/**
 * A8 — phrase & idiom expansion. Extracts the model's DEFINED_AS signal line (emitted per the
 * PROMPT_ENVELOPE's idiom instruction — see default-template.ts) from the raw response text,
 * and returns the remaining body with that line (plus one immediately following blank line)
 * stripped.
 *
 * Pure text processing — no idiom detection happens here (roadmap A8 scope fence: "No
 * idiom-detection engine — the LLM already holds the sentence"). If the model didn't emit a
 * recognisable DEFINED_AS line (legacy behavior, a non-compliant model, or a custom prompt
 * envelope override that omits the instruction), `definedAs` is undefined and `body` is the
 * ENTIRE original text unchanged — a strict superset of pre-A8 behavior.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
export interface DefinedAs {
  term: string;
  isIdiom: boolean;
}

// Trailing whitespace is confined to `[ \t]*` (not `\s*`) so the match never swallows any of
// the newlines that follow the line — those are stripped deliberately below instead.
const DEFINED_AS_LINE = /^DEFINED_AS:\s*"([^"]+)"\s*\|\s*(idiom|literal)[ \t]*$/m;

export function parseDefinedAs(markdown: string): { definedAs?: DefinedAs; body: string } {
  const match = DEFINED_AS_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, term, tag] = match;
  // Leading whitespace/blank lines before the matched line are noise — dropped entirely.
  const before = markdown.slice(0, match.index).trim();
  // Strip the matched line's own line terminator, then (at most) one following blank line's
  // terminator — anything beyond that single blank line survives in the body untouched.
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    definedAs: { term: term!, isIdiom: tag === 'idiom' },
    body: before ? `${before}\n${after}` : after,
  };
}
