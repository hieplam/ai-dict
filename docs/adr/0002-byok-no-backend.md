# Bring Your Own Key (BYOK); no backend

The product is published to the App Store and the Chrome Web Store. Every Lookup requires an Artificial Intelligence (AI) Provider call.

**Decision:** **Bring Your Own Key (BYOK) only.** The user pastes their own Google Gemini Application Programming Interface (API) key in Settings; the extension calls Gemini directly from the browser. **No backend proxy, no accounts on our side, no billing infrastructure.**

**Why:**
1. Zero infrastructure cost, zero abuse-mitigation burden, zero billing system to build.
2. Strong privacy story: user data goes to the user's own Google account, never to us. The App Store privacy declaration becomes "we collect nothing" — no privacy policy is required.
3. Audience is deliberately narrowed to tech-literate English as a Second Language (ESL) learners (developers, students willing to follow a 60-second key-generation flow). We accept that this loses ~80% of "normie" potential users at onboarding.
4. A managed-mode subscription can be added later as a strict extension of this architecture, not a replacement. The reverse — collapsing a backend into BYOK — would be far costlier.

**Consequence:** The product cannot be used until the user obtains a Gemini key. Onboarding (ADR not written — see notes in CONTEXT.md / the onboarding flow) is the critical conversion surface.
