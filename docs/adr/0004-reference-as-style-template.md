# Reference = style template, not content source

The user's initial framing — *"Cambridge as the default Reference"* — has two plausible readings: (a) the Artificial Intelligence (AI) must fetch dictionary.cambridge.org content for every Word, or (b) the AI is simply told to *write in Cambridge style*. Clarification with the user resolved this to (b).

**Decision:** A **Reference** is a **style template** (tone, structure, English as a Second Language (ESL)-friendly examples) that the AI follows when producing a Definition. The AI uses its own training-knowledge content; it does **not** fetch dictionary.cambridge.org or any other external source.

**Why:**
- **Scraping Cambridge** would mean violating their Terms of Service (ToS), depending on fragile HyperText Markup Language (HTML) class names, and risking App Store flagging.
- **Gemini Google Search grounding** adds cost, latency, and unreliable adherence — sometimes the model ignores the grounding hint and answers from memory anyway.
- For the ESL-learner use case, the AI's own knowledge produces adequate definitions; the value of a Reference is in *shape and tone*, not in citation.

**Consequence:** Definitions in v1 carry **no "See on Cambridge" citation link**. If a future version requires authoritative citation, grounding can be layered on without overturning this decision.
