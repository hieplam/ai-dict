# AI Dictionary — Product Roadmap

> **What this is.** A ranked backlog of user-facing improvements, each written with
> enough context that a lead model can direct implementation and a smaller model can
> pick up any single idea without guessing. This document answers **What** and **Why**.
> It deliberately does **not** answer **How** — implementation design is the next phase.
>
> **Two themes:** (A) seamless reading UX that preserves the reader's context, and
> (B) structuring the words a reader learns. Target user is **70% reader / 30% learner**.

---

## 1. How to use this roadmap (decision authority)

This roadmap is built to be run by a **lead model acting as tribe leader**: it should
guide smaller implementer models and make most calls autonomously, escalating to the
human owner **only** for decisions that are hard to reverse or that change the product's
promise. Three roles:

| Role            | Who           | Responsibility                                                                    |
| --------------- | ------------- | --------------------------------------------------------------------------------- |
| **Owner**       | Human         | Sets direction; decides the escalations in §6.                                    |
| **Lead**        | Large model   | Sequences work, briefs implementers, reviews output, resolves ordinary ambiguity. |
| **Implementer** | Smaller model | Executes one idea at a time from its card + the standing constraints.             |

### What the lead decides autonomously

- Ordering within a category, and which idea to pick next (subject to the dependency map, §5).
- Any choice already pinned by an idea's **Scope fence** — those are settled; do not reopen.
- Implementation-shaped choices (component layout, token usage, test strategy) — these are
  the _How_ phase and belong to the implementer, reviewed by the lead.
- Enforcing the **Standing constraints** (§3). These are non-negotiable rules, not choices:
  a proposal that violates one is simply wrong and the lead rejects it without asking.

### What the lead MUST escalate to the owner (see the register in §6)

- **Irreversible data shapes** — the saved-word entry schema (B1/B2) and the backup file
  envelope (B9). Once real user data exists in a format, changing it needs a migration.
- **Product-promise changes** — anything that widens what the extension claims to do or
  changes its marketing story (A12 multi-language source; a real PDF commitment after A11).
- **New browser permissions** — any manifest permission beyond today's set (e.g. `file://`
  access for PDFs). Permissions affect the store listing and user trust.
- **Privacy-surface changes** — any feature that would read or store more of what the user
  reads than a lookup already does. Default answer is no; bring exceptions to the owner.
- **Cutting a scope fence** — if an idea can't meet its stated goal without breaking a fence,
  stop and escalate rather than quietly redefining the idea.

### Definition of done (per repo convention)

An idea is **done** only when its work is **PR merged into master via a regular merge commit
(squash-merge is prohibited — owner ruling 2026-07-16, §8)** with before/after evidence
attached, lint + format + tests green, and the C3 model updated if architecture changed.
"Code written" is not done.

### Scoring

**Impact** 1–5 (user value). **Effort** S/M/L. **Score = Impact ÷ Effort weight**
(S = 1, M = 2, L = 3). Score ranks _bang-for-buck_, not importance — a foundational
low-score idea can still be sequenced first because others depend on it.

---

## 2. Product context (read before any idea)

Today the flow is: select a word on a page → a small **Define** button pops up → click it →
the extension sends the word **plus its sentence** to the user's own AI key
(Gemini / OpenAI / Claude) → a card renders on the page with the single meaning that fits
that sentence, translated to the user's language. A **side panel** keeps the current lookup
plus a **Recent** history list. **Settings** control target language, the card's prompt
(**Card format**), theme, and cache/history toggles. Everything is **local**: no server, no
account, key stored only in the browser.

The product's one differentiator: it keeps the **sentence** and returns the **one sense in
play**, where ordinary dictionaries throw the sentence away and dump every meaning.

---

## 3. Standing constraints (every idea inherits these)

1. **100% local.** No backend, no accounts. File export/import allowed; nothing else leaves
   the browser except the AI API call itself.
2. **API-key isolation** (`rule-api-key-isolation`, S1). The key never appears in exports,
   logs, history, or any UI beyond the settings key field.
3. **Sanitize model output** (`rule-sanitize-model-output`, S4). Everything the LLM returns is
   sanitized before rendering — **including partial/streamed** output.
4. **No background LLM calls.** Tokens cost the user money; every model call is triggered by an
   explicit user action, and features that spend tokens say so first.
5. **Design tokens only.** UI reads `--ad-*` / `--adp-*` tokens; no hard-coded colors, no
   per-component `prefers-color-scheme` (theme is centralized via `data-ad-theme`).
6. **Ports architecture.** Core changes flow through `packages/app/src/ports.ts`
   (`ref-core-dependency-rule`); the domain stays dependency-free.

---

## 4. The ideas

Each card: **Today** (current behavior) → **Missing** (the gap) → **Why** (why it hurts) →
**Payoff** (what the user gets) → scope fence, dependencies, and decision authority.

### Category A — Seamless reading UX

_The user is reading. Every second, glance, and mouse trip a lookup costs is a tax on flow.
These ideas shrink the tax._

---

#### A4 — Keyboard-only flow `Impact 4 · Effort S · Score 4.0`

> **Status: ✅ Implemented (2026-07-10) — landed via squash-merge PR [#97](https://github.com/hieplam/ai-dict/pull/97) with before/after evidence (video).**
> Ships exactly 3 `chrome.commands` (`define-selection` / `dismiss-lookup` / `send-to-panel`),
> with no default keybindings — users assign keys themselves in
> `chrome://extensions/shortcuts`. No manifest permission change. Design/plan under
> `docs/superpowers/`.

- **Today:** After selecting a word you must move the mouse to the ~20px Define button and
  click it. Esc dismisses the card, but there is no keyboard way to _start_ a lookup.
- **Missing:** A shortcut meaning "define what I just selected."
- **Why:** Readers who select by double-click or keyboard lose their place hunting the button;
  each lookup becomes an aim-and-click chore.
- **Payoff:** Select → one key → read → Esc → keep reading. Hands stay on the keyboard.
- **Scope fence:** 3 commands only (define selection / dismiss / send to panel). No default
  binding — users assign keys in `chrome://extensions/shortcuts` to avoid site collisions.
- **Depends on:** — · **Lead decides:** command names, panel behavior. **Escalate:** none.

#### A8 — Phrase & idiom expansion `Impact 4 · Effort S · Score 4.0`

> **Status: ✅ Implemented (2026-07-10) — landed via squash-merge PR [#98](https://github.com/hieplam/ai-dict/pull/98) with before/after evidence (video).**
> A code-owned prompt instruction plus a machine-parseable `DEFINED_AS: "<term>" |
idiom|literal` signal line (stripped by `domain/defined-as.ts`) drives the card's idiom
> label and a "Show literal word" button that re-runs the lookup forcing the literal
> reading. No idiom-detection engine, no new manifest permission. Design/plan under
> `docs/superpowers/`.

- **Today:** Select just "bucket" in "kick the bucket" and the model _may_ mention the idiom or
  _may_ define the literal pail — it's luck, and nothing on the card says which happened.
- **Missing:** A guarantee: when the selection is part of an idiom/phrasal verb, define the
  whole unit — and label it.
- **Why:** Idioms are exactly where learners get lost; defining "up" for "give up" is a wrong
  answer wearing a right answer's face.
- **Payoff:** Card shows **defined as "kick the bucket" (idiom): to die**, with one tap to
  force the literal single word.
- **Scope fence:** Prompt instruction + card label + one button. **No idiom-detection engine** —
  the LLM already holds the sentence.
- **Depends on:** — · **Lead decides:** wording of the prompt instruction, label copy.
  **Escalate:** none.

#### A6 — Smart card placement `Impact 3 · Effort S · Score 3.0`

- **Today:** The card opens near the selection and can land **on top of the sentence** being read.
- **Missing:** A placement rule that treats the selected sentence as sacred ground.
- **Why:** The product's promise is "meaning _in this sentence_" — then the UI hides the sentence.
- **Payoff:** Definition and its sentence are always visible together. No re-finding your place.
- **Scope fence:** Positioning only; card stays an overlay and must never shift page layout.
- **Depends on:** — · **Lead decides:** placement heuristic. **Escalate:** none.

#### A16 — Sticky save bar on Settings `Impact 3 · Effort S · Score 3.0`

> **Status: ✅ Implemented (2026-07-05) — landing via squash-merge PR with before/after evidence.**
> The `.savebar` is now `position: sticky; bottom: 0` with a token surface + top border, and a
> dirty-state "Unsaved changes" cue that clears on save/hydration — in
> `packages/app/src/ui/settings-form.ts` (positioning + dirty-state only; Save's behavior and the
> field set are unchanged). Design/plan under `docs/superpowers/`.

- **Today:** The **Save settings** button sits in a normal `.savebar` div at the very bottom of
  a long settings form (provider, key, language, the Card-format textarea, appearance, history)
  — see `settings-form.ts:156`. It is not sticky.
- **Missing:** The primary action should stay reachable, and the form should signal that it has
  unsaved changes.
- **Why:** On the narrow side-panel/popup width (short, ~360px), changing a field near the top
  forces a scroll to the bottom to save. Two failure modes result: (1) friction on every change,
  and (2) **silent data loss** — the user edits a field, navigates away, and never realizes it
  was never saved.
- **Payoff:** Change anything and save it from where you are — no scroll hunt — with a clear
  "unsaved changes" cue so nothing is silently lost.
- **Proposed solution** (requested): pin the existing `.savebar` to the bottom of the settings
  viewport (`position: sticky; bottom: 0`) so Save + status stay visible while scrolling; give it
  a token-based surface + top border to separate it from content, and surface a dirty-state
  "Unsaved changes" cue that clears on save. Reuses today's markup — positioning + a dirty flag,
  no change to what Save does. _Alternative considered:_ a floating action button — rejected as
  less discoverable and it overlaps content; a sticky bar matches the existing footer pattern.
- **Scope fence:** Positioning + dirty-state only. No change to Save's behavior or the fields.
  Must use `--ad-*` tokens and honor reduced-motion.
- **Depends on:** — · **Lead decides:** sticky-bar over FAB (standard pattern), dirty-cue style.
  **Escalate:** only if the sticky bar visually conflicts with the shield footer
  (`settings-form.ts:163`) in a way that needs a broader settings redesign.

#### A9 — Instant cache hits `Impact 3 · Effort S · Score 3.0`

- **Today:** A cache toggle exists, but a repeat lookup still feels fresh — same wait pattern,
  and nothing tells you the answer came from cache.
- **Missing:** A hard repeat-speed guarantee (< 100 ms) + a visible "cached" badge; the cache key
  must include the **sense/context**, not just the word (so "bank" river vs. money don't collide).
- **Why:** Re-looking-up a word you met yesterday is the most common lookup there is; it should
  feel like memory, not a network call.
- **Payoff:** Second encounter = instant, zero tokens, and you can _see_ it was free.
- **Scope fence:** Delta on the existing cache — read `c3-112 persistence-policies` first; don't
  rebuild it.
- **Depends on:** — · **Lead decides:** badge copy, key composition. **Escalate:** none.

#### A10 — TTS pronunciation `Impact 3 · Effort S · Score 3.0`

- **Today:** The card shows IPA (e.g. /ˌsɛrənˈdɪpɪti/). Most readers can't read IPA, so they
  never learn how the word sounds.
- **Missing:** A speaker button that says the word aloud.
- **Why:** A word you can't pronounce is a word you won't use; IPA-only serves linguists, not readers.
- **Payoff:** One tap → hear the word. Free, instant, offline.
- **Scope fence:** Browser `speechSynthesis` only (0 API calls). Speaks the **word only** — never
  the whole definition. No cloud TTS.
- **Depends on:** — · **Lead decides:** voice/lang selection heuristic. **Escalate:** none.

#### A15 — Trigger latency budget `Impact 3 · Effort S · Score 3.0`

- **Today:** The Define button appears after selection, but there's no speed target and no test
  guarding it; on heavy pages it can lag behind the selection.
- **Missing:** A written budget (button visible < 50 ms after selection ends, zero forced reflow
  of the host page) plus an e2e assertion that fails CI on regression.
- **Why:** The trigger button is the product's front door; if it stutters, the whole extension
  feels broken before any AI is involved.
- **Payoff:** Selection → button feels native-instant on every page, permanently (the test locks it).
- **Scope fence:** Budget + test on the existing trigger; no behavior change.
- **Depends on:** — · **Lead decides:** exact budget numbers, test placement. **Escalate:** none.

#### A1 — Streamed answers `Impact 5 · Effort M · Score 2.5`

- **Today:** Click Define → the card waits until the **entire** answer is generated, then shows it
  all at once. On a slow model that's a multi-second blank stare.
- **Missing:** Progressive rendering — words appear as the model produces them.
- **Why:** Perceived speed is the biggest UX lever we have; today the reader's eyes are parked on a
  spinner during the exact moment they were mid-sentence.
- **Payoff:** First words visible in under 1 second; you read the meaning while the rest arrives —
  the wait effectively disappears.
- **Scope fence:** Every repaint of partial markdown must pass sanitization (S4, mandatory).
  Providers that can't stream fall back silently to today's behavior.
- **Depends on:** — · **Lead decides:** per-provider streaming vs. fallback. **Escalate:** none
  (S4 is a rule, not a choice).

#### A2 — Recursive lookup `Impact 4 · Effort M · Score 2.0`

- **Today:** The card is a dead end: if the _definition itself_ contains a word you don't know, you
  must close the card, and you can't select text inside it.
- **Missing:** Select any word inside the card/panel → define it, with Back navigation.
- **Why:** Definitions written for learners still contain hard words; "go find it elsewhere" is the
  exact problem this product exists to kill.
- **Payoff:** No dead ends — any unknown word, even inside an answer, is one selection away; Back
  walks up the chain.
- **Scope fence:** The sentence inside the definition is the inner lookup's context. Depth capped
  at 3.
- **Depends on:** — · **Lead decides:** stack UI, depth-cap UX. **Escalate:** none.

#### A3 — Follow-up chips `Impact 4 · Effort M · Score 2.0`

- **Today:** If an answer is too academic or you want an example, your only options are re-select
  and hope, or permanently rewrite the Card-format prompt in settings.
- **Missing:** One-tap refinements on the card: **Simpler · More examples · Etymology · Use it**.
- **Why:** The right depth differs per word, per person, per moment; a global prompt can't know that
  "epistemology" needs the simple version but "cat" doesn't.
- **Payoff:** Wrong answer? One tap fixes it — no typing, no settings, no re-selecting. Original
  word + sentence re-sent automatically.
- **Scope fence:** Fixed 4 chips in v1 (not configurable). Refined answer replaces the body; Back
  restores the original.
- **Depends on:** — · **Lead decides:** chip copy, result transition. **Escalate:** none.

#### A5 — Gloss mode `Impact 4 · Effort M · Score 2.0`

- **Today:** Every lookup opens the full card (pronunciation, POS, explanation, translation,
  example). For a quick "what's this word again?" that's a paragraph-sized interruption.
- **Missing:** An opt-in "Compact gloss" setting: Define shows a **one-line translation floating at
  the word**; click to expand into the full card.
- **Why:** A reader often needs 2 seconds of help, not 20; forcing the full card makes cheap
  questions expensive, so people stop asking them.
- **Payoff:** Skimming stays skimming — glance at the one-liner, keep moving; full card is one click away.
- **Scope fence:** A user setting for the render mode. **No auto-detection of "simple words"** — no
  difficulty classifier.
- **Depends on:** — · **Lead decides:** gloss anchor/positioning, setting copy. **Escalate:** none.

#### A13 — Per-site quiet mode `Impact 2 · Effort S · Score 2.0`

- **Today:** The Define button pops up on **every** text selection on **every** site — including
  code editors, Gmail, and dashboards where you select constantly and never want definitions.
- **Missing:** A per-site "don't show the button here" list.
- **Why:** Every unwanted popup teaches the user to resent the extension; the common fix is uninstalling.
- **Payoff:** Chosen sites go visually silent; the A4 shortcut still works there, so lookup stays
  possible — just never uninvited.
- **Scope fence:** Site list + toggle. **Depends on:** A4 (nice-to-have, for the still-works path).
  **Lead decides:** match granularity (domain vs. path). **Escalate:** none.

#### A14 — Double-click trigger `Impact 2 · Effort S · Score 2.0`

- **Today:** Lookup is always two gestures: select, then click the button.
- **Missing:** An opt-in mode where double-clicking a word defines it immediately.
- **Why:** For heavy users the button click is pure overhead; dictionary power-users expect
  double-click from tools like Eudic/GoldenDict.
- **Payoff:** One gesture per lookup.
- **Scope fence:** Off by default (many pages use double-click natively). Never fires in text
  fields or interactive elements. **Depends on:** — · **Lead decides:** guard list. **Escalate:** none.

#### A7 — Pin cards `Impact 3 · Effort M · Score 1.5`

- **Today:** One card at a time; it dies on click-away or scroll. Comparing a definition against a
  paragraph further down loses the definition.
- **Missing:** A pin button — the card detaches, floats, survives scrolling, can be dragged.
- **Why:** Real reading is non-linear; a term on page 1 pays off on page 3, but the extension's
  memory is shorter than the reader's.
- **Payoff:** Keep up to 3 definitions floating beside the text while you read on; Esc closes only
  the top one.
- **Scope fence:** Max 3 pinned; floating/draggable. **Depends on:** — · **Lead decides:** drag UX.
  **Escalate:** none.

#### A12 — Non-English source pages `Impact 3 · Effort M · Score 1.5`

- **Today:** The prompt's `{source_lang}` placeholder is **hard-coded to "English"**. Select a
  French or Japanese word and the model is told it's English — results are luck.
- **Missing:** Detect the selection/page language, fill `{source_lang}` truthfully, show the
  detected language on the card with a manual override.
- **Why:** People read in more than one foreign language; today the extension gives wrong-premise
  answers everywhere but English pages.
- **Payoff:** Works on any-language page — reading Le Monde, select a word, get its meaning in your
  language, same flow.
- **Scope fence:** Target-language logic unchanged; this fixes only the _source_ side.
- **Depends on:** — · **Escalate to owner:** this widens the product's promise from "English
  dictionary" to "any-language" — a marketing/positioning call, and it may affect the store listing.
  Lead prepares the option; owner decides whether to ship/advertise it.

#### A11 — PDF support (discovery spike first) `Impact 4 · Effort L · Score 1.3`

- **Today:** The extension does nothing inside Chrome's built-in PDF viewer — the #2 reading
  surface (papers, ebooks, reports).
- **Missing:** The same select→define flow in PDFs. **But** Chrome's PDF viewer does not run
  content scripts on PDF content, so the standard approach is a dead end.
- **Why (spike, not feature):** Committing to "PDF support" blind risks weeks of wasted work; the
  honest first step is a time-boxed feasibility study.
- **Payoff (of the spike):** A written go/no-go — which approach works (custom viewer? alternative
  selection APIs? "not worth it"), its cost, and any new permission it would need.
- **Scope fence:** Deliverable is a feasibility report, **not** a feature. **Depends on:** — ·
  **Escalate to owner:** the go/no-go after the spike, and any `file://`/host-permission the chosen
  path requires.

---

### Category B — Structuring learned words

_Today the extension has a goldfish memory — a flat Recent list. These ideas turn lookups into a
personal vocabulary, without turning reading into homework. Local-only throughout._

---

#### B1 — Save word (star) `Impact 5 · Effort S · Score 5.0` · **foundation**

> **Status: ✅ Implemented (2026-07-10) — landed via squash-merge PR [#99](https://github.com/hieplam/ai-dict/pull/99) with before/after evidence (video).**
> Ships the owner-ratified entry shape verbatim (see §8 Decision Log, E1) in an independent
> `saved:*` keyspace (`domain/saved-words-policy.ts`), fully isolated from `history:*`/
> `cache:*` — clearing history never touches saved words. `translation` ships as `''` for
> every B1-era save; B2 fills it in without touching the schema. Design/plan under
> `docs/superpowers/`.

- **Today:** Every lookup lands in one flat auto-history ("Recent") — the word you'll want forever
  sits next to 40 words you clicked once by accident. History can also be toggled off or purged,
  taking everything with it.
- **Missing:** A star on the card/panel — "this one matters to me" → saved to a **separate,
  permanent word list**.
- **Why:** History is what happened; a vocabulary is what you _chose_. Every learning feature below
  needs to know which words you care about, and auto-history can't tell it.
- **Payoff:** One tap while reading = word banked. No form, no folder choice, no interruption.
- **Scope fence:** New storage keyspace (`ref-kv-storage-prefixes`), independent of history —
  clearing history never touches saved words.
- **Depends on:** — · **Escalate to owner:** the **entry schema is defined in B2 and must be locked
  before B1 ships** (see B2 + §6) — it's the hardest thing to change later. This is the single most
  important escalation in the roadmap.

#### B2 — Rich context capture `Impact 4 · Effort S · Score 4.0`

> **Status: ✅ Implemented (2026-07-10) — landed via squash-merge PR [#100](https://github.com/hieplam/ai-dict/pull/100) with before/after evidence (screenshots).**
> Populates the `translation` field B1 left empty, via the same signal-line pattern A8
> established: a `{translation_instruction}` prompt slot asks the model for a
> `TRANSLATION: "..."` line, parsed by the new `domain/translation-line.ts`. The ratified
> entry schema (`SavedWordEntry`/`SavedWordSense`/`SavedWordStatus`) is untouched — verified
> field-for-field at every checkpoint audit and by the Shaman independently at ship time.
> Design/plan under `docs/superpowers/`.

- **Today:** A history entry is essentially the word and its definition; where you met it — the
  sentence, the page — is gone.
- **Missing:** Saving a word (B1) auto-stores: the word, the definition _as shown_, translation,
  **the original sentence, page URL, page title**, date, and status.
- **Why:** You remember "_serendipity_ from that essay about penicillin," not "serendipity, noun."
  The context IS the memory hook — and the extension already holds all of it at save time.
- **Payoff:** Every saved word answers "where did I meet you?" with a link back to the exact page —
  zero typing.
- **Scope fence:** Proposed v1 entry shape: `{ word, definition, translation, sentence, url, title,
savedAt, status, senses[] }`. **Depends on:** B1.
- **Escalate to owner:** **lock this schema before B1/B2 ship.** It is the contract every later
  idea (B3–B14, backup, export) reads and writes; changing it after users have data means a
  migration. Lead proposes the shape; owner ratifies.

#### B4 — Hover-recall `Impact 4 · Effort S · Score 4.0` · _needs B3_

- **Today:** Meeting a word you looked up last week means looking it up again — new API call, new
  wait, new tokens.
- **Missing:** When a saved word is highlighted (B3), hovering shows **your own saved meaning**
  instantly from local storage.
- **Why:** Asking the AI about a word you already own is paying twice; your saved entry is the
  better answer anyway.
- **Payoff:** Hover → your meaning in ~0 ms, 0 tokens, 0 network. Saved words start paying rent.
- **Scope fence:** Local-only popup; links to the full entry. **Depends on:** B3 (→ B1, B5).
  **Lead decides:** popup layout. **Escalate:** none.

#### B7 — Repeat-offender nudge `Impact 4 · Effort S · Score 4.0`

> **Status: ✅ Implemented (2026-07-10) — landed via squash-merge PR [#101](https://github.com/hieplam/ai-dict/pull/101) with before/after evidence (video).**
> On the 3rd lookup of a headword within 30 days, the card nudges "3rd time meeting this
> word — save it?" and reuses B1's exact save path (the identical `toggle-save` event the
> star button dispatches — no parallel save mechanism). A permanent `nudge:<word>` marker
> (`domain/nudge-policy.ts`, an independent keyspace from `saved:*`/`history:*`/`cache:*`)
> is set the instant the threshold first crosses, enforcing one nudge per word, ever, even
> with zero user interaction. Design/plan under `docs/superpowers/`.

- **Today:** You can look up "ubiquitous" five times in a month and the extension never notices —
  each lookup is a stranger.
- **Missing:** On the 3rd lookup of the same headword within 30 days, the card shows a one-line
  nudge: **"3rd time meeting this word — save it?"**
- **Why:** Repeat lookups are the most honest signal of "I keep failing to retain this"; the user
  shouldn't have to notice their own pattern.
- **Payoff:** Your leakiest words get captured with one tap, exactly when the leak is proven;
  dismiss = never nag for that word again.
- **Scope fence:** Uses existing history counts; one nudge per word, ever. **Depends on:** B1.
  **Lead decides:** threshold copy (3×/30d is the proposed default). **Escalate:** none.

#### B8 — Anki / CSV export `Impact 4 · Effort S · Score 4.0`

- **Today:** Words are locked inside the extension; an Anki user re-types cards by hand.
- **Missing:** Export saved words — with sentences and translations — as Anki-importable TSV, plus
  CSV and Markdown.
- **Why:** Serious spaced repetition is solved; Anki solved it. Feed that ecosystem, don't rebuild
  a worse one inside a dictionary.
- **Payoff:** Weeks of reading → a ready-made Anki deck in two clicks, each card carrying its real
  sentence.
- **Scope fence:** **No `.apkg`** (Anki imports TSV natively); column order documented; no scheduling
  engine, ever. **Depends on:** B1, B2. **Lead decides:** column order/format. **Escalate:** none.

#### B5 — Status lifecycle `Impact 3 · Effort S · Score 3.0`

- **Today:** (With B1) a saved list only grows; mastered words sit forever beside ones you struggle
  with, and the list becomes noise.
- **Missing:** Two statuses — **learning** (default on save) → **known** (manual, from the hover
  popup or words page). Known words stop being highlighted (B3).
- **Why:** A vocabulary that can't retire words punishes progress: the better you get, the noisier
  it gets.
- **Payoff:** The list self-prunes; highlighting stays meaningful because it only marks words still
  in play.
- **Scope fence:** Exactly 2 states, manual only. **No auto-promotion in v1.** **Depends on:** B1.
  **Lead decides:** where the toggle lives. **Escalate:** none.

#### B9 — Backup & restore `Impact 3 · Effort S · Score 3.0`

- **Today:** All data lives in one browser's local storage; a new laptop, a Chrome reinstall, or a
  profile wipe erases the entire vocabulary. (100%-local is the promise — this is its price.)
- **Missing:** Export everything (saved words, history, settings) as one versioned JSON file;
  import on another machine (merge or replace — user picks).
- **Why:** We chose no-backend for privacy; backup files are how users get durability without
  breaking that promise.
- **Payoff:** Your vocabulary survives any machine; move devices in under a minute.
- **Scope fence:** Export **MUST NOT** contain the API key (S1). **Depends on:** B1.
- **Escalate to owner:** the **backup file envelope + version field** is a public, forward-compatible
  format — lock it before shipping (see §6), same reasoning as the entry schema.

#### B3 — Re-encounter highlighting `Impact 5 · Effort M · Score 2.5` · _needs B1, B5_

- **Today:** You save a word and the extension never mentions it again; when it reappears in
  tomorrow's article, nothing happens — the single most valuable learning moment passes unmarked.
- **Missing:** A subtle underline wherever one of your **learning**-status words appears on any page.
- **Why:** This is **spaced repetition disguised as reading** — the only review a reader will
  actually do, because the reading _is_ the review. "I know this word!" in the wild is the reward
  loop that makes saving worth it.
- **Payoff:** Saved words wink at you from real pages; recognition compounds passively, article
  after article.
- **Scope fence:** Hard perf budget — no measurable page-load impact (lazy scan). Matching = exact
  word-boundary + naive plural/-ed/-ing only, **no lemmatizer in v1**. Respects quiet-mode sites
  (A13); off switch in settings. **Depends on:** B1, B5.
- **Lead decides:** the v1 naive-matching rules and perf approach. **Escalate to owner:** any move
  _beyond_ naive matching (a lemmatizer/fuzzy match) — it raises false-positive highlights, a
  product-feel call.

#### B6 — Words page `Impact 4 · Effort M · Score 2.0` · _needs B1, B2_

- **Today:** The side panel shows a linear Recent list — fine for 10 entries, useless for 300. No
  search, no filters.
- **Missing:** A collection view **inside the side panel**: search, filter by status/site, sort by
  date or lookup-count, edit status, delete.
- **Why:** Once saving works, the collection is an asset — and an asset you can't search is a junk drawer.
- **Payoff:** Any saved word findable in under 5 seconds.
- **Scope fence:** Lives in the side panel, not a new options tab. **Depends on:** B1, B2. **Lead
  decides:** filter/sort UI. **Escalate:** none.

#### B13 — Related words on save `Impact 2 · Effort S · Score 2.0` · _needs A3, B1_

- **Today:** Each saved word is an island — "spectate" isn't connected to spectator, spectacle, inspect.
- **Missing:** A "Related words" chip (part of A3's row) whose result — synonyms, antonyms, family —
  is **persisted onto the saved entry**.
- **Why:** Words are learned in families; roots are English's compression algorithm. One good answer
  turns 1 saved word into 4.
- **Payoff:** Your lexicon grows connections, not just entries; the family is there later with no new
  API call.
- **Scope fence:** Persisted onto the entry (extends the B2 schema). **Depends on:** A3, B1. **Lead
  decides:** chip copy. **Escalate:** none (but the schema field goes through the B2 lock).

#### B15 — Site lookup stats `Impact 2 · Effort S · Score 2.0`

- **Today:** The extension has no notion of _where_ lookups happen; you can't see The Economist
  drives 10× the lookups of Reddit.
- **Missing:** A per-domain tally — lookups and saves per site — from existing history.
- **Why:** Knowing which sources stretch you (and which bore you) helps pick tomorrow's reading at
  the right level.
- **Payoff:** A glanceable "where do I actually learn?"
- **Scope fence:** **Counts from existing lookup history ONLY** — never track pages read or page
  content (that would be surveillance). **Depends on:** — · **Lead decides:** presentation. Constraint
  is a rule, not a choice.

#### B10 — Weekly digest `Impact 3 · Effort M · Score 1.5`

- **Today:** No sense of progress exists; words scroll by and nothing sums a week.
- **Missing:** A small side-panel section, computed when you open the panel: words met this week,
  repeat lookups, top source sites.
- **Why:** Gentle awareness sustains a habit better than gamification — and a reader-first user would
  hate streaks and badges.
- **Payoff:** Open the panel Friday → "23 lookups, 6 saved, 3 repeat offenders, mostly from nautil.us."
- **Scope fence:** Computed on open — no background jobs, no notifications, no streaks. **Depends on:**
  — · **Lead decides:** which stats. **Escalate:** none.

#### B11 — Casual review flip `Impact 3 · Effort M · Score 1.5` · _needs B1, B5_

- **Today:** No way to revisit saved words except reading the list — no active recall.
- **Missing:** An optional "5-minute flip" in the side panel: shows the **original sentence** of a
  recent learning-status word → tap to reveal your saved meaning → optionally mark known.
- **Why:** Some moments invite light review, but a scheduler with due dates turns a reading tool into
  homework the reader will abandon.
- **Payoff:** Guilt-free review — deck = learning words from the last 14 days, shuffled; do 5 or 50,
  nothing is "overdue."
- **Scope fence:** **No scheduling algorithm, no due dates, no streaks — permanently out of scope**
  (stated so no future contributor "improves" it into Anki). **Depends on:** B1, B5. **Lead decides:**
  deck window, card UI. **Escalate:** none.

#### B12 — LLM auto-grouping `Impact 3 · Effort M · Score 1.5` · _needs B1_

- **Today:** (With B1) saved words pile up as one undifferentiated list; manual folders would work,
  but nobody files 200 words by hand.
- **Missing:** One button — "Organize my words" → the LLM clusters saved words into editable topic
  tags ("finance", "words from Latin _spec-_").
- **Why:** Structure helps recall, but structure-by-hand never happens; this is the one place AI should
  do the librarian work.
- **Payoff:** 200 loose words → a dozen meaningful groups in one tap; tags are yours to edit.
- **Scope fence:** Runs **only on explicit button press**, never in background; warns it spends the
  user's tokens (S4/constraint 4). **Depends on:** B1. **Lead decides:** prompt, tag-edit UI.
  **Escalate:** none.

#### B14 — Sense-aware dedup `Impact 3 · Effort M · Score 1.5` · _needs B1_

- **Today:** (With B1) saving "bank" from a river article and later from a finance article makes two
  disconnected entries of the same headword.
- **Missing:** On saving an already-saved headword with a new sentence, offer "add as a new sense?" —
  one entry, multiple senses, each with its own sentence and source.
- **Why:** A pile of duplicates reads like a log; one headword with its senses reads like a dictionary —
  _your_ dictionary.
- **Payoff:** "bank — 1. riverside (hiking blog) · 2. money business (FT)." Polysemy becomes visible
  structure you collected.
- **Scope fence:** Case-insensitive exact headword match only; "run"/"running" stay separate in v1.
  Uses the `senses[]` field from B2's schema. **Depends on:** B1. **Lead decides:** merge-prompt UX.
  **Escalate:** none (schema field via the B2 lock).

---

## 5. Dependency map

```mermaid
graph LR
    B1[B1 Save word] --> B2[B2 Context capture]
    B1 --> B5[B5 Status lifecycle]
    B1 --> B6[B6 Words page]
    B1 --> B7[B7 Repeat nudge]
    B1 --> B8[B8 Anki export]
    B1 --> B9[B9 Backup]
    B1 --> B12[B12 Auto-grouping]
    B1 --> B14[B14 Sense dedup]
    B2 --> B6
    B5 --> B3[B3 Re-encounter highlight]
    B1 --> B3
    B3 --> B4[B4 Hover-recall]
    B5 --> B11[B11 Review flip]
    A3[A3 Follow-up chips] --> B13[B13 Related words]
    B1 --> B13
    A4[A4 Keyboard flow] -.nice with.-> A13[A13 Quiet mode]
```

**Reading order that respects dependencies:** B1 → B2 (lock schema) → B5 → B3 → B4 unlocks the whole
learning spine. Everything in Category A except A13→A4 and B13→A3 is independent and safe to pick in
any order.

---

## 6. Escalation register (the only things that need the owner)

The lead runs everything else. Bring these — and only these — to the human:

| #   | Decision                                          | Why it's the owner's call                                                | Blocks                        |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| E1  | **Saved-word entry schema** (B2 shape)            | Irreversible once users have data; every B-idea reads/writes it.         | B1, B2, and all of Category B |
| E2  | **Backup file envelope + version** (B9)           | A public, forward-compatible format; changing it strands exported files. | B9                            |
| E3  | **Multi-language source** (A12) go/ship/advertise | Widens the product promise beyond "English"; affects store positioning.  | A12                           |
| E4  | **PDF go/no-go + permissions** (A11)              | Needs the spike result, and likely a new `file://`/host permission.      | A11                           |
| E5  | **Matching beyond naive** (B3)                    | A lemmatizer raises false-positive highlights — a product-feel tradeoff. | B3 v2                         |
| E6  | **Any new manifest permission** (general)         | Permissions change the store listing and user-trust story.               | any idea that needs one       |

Everything not in this table, the lead decides and directs. **E1, E2, E3, and E4 are
resolved — see §8 Decision Log** (E4's spike is approved; the post-spike go/no-go and any
new permission remain owner calls, as does E5 and E6).

---

## 7. Ranked summary (flat, by score)

| Rank | Idea                                | Score | Rank | Idea                      | Score |
| ---- | ----------------------------------- | ----- | ---- | ------------------------- | ----- |
| 1    | B1 Save word ·foundation ✅ Shipped | 5.0   | 9    | A15 Latency budget        | 3.0   |
| 2    | A4 Keyboard flow ✅ Shipped         | 4.0   | 10   | B5 Status lifecycle       | 3.0   |
| 3    | A8 Idiom expansion ✅ Shipped       | 4.0   | 11   | B9 Backup/restore         | 3.0   |
| 4    | B2 Context capture ✅ Shipped       | 4.0   | 12   | A1 Streamed answers       | 2.5   |
| 5    | B4 Hover-recall                     | 4.0   | 13   | B3 Re-encounter highlight | 2.5   |
| 6    | B7 Repeat nudge ✅ Shipped          | 4.0   | 14   | A2 Recursive lookup       | 2.0   |
| 7    | B8 Anki export                      | 4.0   | 15   | A3 Follow-up chips        | 2.0   |
| 8    | A6 Smart placement                  | 3.0   | 16   | A5 Gloss mode             | 2.0   |
| 8    | A16 Sticky save bar ✅ Shipped      | 3.0   | 17   | A13 Quiet mode            | 2.0   |
| 8    | A9 Instant cache                    | 3.0   | 18   | A14 Double-click          | 2.0   |
| 8    | A10 TTS                             | 3.0   | 19   | B13 Related words         | 2.0   |
| —    |                                     |       | 19   | B15 Site stats            | 2.0   |
| —    |                                     |       | 21   | A7 Pin cards              | 1.5   |
| —    |                                     |       | 21   | A12 Non-English source    | 1.5   |
| —    |                                     |       | 21   | B10 Weekly digest         | 1.5   |
| —    |                                     |       | 21   | B11 Review flip           | 1.5   |
| —    |                                     |       | 21   | B12 Auto-grouping         | 1.5   |
| —    |                                     |       | 21   | B14 Sense dedup           | 1.5   |
| —    |                                     |       | 27   | A11 PDF (spike)           | 1.3   |

**Score ≠ sequence.** B1 leads despite being foundational-first, not because of raw score; the lead
sequences by dependency (B1→B2→B5→B3) and by quick-win clustering (the S-effort A-ideas), escalating
only the six items in §6.

---

## 8. Decision Log

_(append-only; date · card · question · ruling · decided by)_

**Campaign: "Top 5 value" batch (2026-07-10).** Owner directive: dispatch the Warchief to
implement the 5 highest-scored, dependency-clear roadmap items — **A4 → A8 → B1 → B2 → B7** —
one at a time, verifying each before starting the next. All 5 shipped and independently
verified. A16 (§4) had already shipped before this campaign started.

- 2026-07-10 · B4 vs B7/B8 tie-break · "Which 4.0-score cards fill the remaining 4 batch slots
  behind B1?" · Picked A4, A8, B2, B7 over B4 (needs a 2-hop unshipped chain B5→B3) and B8
  (needs B1+B2, weaker adoption-flywheel effect than B7 — B7 actively funnels repeat-lookup
  users into saving, compounding B1's value more than an export feature would on its own) ·
  decided by Shaman (ordinary sequencing call, not an escalation item).
- 2026-07-10 · B1/B2 · **E1 escalation — saved-word entry schema.** Owner ratified **Option A**
  (full shape), with one refinement the owner made explicit over the Shaman's flatter proposal:
  per-encounter fields (definition, translation, sentence, url, title) live **inside** each
  `senses[]` entry, not at the top level, so a headword's multiple senses (B14) each carry
  their own context:

  ```
  {
    word:    string                   // headword; case-insensitive unique key (B14 fence)
    status:  "learning" | "known"     // defaults to "learning" on save (B5)
    savedAt: number                   // timestamp of first save
    senses: [{                        // starts as a single-entry array
      definition:  string             // as shown at save time
      translation: string             // as shown at save time
      sentence:    string             // the sentence the word was selected in
      url:         string             // source page
      title:       string             // source page title
    }]
  }
  ```

  Governance the owner attached: future **additive** fields (e.g. B13 related-words, a
  per-sense timestamp for B14) stay lead-decidable through this same B2 lock —
  **restructuring or removing a ratified field is a new escalation.** Standing constraints
  still bind: new storage keyspace separate from history (`ref-kv-storage-prefixes`), clearing
  history never touches saved words, API key never appears near this data or its future
  exports (S1) · decided by Owner (irreversible data shape, register item E1).
  **Fully delivered and held unchanged across 3 dependent cards** — B1 implemented the shape
  verbatim; B2 populated the last empty field (`translation`) without touching it; B7 added a
  nudge feature entirely via a transient `LookupResult.nudge` field and an independent
  `nudge:<word>` keyspace, again without touching it. Verified by the Shaman independently at
  every ship via `git diff` on `packages/app/src/domain/types.ts` across all three merges.

- 2026-07-10 · (campaign-wide) · Successor-Shaman resume after an owner-machine crash
  mid-campaign · Verified surviving git/GitHub state independently (a branch fully pushed with
  evidence captured but its PR never opened) matched a reconstructed handoff report exactly;
  treated all prior selection and E1 rulings as already decided; dispatched a successor
  Warchief to adopt the existing worktree/branch rather than re-implement · decided by Shaman
  (operational continuity, not a new product decision).
- 2026-07-10 · A4 · A Warchief's own turn ended mid-wait on a still-running background e2e test
  process, with a non-terminal filler result · Ruled this was **not** a stale/dead agent —
  independently confirmed the underlying OS process was still alive and progressing — so
  resumed the same agent rather than dispatching a duplicate onto the same branch · decided by
  Shaman (operational/liveness judgment, not a product decision). **This exact failure mode
  recurred on B2's CI wait and was handled the same way both times** — a lesson worth keeping
  for future campaigns: a Warchief ending its turn with a non-terminal result is not
  necessarily a dead agent; check the real process/CI state before assuming so.
- 2026-07-10 · A8 · The wire protocol gained 2 new **optional** fields
  (`LookupRequest.forceLiteral`, `LookupResult.definedAs`) · Ruled this is ordinary
  wire-protocol evolution within A8's own scope fence, **not** an E1-style irreversible
  persisted-data-shape escalation — E1 covers the saved-word storage entry and the B9 backup
  file envelope specifically; optional in-flight request/response fields aren't persisted user
  data · decided by Shaman (routine What/Why boundary call, not a register item). The same
  reasoning was applied again for B2's optional `LookupResult.translation` and B7's optional
  `LookupResult.nudge`.
- 2026-07-10 · B1 · A request to have the Shaman directly read a Warchief's spec file to
  pre-verify E1 schema conformance before its Hunters started building · **Declined** —
  reading a Warchief's spec/plan/diff is a hard Shaman role boundary; a Warchief's artifacts
  are graded by its own audit process, not by the Shaman. Achieved the same early-catch value
  through an in-bounds channel instead: asked the Warchief to self-verify its own spec against
  the ratified shape field-for-field and log a one-line attestation before proceeding — later
  independently re-confirmed by multiple audit checkpoints during the build · decided by Shaman
  (role-boundary preservation, not a What/Why call). The same self-verify pattern was reused
  successfully on B2 and B7.
- 2026-07-10 · B1 · `translation` ships as `''` (empty) for every B1-created entry, since the
  model returns one markdown blob with no separable translation field without B2's dedicated
  parsing work · Ruled acceptable as an interim state, not a schema deviation — the field
  exists per the ratified shape, populating it is explicitly B2's job · decided by Shaman
  (routine scope-boundary confirmation).
- 2026-07-10 · (campaign-wide) · **Batch complete.** All 5 cards (A4, A8, B1, B2, B7) verified
  `SHIPPED` — each with a mechanical proof pass (merge state, squash strategy, base-branch sync,
  worktree cleanup) plus an independent outcome-vs-goal check from evidence (CI results, PR
  evidence media, and — for the three schema-adjacent cards — a direct read of the merged
  `types.ts` on `master`, never by reading implementation diffs) · decided by Shaman
  (definition-of-done confirmation per §1).

**Campaign: "Run the roadmap" (2026-07-16).** Owner directive: implement **all remaining
roadmap ideas**. Shaman sequenced the full backlog by dependency and quick-win clustering:
learning spine first (B5 → B3 → B4), then B8, the S-effort A-cards (A6, A9, A10, A15), B6,
B9, A1, A3 → B13, A2, A5, A13, A14, A7, A12, B14, B11, B10, B12, B15, and the A11 spike
last. One Warchief per card, verified SHIPPED before the next dispatch.

- 2026-07-16 · B9 · **E2 escalation — backup file envelope.** Owner ratified the Shaman's
  proposal: `{ format: "ai-dict-backup", version: 1, exportedAt: <timestamp>, data: {
savedWords: SavedWordEntry[], history: HistoryEntry[], settings: <all settings MINUS the
API key (S1)> } }`; import offers merge or replace, and importers ignore unknown future
  fields (forward compatibility). Additive fields stay lead-decidable under this lock;
  restructuring or removing a ratified field is a new escalation (same governance as E1) ·
  decided by Owner (register item E2).
- 2026-07-16 · A12 · **E3 escalation — multi-language source.** Owner ruled **build, don't
  advertise**: fix the hard-coded `{source_lang}` with detection + on-card override and ship
  it quietly; the store listing, landing page, and marketing story stay "English dictionary"
  until the owner separately decides to advertise · decided by Owner (register item E3).
- 2026-07-16 · A11 · **E4 escalation — PDF spike.** Owner approved running the time-boxed
  feasibility spike. Deliverable is a written go/no-go report (approaches, costs, permission
  needs) — **not** a feature; the post-spike go/no-go and any new permission return to the
  owner · decided by Owner (register item E4).
- 2026-07-16 · (campaign-wide) · **Merge policy changed: squash-merge is prohibited.** The
  owner's global rule ("Do not Squash merge") now overrides this repo's previous
  squash-merge DoD. From this campaign on, PRs land via **regular merge commits**; §1's
  definition of done is updated accordingly, and mechanical SHIPPED verification checks
  merge-commit strategy instead of squash. Historical squash merges (A4–B7 era) remain valid
  under the old rule · decided by Owner (governance conflict surfaced by the Shaman).
