/**
 * The prompt is assembled from two parts (see `buildPrompt` in prompt-template.ts):
 *
 *  - PROMPT_ENVELOPE — code-owned scaffold. Holds the persona, the {word}/{context}/
 *    {title} placeholders, the safety + length constraints, and one {output_format}
 *    slot. Users cannot edit or delete any of this, so the constraints always ship
 *    (defense-in-depth for rule-sanitize-model-output).
 *  - DEFAULT_OUTPUT_FORMAT — the ONLY user-editable piece (the "Card format" field):
 *    the section layout shown in the card.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;

export const DEFAULT_OUTPUT_FORMAT = `1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).
2. **Eng -> {target_lang}** — translate the full meaning into the selected language.`;
