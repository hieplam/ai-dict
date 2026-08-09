/**
 * A12 — non-English source pages. A fixed, code-owned table of BCP-47 primary-subtag source
 * languages this build recognizes for {source_lang} detection/override, mirroring how
 * {target_lang} already rides the prompt as a bare code (settings-form.ts's #target select ships
 * 'vi'/'en', not "Vietnamese"/"English") — {source_lang} follows the same convention. Human-
 * readable display names for the on-card override picker are a UI-only concern
 * (ui/lookup-card.ts's SOURCE_LANG_LABELS), exactly mirroring the Provider/PROVIDER_LABELS split.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

/** Canonical order — also the order the card's override picker lists them in. */
export const SOURCE_LANG_CODES = [
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
  'ru',
  'vi',
  'ar',
  'hi',
  'pl',
  'tr',
  'sv',
  'el',
  'th',
  'id',
  'en',
] as const;

export type SourceLangCode = (typeof SOURCE_LANG_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(SOURCE_LANG_CODES);

/** Lowercase + take the primary subtag: "fr-CA" -> "fr", "en-US" -> "en", "EN" -> "en". */
export function primarySubtag(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Resolve a raw page/element `lang` attribute value (as captured by
 * app/dom-selection-source.ts's readPageLang) to a recognized SourceLangCode, or undefined when
 * absent or unrecognized. Callers fall back to the neutral auto-phrase in that case — see
 * domain/prompt-template.ts's use of default-template.ts's AUTO_SOURCE_LANG_PHRASE.
 */
export function detectSourceLangCode(pageLang: string | undefined): SourceLangCode | undefined {
  if (!pageLang) return undefined;
  const code = primarySubtag(pageLang);
  return CODE_SET.has(code) ? (code as SourceLangCode) : undefined;
}
