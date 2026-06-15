/**
 * Input-side PII redaction for free-text values that leave the device with a
 * lookup (today: the page title wired into the prompt envelope). This is a
 * pragmatic, low-false-positive title filter — it catches the common shapes of
 * the listed PII types, NOT an exhaustive scrubber. It complements
 * `rule-sanitize-model-output` (which guards model OUTPUT) by guarding INPUT.
 *
 * Domain-pure: zero imports, no platform APIs (rule-domain-purity).
 */

/** One named PII category and the pattern that detects it. */
export interface PiiRule {
  type: 'email' | 'phone' | 'credit-card' | 'ssn' | 'ip';
  /** Must be a global regex so `String.replace` masks every occurrence. */
  pattern: RegExp;
}

/** The PII detection table. Order: most-specific shapes first. */
export const PII_BLACKLIST: PiiRule[] = [
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // 13–16 digit groups with optional single space/dash separators (cards).
  { type: 'credit-card', pattern: /\b\d(?:[ -]?\d){12,15}\b/g },
  { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // US-style 10-digit phone with optional country code and common separators.
  { type: 'phone', pattern: /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { type: 'ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

/** Mask every PII match in `text` with the literal token `[redact]`. */
export function redactPII(text: string): string {
  return PII_BLACKLIST.reduce((s, rule) => s.replace(rule.pattern, '[redact]'), text);
}
