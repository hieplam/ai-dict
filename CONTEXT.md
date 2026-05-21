# ai-dictionary

A browser-extension dictionary for English as a Second Language (ESL) readers who lose context when they leave a page to look up a word. The extension generates a definition tailored to the user's preferences, using one or more curated reference sources, without leaving the reading page.

## Language

**Word**:
A contiguous text selection (one or more words, including idioms and phrases) the reader does not fully understand and chooses to look up. Always treated as a single lookup target, even when multi-word.
_Avoid_: token, query, phrase, term

**Reading Session**:
The reader's current activity on a web page they are reading and do not want to leave.
_Avoid_: tab, page view

**Sentence Context**:
The text of the containing block element (typically `<p>` or `<li>`) from which a Word was selected, capped at 500 characters. Sent with the Word to the Provider so the AI can disambiguate the Word's meaning. **Excludes** the page Uniform Resource Locator (URL) and page title by default.
_Avoid_: snippet, excerpt, passage, surrounding text

**Lookup**:
A single act of resolving a Word into a Definition during a Reading Session.
_Avoid_: query, search, definition request

**Definition**:
The Artificial Intelligence (AI)-generated explanation of a Word, formatted according to the user's Rules and informed by the Sentence Context and one or more References.
_Avoid_: meaning, result, AI output

**Reference**:
A *style template* the AI follows when producing a Definition — the shape, tone, and structure of the explanation (e.g. Cambridge style: simple modern English, short example sentences, ESL-friendly tone). **Not a content source**; the AI's own knowledge produces the text. The product ships with a default Reference style; users may change it via Rules.
_Avoid_: source, dictionary, provider, citation, content provider

**History**:
The chronological, auto-populated log of every Lookup the user has performed on a given device. No user intent required — every Lookup is appended. Stored locally per device, never synced.
_Avoid_: log, activity, search history

**Word List**:
The curated, user-saved subset of Lookups the reader explicitly stars/saves for later study. Stored locally per device. Exportable as a Markdown file. **Never** sent to the Provider, **never** synced to the cloud.
_Avoid_: vocab, deck, favorites, saved words

**Rules**:
The user-authored file (analogous to a `CLAUDE.md`) that customises how Definitions are produced — level of detail, examples on/off, native-language hints, tone, etc. Persistent across Lookups and **synced across devices** via the user's own cloud storage.
_Avoid_: preferences, config, prompt

**Settings**:
Per-device technical configuration of the extension — the user's AI provider key, theme, hotkeys, default provider choice. Stored locally per browser, **never synced** (each device has its own key anyway).
_Avoid_: rules, options, prefs

**Provider**:
The Large Language Model (LLM) vendor whose Application Programming Interface (API) the extension calls to produce Definitions. Each user supplies their own key for one Provider in Settings (Bring Your Own Key, "BYOK").
_Avoid_: model, vendor, AI service

## Relationships

- A **Reading Session** contains many **Lookups**
- A **Lookup** has exactly one **Word** and one **Sentence Context**
- A **Lookup** produces exactly one **Definition**
- A **Definition** is shaped by the **Rules** and follows exactly one **Reference** style
- A **Definition** is produced by exactly one **Provider** per Lookup
- Every **Lookup** is appended to **History** (auto)
- A **Lookup** *may* be promoted into the **Word List** (manual save)
- The **Rules** are global to the user (synced across devices), not per **Lookup**
- **Settings**, **History**, **Word List** are per-device and never synced

## Example dialogue

> **Dev:** "When the reader triggers a Lookup, do we send the whole page to the AI?"
> **Domain expert:** "No — just the Word and its Sentence Context. The Rules say how the Definition should read; the Reference is the style template (e.g. Cambridge-style)."
> **Dev:** "So we don't actually fetch Cambridge content?"
> **Domain expert:** "Correct — the AI is the source of the text. Cambridge just describes *how* the text should look and feel."

## Flagged ambiguities

- "rules" vs "settings" — resolved: **Rules** is the user-editable, synced file that shapes Definitions (mirrors the `CLAUDE.md` pattern the user already knows). **Settings** is per-device technical config (API key, theme, hotkeys). Two distinct concepts; do not conflate.
