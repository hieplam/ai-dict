export const DEFAULT_TEMPLATE = `You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"

Output Markdown with sections in this exact order:
1. **IPA**
2. **Part of Speech (POS)**
3. **Eng -> Eng** (learner-style definition in simple English)
4. **Eng -> {target_lang}** (translation)
5. **Example** (one short sentence in English + its {target_lang} translation)

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.`;
