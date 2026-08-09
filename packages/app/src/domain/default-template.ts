/**
 * The prompt is assembled from two parts (see `buildPrompt` in prompt-template.ts):
 *
 *  - PROMPT_ENVELOPE — code-owned scaffold. Holds the persona, the {word}/{context}/
 *    {title} placeholders, the idiom-detection instruction slot, the safety + length
 *    constraints, and one {output_format} slot. Users cannot edit or delete any of this, so
 *    the constraints always ship (defense-in-depth for rule-sanitize-model-output).
 *  - DEFAULT_OUTPUT_FORMAT — the ONLY user-editable piece (the "Card format" field):
 *    the section layout shown in the card.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

import type { RefineKind } from './types';

export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

{idiom_instruction}

{translation_instruction}

{refine_instruction}

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;

export const DEFAULT_OUTPUT_FORMAT = `1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).
2. **Eng -> {target_lang}** — translate the full meaning into the selected language.`;

/**
 * A8 — phrase & idiom expansion. Default (auto-detect) idiom instruction: asks the model to
 * notice when the selection is part of an idiom/phrasal verb and, if so, define the whole unit
 * instead of the literal word, always prefixing its answer with a machine-parseable
 * `DEFINED_AS: "<term>" | idiom|literal` line (read by domain/defined-as.ts's parseDefinedAs).
 * "No idiom-detection engine" (roadmap scope fence) — detection is entirely the model's job;
 * this is the instruction that asks for it.
 */
export const IDIOM_AUTO_INSTRUCTION = `If "{word}" is part of an idiom, fixed expression, or phrasal verb in the sentence context (e.g. "kick the bucket", "give up"), define the WHOLE idiomatic unit — not just the selected word — and begin your response with exactly this line before any other output:
DEFINED_AS: "<the full idiom or phrasal verb, exactly as it appears in the sentence>" | idiom
Otherwise, "{word}" is used with its literal, standalone meaning; begin your response with exactly this line:
DEFINED_AS: "{word}" | literal`;

/**
 * A8 — the "Show literal word" override. Selected when LookupRequest.forceLiteral is true (the
 * card's one-shot re-run button): tells the model to ignore any idiom/phrasal-verb reading and
 * define only the literal selected word.
 */
export const IDIOM_FORCE_LITERAL_INSTRUCTION = `Define ONLY the literal, standalone word "{word}" exactly as selected, even if it is part of a larger idiom or phrasal verb in the sentence context. Do not define the idiom. Begin your response with exactly this line before any other output:
DEFINED_AS: "{word}" | literal`;

/**
 * B2 — rich context capture. Asks the model to emit a machine-parseable TRANSLATION signal line
 * immediately after DEFINED_AS, decoupled from the user-customizable Card format
 * (`{output_format}`) so a saved word's translation survives no matter how the reader has
 * renamed/reordered/removed the visible "Eng -> {target_lang}" section. Read by
 * domain/translation-line.ts's parseTranslation, which strips the line before the markdown
 * reaches the card — same contract as parseDefinedAs/DEFINED_AS above.
 */
export const TRANSLATION_INSTRUCTION = `Immediately after the DEFINED_AS line, before any other output, also emit exactly this line:
TRANSLATION: "<a natural, concise {target_lang} translation of the meaning of "{word}" in this context>"`;

/**
 * A3 — follow-up chips. One instruction per fixed v1 refine kind, substituted into
 * PROMPT_ENVELOPE's {refine_instruction} slot by buildPrompt when LookupRequest.refine is set.
 * Pinned copy — see the A3 design spec §2.2. `examples`/`usage` reference "{word}"; the other two
 * do not need to.
 */
export const REFINE_INSTRUCTIONS: Record<RefineKind, string> = {
  simpler: `The reader found the previous explanation too difficult. Rewrite the "Eng -> Eng" explanation using SIMPLER, plainer everyday language — short sentences, common words, no jargon — while keeping the meaning accurate for this sentence context.`,
  examples: `The reader wants MORE EXAMPLES. In addition to the normal sections, add a new "**More examples**" section with 2-3 additional short example sentences that use "{word}" naturally in DIFFERENT contexts from the original sentence.`,
  etymology: `The reader wants this word's ETYMOLOGY. In addition to the normal sections, add a new "**Etymology**" section explaining the word's origin, root language, and how its meaning evolved to today's usage.`,
  usage: `The reader wants to know how to USE this word. In addition to the normal sections, add a new "**How to use it**" section covering common collocations, register (formal/informal), and one short natural example sentence using "{word}".`,
  related: `The reader wants this word's RELATED WORDS — synonyms, antonyms, and word-family members (words sharing the same root), disambiguated for THIS sentence context. In addition to the normal sections, add a new "**Related words**" section listing them, grouped under "Synonyms", "Antonyms", and "Family" sub-headings where each group has at least one entry (omit an empty group entirely). Immediately after the TRANSLATION line, before any other output, also emit exactly this line:
RELATED: "word1, word2, word3"
List at most 8 comma-separated words or short phrases, most relevant to "{word}" in this sentence context first, no explanations on that line.`,
};
