# Chrome Web Store listing — AI Dictionary

**Name:** AI Dictionary

**Category:** Productivity
**Language:** English

**Summary (≤132 chars):**
Select any word and get its meaning — in context, on the page — using your own Gemini or OpenAI key. No account, no tracking.

**Privacy policy URL:** https://github.com/hieplam/ai-dict/blob/master/PRIVACY.md

## Detailed description

You're reading an article and hit a word you only half-know. AI Dictionary lets you select it
and get the meaning **right on the page** — built from the word **plus the sentence around it**,
so the answer fits how the word is actually used.

Every result gives you:

- IPA pronunciation
- Part of speech
- A plain, learner-friendly English explanation
- A translation into your language (Vietnamese by default; configurable)
- An example sentence, in both languages

It runs on **your own** Google Gemini API key — or an OpenAI (ChatGPT) key; pick the provider in
Settings. There's no account, no server, and no tracking: your lookups go straight from your
browser to the provider you chose and nowhere else.

## Single purpose

Look up the meaning of a word or phrase you select on a web page, in context, using your own AI
provider API key.

## Permission justifications

- **Host access to all sites (`<all_urls>`) + content scripts:** a dictionary must read the word
  you select — and a little surrounding context — on whatever page you're reading. No remote
  code is loaded; the extension's network access is restricted by its Content Security Policy to
  the provider you chose (`generativelanguage.googleapis.com`, `api.openai.com`).
- **`storage`:** stores your API key, settings, and local lookup history/cache on your device.
- **`sidePanel`:** shows the lookup result and history in Chrome's side panel.

## Data use disclosures (Chrome Web Store form)

- **Personally identifiable information:** No.
- **Authentication information:** Yes — the user's own API key, stored locally and sent only to
  the chosen provider as a bearer credential. Not collected by the developer.
- **Website content:** Yes — the selected text + short surrounding context, sent to the chosen
  provider to generate a definition. Not stored by the developer (no server).
- Certify: data is **not** sold/transferred to third parties beyond the user-chosen provider;
  **not** used for purposes unrelated to the single purpose; **not** used for creditworthiness.

## Assets

- Store icon (128×128): `packages/extension-chrome/src/icons/icon-128.png`
- Screenshots (1280×800): `docs/store/chrome/screenshots/*.png`
- Small promo tile (440×280): `docs/store/chrome/promo-440x280.png`
