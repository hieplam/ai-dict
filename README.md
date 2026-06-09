<h1 align="center">AI Dictionary</h1>

<p align="center">
  <strong>Look up any word — right where you're reading.</strong><br>
  Select a word on any web page and get its meaning <em>in that sentence</em>,
  in your own language, without leaving the page.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.2.0-2f6f4e">
  <img alt="Browser" src="https://img.shields.io/badge/Chrome-MV3-2f6f4e">
  <img alt="Powered by Gemini" src="https://img.shields.io/badge/powered%20by-Google%20Gemini-2f6f4e">
  <img alt="Safari" src="https://img.shields.io/badge/Safari-not%20yet%20supported-9b9b9b">
</p>

<p align="center">
  <img src="docs/screenshots/lookup-result.png" alt="AI Dictionary showing a bilingual definition of the word serendipity over an article" width="720">
</p>

---

## What it is

You're reading an article in English and hit a word you only half-know. Normally
that means opening a new tab, finding a dictionary, dodging ads, and losing your
place. AI Dictionary removes all of that.

**Select the word, click _Define_, and the meaning appears on the page** — built
from the word _plus the sentence around it_, so the answer fits how the word is
actually used. Every result gives you:

- **IPA** pronunciation
- **Part of speech**
- **English → English** — a plain, learner-friendly explanation
- **English → your language** — a translation (Vietnamese by default)
- **An example** sentence, in both languages

It runs on **your own** [Google Gemini](https://ai.google.dev/) API key. There's
no account, no server, and no tracking — your lookups go straight from your
browser to Google and nowhere else.

---

## Browser support

| Browser                                                              | Status                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Google Chrome** (and Chromium browsers with MV3 + "Load unpacked") | ✅ Supported                                                              |
| **Safari / iOS**                                                     | 🚧 **Not yet supported** — a Safari port is planned but not available yet |

> [!NOTE]
> Today this extension works on **Chrome only**. If you're on Safari or iOS,
> there's nothing to install yet — please check back later.

---

## Install (Chrome)

Nothing is compiled from source — both options download the **same prebuilt
build** from the
[latest GitHub Release](https://github.com/hieplam/ai-dict/releases/latest).
Chrome can't auto-install extensions, so either way ends with two clicks in
`chrome://extensions`.

### 1 — Get the extension

**Option A · one command** (downloads to `~/.ai-dict/dist`; re-run any time to update):

```bash
curl -fsSL https://github.com/hieplam/ai-dict/raw/master/scripts/install-chrome.sh | bash
```

**Option B · download the build yourself:**

```bash
# with plain curl
curl -fsSL https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip -o dist-chrome.zip
unzip dist-chrome.zip -d ai-dict-dist

# …or with the GitHub CLI
gh release download --repo hieplam/ai-dict --pattern dist-chrome.zip
```

### 2 — Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the folder from step 1
   (`~/.ai-dict/dist` for the one-command install, or the unzipped folder).

### 3 — Add your Gemini API key

Open the extension's **options** page, paste your
[Gemini API key](#getting-a-gemini-api-key), and click **Save settings**.

<p align="center">
  <img src="docs/screenshots/options-api-key.png" alt="The AI Dictionary settings page with a field for the Gemini API key, target language, and prompt template" width="540">
</p>

> [!IMPORTANT]
> **Your key never leaves your browser.** There is no server and no account, so
> there is nothing to upload it to. The key is saved **only in your browser's
> local storage on this device** and is used for one thing: calling Google's
> Gemini API directly from your browser. See
> [Your API key & privacy](#your-api-key--privacy) for the full picture (and a
> way to avoid typing it into the UI at all).

That's it — you're ready to read.

---

## How to use

**1. Select a word or phrase** on any page while you read. A small **Define**
button pops up next to your selection.

<p align="center">
  <img src="docs/screenshots/select-define.png" alt="Selecting the word serendipity in an article, with a Define button appearing beside it" width="680">
</p>

**2. Click _Define_.** The definition appears right on the page — pronunciation,
part of speech, an English explanation, a translation in your language, and an
example.

<p align="center">
  <img src="docs/screenshots/lookup-result.png" alt="The definition card for serendipity, showing IPA, part of speech, English and Vietnamese meanings, and an example" width="680">
</p>

**3. Keep reading.** Press <kbd>Esc</kbd> or click away to dismiss the card.
Prefer a sidebar? Click the toolbar icon to open the **side panel**, which keeps
the current definition and your recent lookups beside the page.

You can change the **target language**, tweak the **prompt template**, and toggle
**caching** and **history** any time from the options page.

---

## Getting a Gemini API key

1. Go to **[Google AI Studio → API keys](https://aistudio.google.com/app/apikey)**.
2. Sign in with a Google account and click **Create API key**.
3. Copy the key and paste it into the extension's options page.

You only pay Google for your own usage, and Gemini has a free tier that's plenty
for everyday reading. The default model is `gemini-2.5-flash`.

---

## Your API key & privacy

Worried your key will leak? It can't go anywhere it shouldn't — the extension is
built so your key (and your reading) stay yours:

- **No server, no account.** AI Dictionary has **no backend**. There is nothing
  to sign into and nowhere to upload your key to. Every lookup goes **straight
  from your browser to Google's Gemini API** and back — it is never proxied
  through, stored by, or shared with us or anyone else.
- **Saved only in your browser.** When you paste your key into the options page,
  it's kept in your browser's local storage (`chrome.storage.local`) **on this
  device only** — never in the cloud. Remove it any time by clearing the field
  and clicking **Save settings**.
- **No tracking.** No analytics, no telemetry — nothing phones home.

**Two ways to provide the key — pick whichever you trust more:**

1. **Paste it into the options page** — _the default; works with the prebuilt
   Chrome install above._ The key lives only in this browser.
2. **Bake it into your own build with an environment variable** — _for people
   who build from source._ Set `GEMINI_API_KEY` before building and it's
   compiled into your personal build, so the options page stops asking for a key
   and you never type it into any UI. See
   [Local development](#local-development). Treat such a build as personal —
   anyone who can read its files can extract the key, so don't share it.

---

## FAQ & troubleshooting

<details>
<summary><strong>It says "Add your Gemini API key in Settings."</strong></summary>

You haven't saved a key yet, or it was rejected. Open the options page, paste
your key, and click **Save settings**. Use **Test connection** to confirm the key
works.

</details>

<details>
<summary><strong>The "Define" button doesn't appear.</strong></summary>

- Make sure you selected text on a normal web page. Browser pages like
  `chrome://…`, the New Tab page, and the Chrome Web Store are off-limits to all
  extensions.
- If you just installed or updated, **reload the tab** so the extension can run
on it.
</details>

<details>
<summary><strong>Is my reading private?</strong></summary>

Yes. There's no account and no server. Each lookup goes directly from your
browser to Google's Gemini API using your own key. The extension keeps no
analytics and phones nothing home; your key, cache, and history stay on your
device.

</details>

<details>
<summary><strong>Does it cost anything?</strong></summary>

The extension is free. You pay Google only for your own Gemini API usage, which
has a generous free tier.

</details>

<details>
<summary><strong>How do I update?</strong></summary>

Re-run the one-command installer (or download the latest `dist-chrome.zip`), then
click **Reload** on the extension's card in `chrome://extensions`.

</details>

---

## Local development

<details>
<summary>Build from source, run tests, and work on the extension.</summary>

### Prerequisites

- **[bun](https://bun.sh) `1.3.14`** — the only required toolchain (pinned in
  `.bun-version`). Install with `curl -fsSL https://bun.sh/install | bash`.
  Node.js is **not** required.
- A **Google Gemini API key** — entered in the options page at runtime, or baked
  into a personal build (see below). Not needed just to build.

### Setup

Install all workspace dependencies from the committed lockfile:

```bash
bun install
```

### Everyday commands

All commands run from the repo root.

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `bun run test`         | Run the full test suite once (vitest).                  |
| `bun run test:watch`   | Re-run tests on change (TDD loop).                      |
| `bun run typecheck`    | Type-check every package (`tsc --noEmit`).              |
| `bun run lint`         | Lint with ESLint.                                       |
| `bun run format`       | Auto-format with Prettier.                              |
| `bun run format:check` | Verify formatting (CI gate).                            |
| `bun run e2e:chrome`   | Run the Chrome extension end-to-end tests (Playwright). |
| `bun run build:chrome` | Build the Chrome extension.                             |

Run a script in a single package with `--filter`, e.g. only the app tests:

```bash
bun run --filter @ai-dict/app test
```

### Build and load the Chrome extension

```bash
bun run build:chrome
```

This bundles into `packages/extension-chrome/dist/` (service worker, content
scripts, options + side-panel pages, and the manifest). Then in Chrome:

1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `packages/extension-chrome/dist`.
3. After editing code, re-run the build and click **Reload** on the extension card.

There's no bundler watch mode — re-run the build after changing extension code,
then reload the extension.

> **Personal build with a baked-in key:** if `GEMINI_API_KEY` is set in your shell
> when you build, the key is compiled into the bundle and the options page skips
> asking for it. Treat such builds as personal/dev artifacts — anyone who can read
> the extension can extract the key — and never distribute them.

### Architecture

It's a **bun workspace monorepo** — one portable core plus a thin Chrome shell:

| Package                     | Role                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/app`              | Platform-agnostic core: domain logic, ports, wire schema, UI web components, and shared adapters. |
| `packages/extension-chrome` | The Chrome MV3 shell (service worker, content scripts, options, side panel).                      |

The architecture is documented with **C3** in `.c3/` (a queryable model) — see
[`DESIGN.md`](DESIGN.md) for the engineering design. A Safari/iOS shell is a work
in progress and is **not yet supported**.

### Known tradeoffs

- **zod ships in the browser bundle.** Message validation uses
  [`zod`](https://zod.dev) directly in the service worker and content script
  instead of a hand-written shim, in exchange for a single, un-duplicated
  validation schema. It adds ~250 kB unminified. **Revisit if** service-worker
  cold-start latency or bundle size becomes a problem.

</details>

---

## More

- Product overview: [`PRODUCT.md`](PRODUCT.md)
- Engineering design: [`DESIGN.md`](DESIGN.md)
- Release steps: [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)
