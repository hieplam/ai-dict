# Product

## Register

product

## Users

**Primary — readers working in a second language.** People reading English on the web who
aren't reading in their first language: ESL/L2 readers, with Vietnamese speakers as the
default audience (the shipped target language is Vietnamese and the default prompt is written
for "learners of English"). They hit an unfamiliar word or phrase mid-article and want its
meaning **in this sentence**, in their own language, without losing their place. Their context
is active reading — news, docs, blogs, study material — on desktop Chrome or iOS Safari, often
mid-sentence, wanting one fast answer so they can keep going.

**Secondary — self-provisioning power users.** People comfortable creating and pasting their own
Google Gemini API key (BYOK), who value privacy and want to tune the prompt template, target
language, cache, and history to taste. They tolerate a one-time setup in exchange for a tool that
has no account, no backend, and no tracking.

**The job to be done:** _"I'm reading something in English and I don't fully understand this word
or phrase right here — tell me what it means in this sentence, in my language, without making me
leave the page."_

## Product Purpose

AI Dictionary turns any selected word or phrase into an in-context, bilingual definition shown
right where the reader is reading, powered by the reader's own Gemini key. It exists because
looking a word up normally means leaving the page — a new tab, a dictionary site, an ad wall —
and because generic dictionaries don't disambiguate by sentence or translate into the reader's
language. Every lookup sends the word **plus its surrounding sentence** to Gemini, so the answer
fits _this_ usage, and returns IPA, part of speech, an English-to-English learner definition, a
translation into the chosen language, and one example — with no backend, no account, and no
tracking of any kind.

Success looks like: the reader keeps reading; they get the meaning in a single select-and-click;
they trust that nothing is being harvested; and they pay only for their own API calls.

## Brand Personality

Three words: **distinct, trustworthy, focused.**

AI Dictionary should carry an identity of its own — a single quiet signature color and a geometric
"defined-word" mark that make its card unmistakably _AI Dictionary's_ the moment it appears over any
website — yet it earns that distinctiveness through craft and restraint, never through noise. The
identity is **"Paperlight"**: a calm sheet of paper-light in the margin of the reader's page, tuned for
tired eyes on long reads (comfortable, not maximal, contrast; no pure white or black; one low-chroma
accent that signals rather than glares). It is deliberately _not_ seasonal or decorative — the earlier
cozy-Christmas treatment has been retired. The voice is plain, confident, and quietly reassuring: it
explains a word the way a sharp bilingual tutor would, then gets out of the way. Privacy is part of the
personality, not the fine print — the product should _feel_ local, self-owned, and honest. The emotion to
design for is the relief of understanding without friction, and the calm of a tool that respects your
eyes and your attention.

## Anti-references

- **Ad-cluttered dictionary sites.** Legacy dictionary and translation pages with pop-overs, banner
  ads, "related searches," and SEO sludge. Escaping that experience is the entire reason this exists.
- **Heavy SaaS dashboards.** Enterprise chrome — persistent sidebars, card grids everywhere, settings
  sprawl. This is a focused overlay, not an app shell.
- **Data-harvesting AI apps.** Anything that even _feels_ like it phones home, requires an account, or
  monetizes attention. No telemetry, no analytics, by design — and it should look the part.
- **Playful AI gimmicks.** Mascots, emoji-soaked copy, gradient-glow "✨AI✨" novelty, sparkles as a
  substitute for personality. Distinct, not cute.

## Design Principles

1. **The page is the canvas, not the competition.** The card overlays arbitrary, unpredictable
   websites. It must be visually self-contained — its own shadow-DOM surface, its own tokens, fully
   opaque — so it reads as _AI Dictionary's_ card on top of any page: distinct and legible, but never
   hijacking, clashing with, or fighting the host content.
2. **One selection to meaning.** Hold the shortest possible path from "I don't know this word" to
   "now I do." Every extra click, hop, or wait is a failure. The default path favors the reader;
   power controls live one layer deeper, never in the way.
3. **Distinct through craft, not volume.** Identity comes from a precise signature color, a clean
   mark, confident typography, and disciplined motion — not from loudness, decoration, or gimmicks.
   This is how "distinct" stays true to every anti-reference above.
4. **Privacy you can feel.** Make "this stays on your device, this is your key, nothing is tracked"
   legible and reassuring in the interface itself — privacy as a visible product quality, not buried
   legalese.
5. **Bilingual clarity first.** Content design serves comprehension across two languages at once: the
   English term and its translation must each be unmistakable, well-ordered, and scannable mid-read —
   never relying on color alone to tell the two languages apart.

## Accessibility & Inclusion

WCAG 2.1 AA is the committed bar (≥4.5:1 for text, ≥3:1 for UI), already encoded in the engineering
design spec — though the brand aims for _comfortable, not maximal_ contrast (body text ~8–11:1), never
the harsh 21:1 of pure black on pure white. Three themes ship and are user-selectable in Settings:
**Sepia** (default), **Dark** (warm, low-glare), and **High Contrast** (a dedicated accessibility theme
that clears AAA on body text), plus a **Match system** option. The theme is the reader's explicit choice,
persisted on-device, not silently driven by the host page. The lookup card uses semantic headings and
`aria-live="polite"` for loading→result transitions; the bottom sheet is a focus-trapped `role="dialog"`
with ESC-to-close and focus restoration; the trigger is keyboard-activatable with a visible focus ring;
the settings form uses real labels and `aria-describedby`. Motion respects `prefers-reduced-motion` (the
bottom-sheet slide degrades to no transition, and theme swaps apply instantly).

Two needs are specific to this product. First, because the UI is injected over arbitrary host pages,
contrast and legibility must hold regardless of the page behind it — the card is fully opaque and
self-contained, never leaning on the host background. Second, the primary users are reading in a
second language: keep microcopy plain, avoid idiom, and never encode meaning (especially the
distinction between the two languages in a result) in color alone.
