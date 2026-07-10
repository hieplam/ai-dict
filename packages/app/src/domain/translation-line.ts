/**
 * B2 — rich context capture. Extracts the model's TRANSLATION signal line (emitted per
 * PROMPT_ENVELOPE's {translation_instruction} slot — see default-template.ts) from the raw
 * response text, and returns the remaining body with that line (plus one immediately following
 * blank line) stripped.
 *
 * Mirrors parseDefinedAs's contract exactly (domain/defined-as.ts) — decoupled from the
 * user-customizable Card format (`outputFormat`) so a saved word's translation is captured
 * reliably regardless of how the reader has edited (or removed) the visible
 * "Eng -> {target_lang}" section.
 *
 * Pure text processing — no translation happens here. If the model didn't emit a recognisable
 * TRANSLATION line (legacy cached/history entries, a non-compliant model, or a custom prompt
 * envelope override that omits {translation_instruction}), `translation` is undefined and `body`
 * is the ENTIRE input text unchanged — a strict superset of pre-B2 behavior.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */
const TRANSLATION_LINE = /^TRANSLATION:\s*"([^"]+)"[ \t]*$/m;

export function parseTranslation(markdown: string): { translation?: string; body: string } {
  const match = TRANSLATION_LINE.exec(markdown);
  if (!match) return { body: markdown };
  const [line, translation] = match;
  // Leading whitespace/blank lines (or preceding text) before the matched line are trimmed.
  const before = markdown.slice(0, match.index).trim();
  // Strip the matched line's own line terminator, then (at most) one following blank line's
  // terminator — anything beyond that single blank line survives in the body untouched.
  const after = markdown
    .slice(match.index + line.length)
    .replace(/^\n/, '')
    .replace(/^\n/, '');
  return {
    translation: translation!,
    body: before ? `${before}\n${after}` : after,
  };
}
