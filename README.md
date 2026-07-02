<h1 align="center">AI Dictionary</h1>

<p align="center">
  <strong>Look up any word — right where you're reading.</strong><br>
  Select a word on any web page and get its meaning <em>in that sentence</em>,
  in your own language, without leaving the page.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg"><img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome%20Web%20Store-Add%20to%20Chrome-2f6f4e?logo=googlechrome&logoColor=white"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-1.7.0-2f6f4e">
  <img alt="Browser" src="https://img.shields.io/badge/Chrome-MV3-2f6f4e">
  <img alt="Powered by Gemini" src="https://img.shields.io/badge/powered%20by-Google%20Gemini-2f6f4e">
  <img alt="Safari" src="https://img.shields.io/badge/Safari-not%20yet%20supported-9b9b9b">
</p>

## Ordinary dictionaries look up the _word_. This one reads the _sentence_.

Most dictionary apps and browser extensions — including Google's — take the word
you selected, **throw away everything around it**, and hand you back a list of
_every meaning that word has ever had_. You scroll and guess which one fits. Look
up _bank_ and it comes back as a riverside **and** a money business **and** a
slope — every time, no matter what you were actually reading.

**AI Dictionary keeps the sentence.** It reads the words around your selection,
works out which sense is actually in play, and gives you **only that one** —
already explained and translated into your language:

| You're reading…                               | A word-only dictionary gives you             | AI Dictionary gives you                          |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| "I sit on the grassy **bank** of the river."  | _every_ sense: riverside · money · slope… 🤷 | 🌊 _the land along a river_ → **Bờ sông**        |
| "The next day the **bank** approved my loan." | _every_ sense: riverside · money · slope… 🤷 | 🏦 _a business that holds money_ → **Ngân hàng** |

Same word, opposite meanings — **picked from context, not guessed.** That's the
one thing a word-only dictionary can't do, and it's why AI Dictionary fits how
you actually read.

<p align="center">
  <a href="docs/media/demos/context-bank/context-bank-demo.mp4">
    <img src="docs/media/demos/context-bank/context-bank-demo.gif" alt="The same word 'bank' selected in two different sentences — 'the grassy bank of the river' returns the riverside meaning, while 'the bank approved my loan' returns the money-business meaning — each translated to Vietnamese" width="760">
  </a>
</p>

<p align="center"><em>The same word in two sentences → two correct meanings, each chosen from its context. (<a href="docs/media/demos/context-bank/context-bank-demo.mp4">watch the video</a>)</em></p>

---

## Install (Chrome)

> [!NOTE]
> AI Dictionary works on **Google Chrome** on a computer (and Chrome-like
> browsers such as Edge or Brave). **Safari and iPhone/iPad are not supported
> yet** — a Safari version is planned, so please check back later.

There are two ways to install — pick one, then
[add your free Google key](#add-your-free-google-key).

### Option A — Chrome Web Store (recommended, for everyone)

One click, **automatic updates**, and no developer mode. This is the install for
day-to-day users.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg">
    <img alt="Add to Chrome — Chrome Web Store" src="https://img.shields.io/badge/Add%20to%20Chrome-Chrome%20Web%20Store-2f6f4e?logo=googlechrome&logoColor=white&style=for-the-badge">
  </a>
</p>

Open the
**[AI Dictionary listing on the Chrome Web Store](https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg)**,
click **Add to Chrome**, then
[add your free Google key](#add-your-free-google-key). Chrome keeps it updated
for you from here on.

### Option B — Load a build yourself (developers / early access)

Most people want **Option A** above. This path is for developers and early
access: the built extension is attached to every
[GitHub Release](https://github.com/hieplam/ai-dict/releases/latest) as
**`dist-chrome.zip`**, the same build the store gets — you just sideload it
yourself, and it doesn't auto-update.

**[⬇️ Download AI Dictionary (dist-chrome.zip)](https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip)**

Then unzip the downloaded file — **double-click** it on a Mac, or
**right-click → Extract All…** on Windows. You'll get a folder with the
extension's files in it. Put that folder somewhere it can stay (for example
your Documents folder): Chrome will read the extension from there from now on,
so don't delete it later.

<details>
<summary>Comfortable with the terminal? One command does the download for you.</summary>

This downloads the same files into `~/.ai-dict/dist`; re-run it any time to
update to the newest build:

```bash
curl -fsSL https://github.com/hieplam/ai-dict/raw/master/scripts/install-chrome.sh | bash
```

</details>

Then add it to Chrome — three clicks, no tools needed:

1. In Chrome's address bar, type `chrome://extensions` and press Enter.
2. Turn on the **Developer mode** switch in the top-right corner. (That's just
   Chrome's name for "let me add extensions from my own computer" — it doesn't
   change anything else about your browser.)
3. Click **Load unpacked** and choose the folder from above — the unzipped
   folder, or `~/.ai-dict/dist` if you used the terminal command.

AI Dictionary now shows up in your list of extensions.

### Add your free Google key

Whichever way you installed, the extension needs a **Gemini API key** — a
personal code from Google that lets it ask Google's AI for definitions. It's
**free**, and getting one takes about a minute — see
[Getting a Gemini API key](#getting-a-gemini-api-key) just below.

Open the extension's **settings** page (it opens by itself the first time),
paste your key, and click **Save & activate**.

<p align="center">
  <img src="docs/media/screenshots/onboarding.png" alt="The first-run welcome screen: pick your reading language, paste your free Gemini API key (with a link to get one), and click Save &amp; activate" width="640">
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

<p align="center">
  <a href="docs/media/demos/define-flow/define-flow-demo.mp4">
    <img src="docs/media/demos/define-flow/define-flow-demo.gif" alt="Selecting the word serendipity in an article, clicking the floating Define button, and reading the definition card that appears on the page" width="760">
  </a>
</p>

<p align="center"><em>Select → Define → read, without leaving the page. (<a href="docs/media/demos/define-flow/define-flow-demo.mp4">watch the video</a>)</em></p>

**1. Select a word or phrase** on any page while you read. A small **Define**
button pops up next to your selection.

<p align="center">
  <img src="docs/media/screenshots/select-define.png" alt="Selecting the word serendipity in an article, with a Define button appearing beside it" width="680">
</p>

**2. Click _Define_.** The definition appears right on the page — pronunciation,
part of speech, an English explanation, a translation in your language, and an
example.

<p align="center">
  <img src="docs/media/screenshots/lookup-result.png" alt="The definition card for serendipity, showing IPA, part of speech, English and Vietnamese meanings, and an example" width="680">
</p>

**3. Keep reading.** Press <kbd>Esc</kbd> or click away to dismiss the card.
Prefer a sidebar? Click the **side-panel button** in the card's header (or the
toolbar icon) to move the lookup into Chrome's **side panel**, which keeps the
current definition and your recent lookups beside the page — click any entry
under **Recent** to bring it back, or delete it with its trash button.

<p align="center">
  <a href="docs/media/demos/side-panel/side-panel-demo.mp4">
    <img src="docs/media/screenshots/side-panel.png" alt="The side panel showing the focused definition of serendipity above the Recent list with earlier lookups and their delete buttons" width="380">
  </a>
</p>

<p align="center"><em>The side panel: the current lookup on top, your history below. (<a href="docs/media/demos/side-panel/side-panel-demo.mp4">watch the video</a>)</em></p>

You can change the **target language**, tweak the **Card format**, switch the
**theme**, and toggle **caching** and **history** any time from the extension's
settings page.

### Three reading themes

The whole UI — card, side panel, and settings — ships in three looks, tuned for
long reads: **Sepia** (warm paper, the default), **Dark** (low-glare night), and
**High Contrast** (maximum legibility), plus **Match system**. Change it under
**Settings → Appearance** and the page re-themes as you click
(<a href="docs/media/demos/themes/themes-demo.mp4">see it live</a>).

<p align="center">
  <img src="docs/media/screenshots/card-sepia.png" alt="The definition card in the warm Sepia theme" width="32%">
  <img src="docs/media/screenshots/card-dark.png" alt="The definition card in the low-glare Dark theme" width="32%">
  <img src="docs/media/screenshots/card-contrast.png" alt="The definition card in the High Contrast theme" width="32%">
</p>

---

## Customize the card format

Every definition is produced by sending your AI provider a short set of
instructions — _the **prompt**_. The scaffolding is fixed (your selected word,
its sentence, the page title, and the safety constraints are always sent), and
the part that decides **what the answer card contains** — the **Card format** —
is yours to rewrite: add IPA and examples, drop sections, ask for etymology,
answer in a different style, whatever suits how you read.

**Where:** open the extension's **settings** page → **Translation** section →
**Card format**. Edit the text, click **Save settings**, and your next lookup
uses it. Changed your mind? **Restore default** puts the shipped format back.

### Fill-in placeholders

Before the prompt is sent, AI Dictionary swaps each `{placeholder}` for the real
value from your current lookup. Use any of these — anything in `{curly braces}`
that isn't on this list is left untouched, so stray braces won't break anything:

| Placeholder     | Becomes…                                                    |
| --------------- | ----------------------------------------------------------- |
| `{word}`        | The word or phrase you selected.                            |
| `{context}`     | The sentence around it, so the answer fits how it's used.   |
| `{target_lang}` | Your target language (e.g. _Vietnamese_) from the dropdown. |
| `{source_lang}` | The language being defined — currently always _English_.    |
| `{url}`         | The address of the page you're reading.                     |
| `{title}`       | The title of that page.                                     |

### What actually gets sent

Your Card format slots into a fixed envelope that always carries the word, the
sentence around it, and the safety constraints — that's what makes every answer
fit _this_ sentence, no matter how you customize the card:

```text
You are a bilingual dictionary for {target_lang} learners of English.
Word/phrase: "{word}"
Sentence context: "{context}"
Page title: "{title}"

Output Markdown with these sections, in this exact order:
{output_format}

Constraints:
- Disambiguate the sense based on the sentence context.
- Do not include any HTML.
- Do not repeat the user's input verbatim more than once.
- Keep the response under 200 words.
```

The shipped default Card format (the `{output_format}` slot above) keeps the
card focused on meaning and translation:

```text
1. **Eng -> Eng** — a full, complete explanation of the meaning (do not summarize long senses).
2. **Eng -> {target_lang}** — translate the full meaning into the selected language.
```

Prefer the richer five-section card shown in the demos above? Paste this as
your Card format:

```text
1. **IPA**
2. **Part of Speech (POS)**
3. **Eng -> Eng** (learner-style definition in simple English)
4. **Eng -> {target_lang}** (translation)
5. **Example** (one short sentence in English + its {target_lang} translation)
```

> [!TIP]
> Your selected word and its sentence are always sent automatically — you don't
> need to repeat `{word}` or `{context}` inside the Card format. The result is
> shown as Markdown, so asking for **bold** section labels and short lists reads
> best on the card.

---

## Getting a Gemini API key

1. Go to **[Google AI Studio → API keys](https://aistudio.google.com/app/apikey)**.
2. Sign in with a Google account and click **Create API key**.
3. Copy the key and paste it into the extension's settings page.

You only pay Google for your own usage, and Gemini has a free tier that's plenty
for everyday reading. The default model is `gemini-2.5-flash`.

### Prefer ChatGPT?

Open the extension's settings, switch **AI provider** to **ChatGPT (OpenAI)**,
and paste an [OpenAI API key](https://platform.openai.com/api-keys). Lookups
then use OpenAI's `gpt-4o-mini` model with the same prompt template. Each
provider keeps its own key, so you can switch back and forth without re-entering
anything.

---

## Your API key & privacy

Worried your key will leak? It can't go anywhere it shouldn't — the extension is
built so your key (and your reading) stay yours:

- **No server, no account.** AI Dictionary has **no backend**. There is nothing
  to sign into and nowhere to upload your key to. Every lookup goes **straight
  from your browser to Google's Gemini API** and back — it is never proxied
  through, stored by, or shared with us or anyone else.
- **Saved only in your browser.** When you paste your key into the settings page,
  it's kept in your browser's local storage (`chrome.storage.local`) **on this
  device only** — never in the cloud. Remove it any time by clearing the field
  and clicking **Save settings**.
- **No tracking, no usage analytics.** Nothing about your browsing or lookups
  ever phones home. The _one_ exception is **opt-in, off-by-default** anonymous
  **error reports** — if you agree to a prompt (or flip the Settings toggle), the
  extension sends Google Analytics a bug signature (error type, a redacted
  message, the page's domain only, extension/browser version) to help fix
  crashes. No page content, no full URLs, no selected text, no API key — and you
  can turn it off any time. See [PRIVACY.md](PRIVACY.md).

**Two ways to provide the key — pick whichever you trust more:**

1. **Paste it into the settings page** — _the default; works with the standard
   Chrome install above._ The key lives only in this browser.
2. **Bake it into your own build with an environment variable** — _for people
   who build from source._ Set `GEMINI_API_KEY` before building and it's
   compiled into your personal build, so the key is **never typed into the UI or
   saved in browser storage at all** — it lives only in your own build, and the
   settings page stops asking for one. See [Local development](#local-development).
   Treat such a build as personal — anyone who can read its files can extract the
   key, so don't share it.

---

## FAQ & troubleshooting

<details>
<summary><strong>It says "Add your Gemini API key in Settings."</strong></summary>

You haven't saved a key yet, or it was rejected. Open the extension's settings
page, paste your key, and click **Save settings**. Use **Test connection** to
confirm the key works.

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

If you installed from the **Chrome Web Store** (Option A), you don't — Chrome
updates it automatically.

If you sideloaded a build (Option B), download the newest
[dist-chrome.zip](https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip)
and unzip it into the same folder as before (or re-run the one-command
installer), then click **Reload** on the extension's card in
`chrome://extensions`.

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
[`DESIGN.md`](design-system/DESIGN.md) for the engineering design. A Safari/iOS shell is a work
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

- Landing page: [hieplam.github.io/ai-dict](https://hieplam.github.io/ai-dict/)
- Product overview: [`PRODUCT.md`](design-system/PRODUCT.md)
- Engineering design: [`DESIGN.md`](design-system/DESIGN.md)
- Release steps: [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)
