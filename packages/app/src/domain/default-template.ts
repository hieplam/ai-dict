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

export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

{idiom_instruction}

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
