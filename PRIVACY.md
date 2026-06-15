# AI Dictionary — Privacy Policy

_Last updated: 2026-06-15_

AI Dictionary is a browser extension that looks up the meaning of a word or phrase you
select on a web page. It is designed to collect as little as possible.

## What the extension does with your data

- **Selected text + nearby context.** When you ask for a definition, the word or phrase you
  selected and a short snippet of the surrounding sentence are sent **directly from your
  browser** to the AI provider **you choose** (Google Gemini or OpenAI), authenticated with
  **your own** API key, to generate the definition. Nothing else on the page is sent.
- **Your API key and settings.** Your API key, target language, prompt template, and
  preferences are stored **locally** in your browser (`chrome.storage.local`). The key stays on
  your device and is used only by the extension's background service worker to call the
  provider. It is never sent anywhere except, as a bearer credential, to the provider you chose.
- **Lookup history and cache.** Recent lookups are stored **locally** so you can see history and
  avoid repeat calls. You can delete individual entries or clear them from the extension.

## What we do NOT do

- We operate **no server** and **no backend**. Your data never reaches us.
- We do **no analytics**, **no tracking**, and run **no ads**.
- We do **not sell or share** your data with anyone.

## Third parties

Definitions are produced by the provider you select. Your selected text and context are subject
to that provider's privacy policy:

- Google Gemini API: https://ai.google.dev/gemini-api/terms
- OpenAI API: https://openai.com/policies/privacy-policy

## Contact

Questions: open an issue at https://github.com/hieplam/ai-dict/issues
