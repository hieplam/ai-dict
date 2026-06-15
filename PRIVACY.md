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

## Error reporting (opt-in, off by default)

To find and fix bugs after release, the extension can send **anonymous error reports**. This
is **off by default** and **nothing is sent unless you agree**:

- Errors are first kept **only on your device**. After a few have accumulated, the extension
  asks once, in the page, whether you want to help by sending them. You can also turn reporting
  on or off any time from the **Settings** page ("Send anonymous error reports").
- If — and only if — you agree, reports are sent to **Google Analytics** (Measurement Protocol).
  Each report is a **signature**, not your activity: the error type, a **redacted** error message
  (API keys, emails, phone numbers and similar are masked), the page's **domain only**
  (e.g. `example.com` — never the full URL or path), which provider you use, and the extension
  and browser versions. A random, anonymous id — generated once per installation and stored
  locally — lets reports from the same install be correlated; it is **not** linked to your
  identity or any account, and clearing the extension's storage resets it.
- We **never** send the page's content, the full URL, the text you selected, the definitions you
  receive, or your API key.

## What we do NOT do

- We operate **no server** and **no backend** of our own. Your lookups never reach us.
- We do **not** track your browsing, run **no ads**, and collect **no usage analytics** — the
  only thing ever sent (and only after you consent) is the anonymous error reports described
  above.
- We do **not sell or share** your data with anyone.

## Third parties

Definitions are produced by the provider you select. Your selected text and context are subject
to that provider's privacy policy:

- Google Gemini API: https://ai.google.dev/gemini-api/terms
- OpenAI API: https://openai.com/policies/privacy-policy
- Anonymous error reports (only if you opt in) go to Google Analytics: https://policies.google.com/privacy

## Contact

Questions: open an issue at https://github.com/hieplam/ai-dict/issues
