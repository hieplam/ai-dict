# A12 — Non-English source pages

Roadmap card: `docs/ROADMAP.md` §4 A12 (Impact 3 · Effort M · Score 1.5). Depends on: — (independent).
Touches the shared prompt-builder (`c3-113`), so it is a **Concurrency** hazard alongside B12 (see
§8). No dependency on any other unshipped card.

## 1. Problem (grounded in code)

### 1.1 The actual hard-coded assumption is prose text, not the `{source_lang}` placeholder

The roadmap card's "Today" bullet says _"the prompt's `{source_lang}` placeholder is hard-coded to
'English'"_. Reading the code shows this is almost, but not quite, right — and the precise mechanism
matters for the fix:

- `packages/app/src/domain/default-template.ts:14` — the code-owned `PROMPT_ENVELOPE` constant's
  persona line is:
  ```
  You are a bilingual dictionary for {target_lang} learners of English.
  ```
  The word **"English" is baked in as literal prose** — there is no `{source_lang}` token anywhere
  in `PROMPT_ENVELOPE` (confirmed: `grep -n source_lang packages/app/src/domain/default-template.ts`
  returns nothing). This is the line that actually fires on every lookup through the **default**
  (non-advanced) envelope — i.e. for the overwhelming majority of users who have never opened
  Settings → Advanced.
- `packages/app/src/domain/prompt-template.ts:20-24` (`renderTemplate`) _does_ implement a
  `{source_lang}` placeholder as part of its generic `SUPPORTED` substitution list
  (`prompt-template.ts:18`), with a hard-coded fallback:
  ```ts
  const resolved: Record<string, string | undefined> = {
    ...vars,
    source_lang: vars.source_lang ?? 'English',
  };
  ```
  But **no caller anywhere passes `vars.source_lang`** today (confirmed:
  `grep -rn source_lang packages/app/src` finds only this fallback, the `TemplateVars` field
  declaration at `prompt-template.ts:13`, and one settings-form help string — see below). Since the
  default envelope never contains the `{source_lang}` token, this fallback is presently **dead code
  for the default path** — it only matters for a reader who has written a _custom_ prompt envelope
  override (roadmap #62, "Advanced" section) containing `{source_lang}` themselves.
- That advanced feature is real and already documented to the user:
  `packages/app/src/ui/settings-form.ts:176-178` —
  ```html
  <p id="envelope-help">
    Full prompt envelope — placeholders: {word} {context} {target_lang} {source_lang} {title}
    {output_format}. Editing this takes over the built-in safety constraints. Leave it as-is to keep
    the default.
  </p>
  ```
  `{source_lang}` has been advertised as an available placeholder to power users since this help
  text was written, but it has never been wired to anything — an already-half-built feature this
  card completes.

**Net effect today:** every lookup — whether the selected word sits in an English paragraph, a
French one, or a Japanese one — is prefaced with "learners of English" (default envelope) or
silently resolves any hand-written `{source_lang}` to `'English'` (advanced envelope). The roadmap's
observed symptom ("select a French or Japanese word and the model is told it's English — results
are luck") is caused by the **prose line**, not primarily by the placeholder fallback; both need to
change for the fix to reach the default (non-advanced) path that essentially all users are on.

### 1.2 `source_lang` never appears in the actual request either

`packages/app/src/domain/types.ts:16-39` (`LookupRequest`) has no `sourceLang` field at all.
`packages/app/src/domain/workflow.ts:65-73` (`runLookupWorkflow`'s `runLookup`) builds the request
from `SelectionEvent` + settings with no source-language input:

```ts
const req: LookupRequest = {
  word: e.text,
  context: e.sentence,
  url: e.url,
  title: e.title,
  target: settings.targetLang,
  outputFormat: settings.outputFormat,
  promptEnvelope: settings.promptEnvelope,
};
```

`packages/app/src/app/http-lookup-client.ts:83-94` (`runHttpLookup`'s shared skeleton, used by every
provider client) calls `buildPrompt` without a `source_lang` var:

```ts
const prompt = buildPrompt(
  req.outputFormat,
  { word: req.word, context: req.context, target_lang: req.target, url: req.url, title: req.title },
  req.promptEnvelope,
  req.forceLiteral,
);
```

So there is currently no path — DOM, domain, or wire — by which any signal about the word's source
language could reach the prompt, even if a caller wanted to supply one.

### 1.3 `SelectionEvent` carries no language signal either

`packages/app/src/app/dom-selection-source.ts` (`defaultReader`, lines 20-36 as of this reading — see
§9 concurrency note on why exact line numbers here are volatile) builds a `SelectionEvent` from
`window.getSelection()` with `text`/`sentence`/`anchor`/`url`/`title` only. Nothing reads
`document.documentElement.lang` or any element's `lang` attribute.

### 1.4 Precedent: `{target_lang}` already rides the prompt as a bare code, not a spelled-out name

`packages/app/src/ui/settings-form.ts:166` and `packages/app/src/ui/onboarding-view.ts:95`:

```html
<select id="target">
  <option value="vi">Vietnamese</option>
  <option value="en">English</option>
</select>
```

`settings.targetLang` is the select's **value** — `'vi'` or `'en'`, a bare short code — not the
display text "Vietnamese"/"English". This value is substituted directly into `{target_lang}` with no
code→name translation step anywhere in the domain (`prompt-template.ts`'s `SUPPORTED`/`resolved`
mechanism is a raw string substitution). This is the load-bearing precedent for §2.1 below.

### 1.5 Cache key does not (and per this card, should not) consider source language

`packages/app/src/domain/cache-policy.ts` derives the cache key from `word|context|target` only (per
`c3-112`, cited in REPO-FACTS). `packages/app/src/app/router.ts:110-114` — the existing skip-cache
guard:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true) {
  const hit = await cacheGet({ storage: deps.kv }, keyReq);
  ...
}
```

A manual provider pick or `forceLiteral` re-run already bypasses the cache read for the same reason
this card needs to: a hit would echo back an answer produced under a _different_ one-shot condition.
The cache key's own composition (whether it should incorporate sense/context at all) is **A9's job,
not this card's** — A9's card explicitly owns "cache key composition including sense/context"
(`docs/ROADMAP.md` §4 A9). This card does not touch `cache-policy.ts` or the key shape.

## 2. Design questions (the card's own "Lead decides" list, pinned)

### 2.1 Wire/prompt representation: bare language code, not a spelled-out name

**Pinned:** `LookupRequest.sourceLang?: string` carries a **bare, lowercase BCP-47 primary subtag**
(e.g. `'fr'`, `'ja'`, `'en'`) — exactly the same convention `target` already uses for
`{target_lang}` (§1.4). `{source_lang}` in the prompt therefore resolves to a bare code like `fr`,
not "French".

- **Rejected: resolve to a spelled-out English name (e.g. "French") before it reaches the prompt.**
  This would make `{source_lang}` behave differently from `{target_lang}` in the same prompt for no
  functional reason — LLMs handle ISO-639 codes fluently (they already receive `{target_lang}` as a
  bare code today, and translation quality has never depended on `target_lang` being spelled out).
  Introducing a code→name resolution layer in the domain purely for `source_lang` would be one more
  moving part with nothing to show for it.
- Human-readable names ARE still needed for the on-card display ("card shows the detected language")
  — that is a **UI-only** concern, resolved in the same place `Provider`/`PROVIDER_LABELS` already
  split this exact way (`packages/app/src/ui/lookup-card.ts:58-66`): a bare `Provider` code crosses
  the wire, a UI-only `PROVIDER_LABELS` map turns it into "ChatGPT"/"Claude" for display. §5.5 mirrors
  this precisely with a new `SOURCE_LANG_LABELS` map, UI-owned, never touching the wire.

### 2.2 Detection mechanism: nearest-ancestor `[lang]`, falling back to `document.documentElement.lang`

**Pinned:** at selection time, walk from the selection Range's common ancestor up to the nearest
element carrying a `lang` attribute (`Element.closest('[lang]')`); if none is found, fall back to
`document.documentElement.lang`. The raw (possibly empty) result becomes `SelectionEvent.pageLang`.
Parsing/recognition of that raw tag into a supported code happens later, in the domain (§2.3).

Three alternatives considered and rejected:

- **(a) `document.documentElement.lang` only (page-level, no ancestor walk).** Rejected: the
  reading scenario this roadmap theme (Category A) targets is exactly an English-language page with
  an embedded foreign passage — a news site quoting a French official, a blog embedding a Japanese
  proverb — each commonly marked with its own `lang` attribute on the surrounding element per W3C
  internationalization guidance, while `<html lang>` stays `"en"`. Page-level-only detection would
  mislabel every such embedded selection as English, missing exactly the case A12 exists to fix.
  The ancestor walk is one extra `.closest()` call — not real added complexity — so there is no
  effort-budget reason to skip it.
- **(b) A statistical/library-based language detector (e.g. franc, cld3) run on the selected text
  itself.** Rejected: adds a new dependency and non-deterministic, probabilistic output for a signal
  the page author has often already declared authoritatively via markup; short selections (a single
  word) are exactly the case such detectors are least reliable on, whereas `lang` attributes don't
  care how long the selection is. Effort M does not budget for a new NLP dependency.
- **(c) Only the ancestor walk, no page-level fallback.** Rejected: the overwhelming common case has
  no per-element `lang` override at all, so skipping the page-level fallback would mean most pages
  detect nothing, defeating the card's main payoff (most non-English pages `do` set `<html lang>`).

### 2.3 Recognition: a fixed, code-owned table of codes — English included

**Pinned:** a new domain module, `packages/app/src/domain/source-lang.ts`, owns a fixed
`SOURCE_LANG_CODES` array (20 BCP-47 primary subtags, canonical order — mirrors the
`PROVIDERS`/`Provider` pattern at `domain/types.ts:92-95`) and a pure function
`detectSourceLangCode(pageLang: string | undefined): SourceLangCode | undefined` that:

1. Returns `undefined` immediately if `pageLang` is absent/empty.
2. Lowercases and takes the primary subtag (splits on `-`/`_`, e.g. `"fr-CA"` → `"fr"`,
   `"en-US"` → `"en"`).
3. Returns the code only if it is one of the 20 recognized codes, else `undefined`.

`'en'` is **included** in the recognized set (not excluded as "no-op"), so that a page correctly
marked `lang="en"` still resolves to an explicit `sourceLang: 'en'` request — preserving today's
exact English-source behavior deterministically — rather than falling through to the "infer from
context" fallback (§2.4), which is strictly less certain than an explicit signal the page already
gave us. Only an absent/unrecognized tag falls through to inference.

- **Rejected: a full ISO-639-1 table (~180 codes) instead of a curated 20.** The override picker
  (§2.6) needs to render every entry as a tappable option in a small card; a near-complete list would
  make that control unusable on a narrow side-panel/popup width and would recognize codes this
  product's target audience (a 70%-reader/30%-learner base reading mainstream press/blogs/fiction) is
  very unlikely to ever select. 20 covers the common Western European + East Asian + a few South/
  Southeast Asian languages; nothing stops a future card from growing the table (an additive,
  lead-decidable change — same governance as any other UI copy list).
- **Rejected: recognize by exact full tag (`"en-US"` distinct from `"en-GB"`) instead of primary
  subtag.** The product's target-language selector is not regional either (`vi`/`en`, no locale
  variants); regional distinctions would multiply the override-picker list for no prompt-quality
  benefit — an LLM's answer to "define this word for an English reader" does not change between
  `en-US`/`en-GB`/`en-AU` source markup.

### 2.4 Fallback phrasing when detection fails: infer from context, explicitly not "assume English"

**Pinned:** `packages/app/src/domain/default-template.ts` gains a new constant:

```ts
export const AUTO_SOURCE_LANG_PHRASE =
  'an unspecified language — infer the source language of the word/sentence from context; do not assume English';
```

`prompt-template.ts:23`'s fallback changes from `vars.source_lang ?? 'English'` to
`vars.source_lang ?? AUTO_SOURCE_LANG_PHRASE`. `default-template.ts:14`'s persona line changes from
literal "English" to the `{source_lang}` placeholder (§5.1), so the assembled sentence in the
undetected case reads: _"You are a bilingual dictionary for Vietnamese learners of an unspecified
language — infer the source language of the word/sentence from context; do not assume English."_
This is prose fed to an LLM as an instruction, not UI copy — it does not need to be elegant English,
only unambiguous.

- **Rejected: keep `'English'` as the fallback.** That is the exact bug this card exists to fix —
  keeping it would mean any page with no recognizable `lang` signal (still a large fraction of the
  web) continues to get the wrong-premise treatment the roadmap card describes.
- **Rejected: require detection to always succeed (block/degrade the lookup when undetectable).**
  The product's core loop (`workflow.ts`) has no precedent for blocking a lookup on a missing signal
  (compare: the trigger fires unconditionally, `NO_KEY` is the _only_ blocking gate) — this would be
  a new failure mode this card was never asked to add, and it would make every unmarked page (a
  common, legitimate case, not an error) show a dead-end where a working lookup exists today.

### 2.5 On-card display + override: in-page card only, mirroring the provider-switcher/force-literal precedent

**Pinned:** the detected/current source language and its override control render **only on the
in-page lookup card** (`InlineBottomSheetRenderer` → `<lookup-card>`), not in the side panel.

Grounding for why this is a precedented, not a new, scope line: `packages/extension-chrome/src/
content.ts:101-104` already documents exactly this split for the two existing one-shot overrides —

```ts
// Forward the picker context to the in-page card only; the side-panel mirror shows the
// badge/note from `r` but no one-shot picker (it's a persistent surface).
inline.renderResult(r, ctx);
mirror.renderResult(r, ctx);
```

and `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts:24-32`
(`ChromeSidePanelMirror.renderResult`) forwards only `ctx.sentence/url/title` — never
`ctx.providers`/`ctx.onSwitchProvider`/`ctx.onForceLiteral` — because the side panel is a `postMessage`
mirror of a plain `LookupResult`, with no live callback channel back into the in-page workflow. The
provider switcher and the A8 "Show literal word" button already work this exact way: visible and
interactive only on the in-page card. This card's override control needs the identical one-shot
re-run wiring (§5.6), so it inherits the identical scope line.

- **Rejected: also mirror the detected-language badge (read-only, no override) to the side panel.**
  Rejected for consistency and minimalism: the existing precedent already chose not to mirror even
  the _read-only_ provider badge context beyond `r.provider` itself (the badge that DOES appear in
  the side panel today is derived from `LookupResult.provider`, a field on the result, not from
  `ResultRenderContext`). Since `sourceLang` lives on the _request_, not the `LookupResult`, mirroring
  it would require adding a new field either to `LookupResult` (persisting a request-only value into
  cache/history, an unrelated shape change out of scope) or to the mirror's `post()` payload (a new,
  one-off side channel for a single card, when the existing precedent for "one-shot request context"
  is simply "in-page card only"). Follow-on work can revisit this if a future card needs it.

### 2.6 Override control shape: a disclosure "Change" button + fixed listbox, mirroring the provider switcher exactly

**Pinned:** the card shows a persistent, low-key row: `Source: <label>` (`Source: French`, or
`Source: Auto-detect` when nothing was detected/overridden) plus a `Change` button that expands a
`role="listbox"` menu of `Auto-detect` + all 20 `SOURCE_LANG_CODES` entries (current selection
disabled, others clickable) — structurally identical to `renderMetaRow`'s existing provider-switch
button/menu (`packages/app/src/ui/lookup-card.ts:452-500`). Picking an option dispatches a composed
`override-source-lang` event (`detail: { code: string }`, `code` = `'auto'` or a `SourceLangCode`)
that the composition root turns into a one-shot re-run (§5.6/§5.7) — same shape as `switch-provider`.

- **Rejected: a free-text input.** Free text would need its own validation/normalization path (what
  does the model do with "Frenchy" or a typo?) for a benefit — arbitrary languages — the 20-code table
  already covers for this product's audience; a fixed, disabled-when-current listbox is also directly
  reusable UI code (the provider switcher's exact shape), not a new pattern to build and test.
- **Rejected: always-visible row PLUS a settings-level global default.** The roadmap explicitly frames
  this as **per-lookup** detection with a manual override on the card, not a persisted setting; adding
  a global settings field would be new persisted state with no card requirement asking for it, and
  would raise the same "is this a schema escalation" question E1/E2 exist to gate — unnecessary when
  a one-shot, per-lookup override (matching provider/force-literal) already satisfies the card.

### 2.7 Manual override always bypasses the cache; the ordinary auto-detected lookup does not

**Pinned:** `LookupRequest` gains a second new field, `sourceLangOverride?: boolean` — set to `true`
only when the request was built from a manual card pick (including explicitly re-picking
`Auto-detect`), never for the ordinary first lookup. `router.ts:110-114`'s cache-skip guard gains one
more condition:

```ts
if (cacheEnabled && req.provider === undefined && req.forceLiteral !== true && req.sourceLangOverride !== true) {
```

Without this, a manual re-pick of the source language after the first (auto-detected) lookup already
cached an answer would return the stale cached `LookupResult` — produced under the _old_ source-
language assumption — silently ignoring the override, exactly the bug class `provider`/`forceLiteral`
already guard against for their own one-shot overrides.

The ordinary, non-overridden lookup is **not** excluded from the cache — `cache-policy.ts`'s key
(`word|context|target`) does not incorporate source language at all, so two pages with the same
word/sentence/target but different declared source languages could theoretically share a cache entry
computed under a different `{source_lang}`. This is an accepted, pre-existing limitation of the cache
key's shape (unrelated to whether A12 ships) and is explicitly A9's card to fix ("cache key
composition including sense/context") — not reopened here.

## 3. Scope fence held

- **E3 (owner ruling, `docs/ROADMAP.md` §8, quoted verbatim):** _"Owner ruled **build, don't
  advertise**: fix the hard-coded `{source_lang}` with detection + on-card override and ship it
  quietly; the store listing, landing page, and marketing story stay 'English dictionary' until the
  owner separately decides to advertise."_ This card makes **zero** changes to `docs/index.html`, the
  Chrome Web Store listing, or any marketing copy. Nothing in this design adds user-facing language
  beyond the card's own "Source: …" row and its listbox — no onboarding copy, no settings-page
  callout, no README mention.
- **Target-language logic unchanged.** No line in this design touches `settings.targetLang`,
  `{target_lang}`'s resolution, the `#target` select, or `TRANSLATION_INSTRUCTION`
  (`default-template.ts:64-65`). `renderTemplate`'s `SUPPORTED` list already contained `source_lang`
  before this card (`prompt-template.ts:18`) — this card activates a placeholder mechanism that
  already existed for `target_lang`'s sibling, it does not touch `target_lang`'s own resolution path.
- **No new manifest permission.** `document.documentElement.lang` and `Element.closest('[lang]')` are
  ordinary DOM reads already available to the existing content scripts (`<all_urls>` host permission,
  already granted). Nothing here needs a new `chrome.*` API.
- **No new wire message.** Per CONTRACTS §3's ruling (A8/B2/B7 precedent): two new **optional**
  fields on the existing `lookup` message's `req` payload are ordinary wire evolution, not an
  escalation.
- **S1 untouched.** Nothing in this card's data (a BCP-47 code, a boolean) is secret; no path near
  the API key changes.
- **S4 untouched.** No change to `markdown-sanitize.ts`; the model's markdown output is unaffected by
  which persona sentence produced it.
- **Design tokens only.** The new "Source: … / Change" row and its listbox read exclusively
  `--ad-*`/`--adp-*` tokens, reusing the exact CSS shape already proven for `.prov-switch`/
  `.prov-menu` (§5.5).

## 4. Files touched (summary)

| File                                                           | Change                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/domain/source-lang.ts`                       | **New.** `SOURCE_LANG_CODES`, `SourceLangCode`, `primarySubtag`, `detectSourceLangCode`.                                                                                                                                                                                                                                                             |
| `packages/app/src/domain/types.ts`                             | `SelectionEvent.pageLang?: string`; `LookupRequest.sourceLang?: string`, `LookupRequest.sourceLangOverride?: boolean`.                                                                                                                                                                                                                               |
| `packages/app/src/wire.ts`                                     | `LookupRequestSchema` gains `sourceLang`/`sourceLangOverride` (both optional).                                                                                                                                                                                                                                                                       |
| `packages/app/src/app/router.ts`                               | `handleLookup`'s cache-skip guard gains `req.sourceLangOverride !== true`.                                                                                                                                                                                                                                                                           |
| `packages/app/src/domain/default-template.ts`                  | `PROMPT_ENVELOPE`'s persona line: literal "English" → `{source_lang}`; new `AUTO_SOURCE_LANG_PHRASE` constant.                                                                                                                                                                                                                                       |
| `packages/app/src/domain/prompt-template.ts`                   | `renderTemplate`'s fallback: `'English'` → `AUTO_SOURCE_LANG_PHRASE`.                                                                                                                                                                                                                                                                                |
| `packages/app/src/app/http-lookup-client.ts`                   | `buildPrompt` call passes `source_lang: req.sourceLang` (conditionally).                                                                                                                                                                                                                                                                             |
| `packages/app/src/app/dom-selection-source.ts`                 | `defaultReader` captures `pageLang` (nearest-ancestor `[lang]`, falls back to `document.documentElement.lang`).                                                                                                                                                                                                                                      |
| `packages/app/src/domain/workflow.ts`                          | `runLookup` gains a `sourceLangOverride` param; resolves the effective code; sets `req.sourceLang`/`req.sourceLangOverride`; `ctx` gains `sourceLang` + `onOverrideSourceLang`.                                                                                                                                                                      |
| `packages/app/src/ports.ts`                                    | `ResultRenderContext` gains `sourceLang?: string`, `onOverrideSourceLang?: (code: string) => void`.                                                                                                                                                                                                                                                  |
| `packages/app/src/ui/lookup-card.ts`                           | `CardState`'s `result` variant gains `sourceLang?: string`; new `SOURCE_LANG_LABELS` (UI-only), `renderSourceLangRow`; CSS for `.src-lang-row`/`.src-lang-row__change`/`.src-lang-menu`.                                                                                                                                                             |
| `packages/app/src/app/inline-bottom-sheet-renderer.ts`         | Wires the card's `override-source-lang` event to `ctx.onOverrideSourceLang`; forwards `ctx.sourceLang` into `CardState`.                                                                                                                                                                                                                             |
| `packages/app/src/index.ts`                                    | `export * from './domain/source-lang'`.                                                                                                                                                                                                                                                                                                              |
| Tests (unit)                                                   | `test/source-lang.test.ts` (new), `test/wire-schema.test.ts`, `test/app/router.test.ts`, `test/default-template.test.ts`, `test/prompt-template.test.ts`, `test/app/dom-selection-source.test.ts`, `test/workflow.test.ts`, `test/ui/lookup-card.test.ts`, `test/app/inline-bottom-sheet-renderer.test.ts` — all extended, none rewritten wholesale. |
| `packages/extension-chrome/e2e/a12-non-english-source.spec.ts` | **New** functional e2e.                                                                                                                                                                                                                                                                                                                              |

### 4.1 No change to (explicitly, for the implementer's benefit)

- `packages/app/src/domain/legacy-templates.ts` — contains the same literal "learners of English"
  text twice (lines 13, 49), but it is a **frozen historical snapshot** list used by
  `resolvePromptEnvelope` purely for string-equality migration detection ("does the user's stored
  legacy template match a template we once shipped, verbatim?"). Changing any entry here would break
  that equality check for real stored settings, silently reclassifying an unmodified-legacy user as
  "customized." Left untouched, deliberately.
- `packages/app/src/domain/cache-policy.ts` — the cache key shape is A9's card, not this one (§1.5).
- `packages/app/src/ui/settings-form.ts` — its Advanced help text already lists `{source_lang}`
  (§1.1); no wording changes needed, since the placeholder it already documents now actually works.
- `packages/extension-chrome/src/content.ts` — the `override-source-lang` listener is wired inside
  `InlineBottomSheetRenderer.ensureCard()` (§5.7), exactly where `switch-provider`/`force-literal`
  already live; `content.ts` itself needs no new listener, mirroring how it has none for those two
  today either.
- `packages/app/src/ui/side-panel-view.ts`, `packages/extension-chrome/src/adapters/
chrome-side-panel-mirror.ts`, `packages/extension-chrome/src/side-panel.ts` — per §2.5, this card
  is in-page-card-only.
- `packages/app/src/ui/settings-form.ts`'s `#target` select, `domain/translation-line.ts`,
  `domain/defined-as.ts` — target-language and A8/B2 machinery are untouched.
- `manifest.json` (both platforms) — no permission change.

## 5. The change (per file, in dependency order)

### 5.1 `packages/app/src/domain/source-lang.ts` (new)

```ts
/**
 * A12 — non-English source pages. A fixed, code-owned table of BCP-47 primary-subtag source
 * languages this build recognizes for {source_lang} detection/override, mirroring how
 * {target_lang} already rides the prompt as a bare code (settings-form.ts's #target select ships
 * 'vi'/'en', not "Vietnamese"/"English") — {source_lang} follows the same convention. Human-
 * readable display names for the on-card override picker are a UI-only concern
 * (ui/lookup-card.ts's SOURCE_LANG_LABELS), exactly mirroring the Provider/PROVIDER_LABELS split.
 *
 * Domain-pure: zero imports (rule-domain-purity).
 */

/** Canonical order — also the order the card's override picker lists them in. */
export const SOURCE_LANG_CODES = [
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'ja',
  'zh',
  'ko',
  'ru',
  'vi',
  'ar',
  'hi',
  'pl',
  'tr',
  'sv',
  'el',
  'th',
  'id',
  'en',
] as const;

export type SourceLangCode = (typeof SOURCE_LANG_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(SOURCE_LANG_CODES);

/** Lowercase + take the primary subtag: "fr-CA" -> "fr", "en-US" -> "en", "EN" -> "en". */
export function primarySubtag(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Resolve a raw page/element `lang` attribute value (as captured by
 * app/dom-selection-source.ts's readPageLang) to a recognized SourceLangCode, or undefined when
 * absent or unrecognized. Callers fall back to the neutral auto-phrase in that case — see
 * domain/prompt-template.ts's use of default-template.ts's AUTO_SOURCE_LANG_PHRASE.
 */
export function detectSourceLangCode(pageLang: string | undefined): SourceLangCode | undefined {
  if (!pageLang) return undefined;
  const code = primarySubtag(pageLang);
  return CODE_SET.has(code) ? (code as SourceLangCode) : undefined;
}
```

### 5.2 `packages/app/src/domain/types.ts`

Add one optional field to `SelectionEvent` (16-24 area — insert after `title`):

```ts
export interface SelectionEvent {
  text: string;
  sentence: string;
  anchor: AnchorRect;
  url: string;
  title: string;
  /**
   * A12: the raw `lang` attribute value captured at selection time (nearest-ancestor
   * `[lang]`, falling back to `document.documentElement.lang`) — see
   * app/dom-selection-source.ts's readPageLang. Unparsed; domain/source-lang.ts's
   * detectSourceLangCode does the recognition step. Absent when neither source declared one.
   */
  pageLang?: string;
}
```

Add two optional fields to `LookupRequest` (after the existing `forceLiteral` field):

```ts
  /**
   * A12: the source language of the word/sentence, as a bare BCP-47 primary subtag (e.g. 'fr'),
   * exactly like `target` already carries {target_lang} as a bare code. Set from
   * domain/source-lang.ts's detectSourceLangCode when recognized, or from a manual card
   * override; absent means "could not be determined" — buildPrompt then falls back to the
   * neutral AUTO_SOURCE_LANG_PHRASE instruction instead of assuming English.
   */
  sourceLang?: string;
  /**
   * A12: true only when `sourceLang` above came from a manual, one-shot card override (including
   * an explicit re-pick of "Auto-detect") rather than ordinary auto-detection. The router skips
   * the cache read when this is true — mirrors `provider`/`forceLiteral`'s existing skip-cache
   * reasoning (a cache hit would echo back an answer produced under the OLD source-language
   * assumption, silently ignoring the override).
   */
  sourceLangOverride?: boolean;
```

### 5.3 `packages/app/src/wire.ts`

`LookupRequestSchema` (26-39) gains the two matching optional fields, right after `forceLiteral`:

```ts
const LookupRequestSchema = z.strictObject({
  word: z.string(),
  context: z.string(),
  url: z.string(),
  title: z.string(),
  target: z.string(),
  outputFormat: z.string(),
  promptEnvelope: z.string(),
  provider: ProviderEnum.optional(),
  forceLiteral: z.boolean().optional(),
  // A12: bare BCP-47 primary subtag (e.g. 'fr'); absent = could not be determined.
  sourceLang: z.string().optional(),
  // A12: true only for a manual, one-shot override — see domain/types.ts's doc comment.
  sourceLangOverride: z.boolean().optional(),
});
```

The compile-time `AssertEqual<z.infer<typeof LookupRequestSchema>, LookupRequest>` check
(`wire.ts:204`) already exists and needs no new entry — it will simply fail to compile if these two
additions drift from `domain/types.ts`'s `LookupRequest`, which is the point.

### 5.4 `packages/app/src/app/router.ts`

`handleLookup`'s cache-skip guard (110-114) gains the new condition:

```ts
// A manual provider pick (req.provider set) must reach the picked provider: the cache key
// ignores provider, so a hit would echo back the previous provider's answer. Skip the read.
// A8: the same reasoning applies to a forced-literal re-run (req.forceLiteral) — a hit
// would echo back the smart idiom-aware answer instead of the literal one requested.
// A12: same reasoning for a manual source-language override (req.sourceLangOverride) — a hit
// would echo back an answer produced under the OLD source-language assumption.
if (
  cacheEnabled &&
  req.provider === undefined &&
  req.forceLiteral !== true &&
  req.sourceLangOverride !== true
) {
  const hit = await cacheGet({ storage: deps.kv }, keyReq);
  ...
}
```

No other line in `router.ts` changes — `handleConnectionTest` (195-211) never sets `sourceLang`, and
needs none; its literal `word: 'test'` lookup is unaffected either way.

### 5.5 `packages/app/src/domain/default-template.ts`

Line 14's persona sentence changes from a literal to a placeholder:

```ts
export const PROMPT_ENVELOPE = `You are a bilingual dictionary for {target_lang} learners of {source_lang}.
Word/phrase: "{word}"
...
```

(Everything else in `PROMPT_ENVELOPE` is unchanged — only the one word "English" is replaced by
`{source_lang}`.)

New constant, appended after `TRANSLATION_INSTRUCTION`:

```ts
/**
 * A12 — non-English source pages. Fallback text for {source_lang} when detection found nothing
 * confident (no recognized page/element `lang` attribute) and the reader has not manually
 * overridden it. Replaces the previous hard-coded 'English' default
 * (prompt-template.ts's old `vars.source_lang ?? 'English'`) with an instruction that lets the
 * model infer the source language from the sentence itself, rather than presupposing English for
 * every page whose language could not be determined.
 */
export const AUTO_SOURCE_LANG_PHRASE =
  'an unspecified language — infer the source language of the word/sentence from context; do not assume English';
```

### 5.6 `packages/app/src/domain/prompt-template.ts`

`renderTemplate`'s `resolved` object (20-24):

```ts
import {
  PROMPT_ENVELOPE,
  IDIOM_AUTO_INSTRUCTION,
  IDIOM_FORCE_LITERAL_INSTRUCTION,
  TRANSLATION_INSTRUCTION,
  AUTO_SOURCE_LANG_PHRASE,
} from './default-template';
...
export function renderTemplate(template: string, vars: TemplateVars): string {
  const resolved: Record<string, string | undefined> = {
    ...vars,
    source_lang: vars.source_lang ?? AUTO_SOURCE_LANG_PHRASE,
  };
  ...
}
```

`buildPrompt` itself is unchanged — `{source_lang}` was already part of the generic `SUPPORTED`/
`renderTemplate` substitution pass (unlike `{output_format}`/`{idiom_instruction}`/
`{translation_instruction}`, which get their own direct-replace steps); it needs no new insert step.

### 5.7 `packages/app/src/app/http-lookup-client.ts`

`runHttpLookup`'s `buildPrompt` call (83-94) gains one conditional key:

```ts
const prompt = buildPrompt(
  req.outputFormat,
  {
    word: req.word,
    context: req.context,
    target_lang: req.target,
    ...(req.sourceLang !== undefined ? { source_lang: req.sourceLang } : {}),
    url: req.url,
    title: req.title,
  },
  req.promptEnvelope,
  req.forceLiteral,
);
```

(Conditional spread matches the codebase's existing `exactOptionalPropertyTypes` idiom, e.g. the
`httpInput` object built a few lines below in the same file.)

### 5.8 `packages/app/src/app/dom-selection-source.ts`

New helper + one field added to `defaultReader`'s return:

```ts
/**
 * A12: the nearest-ancestor `lang` attribute wins over the page-level default — embedded
 * foreign-language quotes/passages are common on otherwise-English pages (W3C i18n convention:
 * mark the passage, not just <html>). Falls back to document.documentElement.lang when no
 * ancestor declares one. Returns the raw tag, unparsed; domain/source-lang.ts's
 * detectSourceLangCode does the recognition step.
 */
function readPageLang(range: Range): string | undefined {
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const lang = el?.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang;
  return lang || undefined;
}

function defaultReader(): SelectionEvent | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const full = range.startContainer.textContent ?? text;
  const r = range.getBoundingClientRect();
  const anchor: AnchorRect = { x: r.x, y: r.y, w: r.width, h: r.height };
  const pageLang = readPageLang(range);
  return {
    text,
    sentence: extractSentence(full, range.startOffset, range.endOffset),
    anchor,
    url: location.href,
    title: document.title,
    ...(pageLang !== undefined ? { pageLang } : {}),
  };
}
```

This file currently also carries A15's `SELECTION_FIRED_MARK` instrumentation (a `performance.mark`
call inside `onSelection`'s handler) — see §9's concurrency note; this card's change is additive and
does not touch that code path.

### 5.9 `packages/app/src/domain/workflow.ts`

`runLookup` gains a fourth parameter and resolves the effective source language:

```ts
import type { SelectionEvent, LookupRequest, LookupError, Provider } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';
import { detectSourceLangCode, type SourceLangCode } from './source-lang';
...
  async function runLookup(
    e: SelectionEvent,
    providerOverride?: Provider,
    forceLiteral?: boolean,
    sourceLangOverride?: SourceLangCode | 'auto',
  ): Promise<void> {
    ...
    const req: LookupRequest = {
      word: e.text,
      context: e.sentence,
      url: e.url,
      title: e.title,
      target: settings.targetLang,
      outputFormat: settings.outputFormat,
      promptEnvelope: settings.promptEnvelope,
    };
    if (providerOverride) req.provider = providerOverride;
    if (forceLiteral) req.forceLiteral = true;
    // A12: a manual override always wins (including an explicit 'auto' reset); otherwise
    // auto-detect from the page/element lang captured on the selection event.
    const effectiveSourceLang: SourceLangCode | undefined =
      sourceLangOverride !== undefined
        ? sourceLangOverride === 'auto'
          ? undefined
          : sourceLangOverride
        : detectSourceLangCode(e.pageLang);
    if (effectiveSourceLang !== undefined) req.sourceLang = effectiveSourceLang;
    if (sourceLangOverride !== undefined) req.sourceLangOverride = true;
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      const showPicker = settings.configuredProviders.length >= 2;
      const isIdiom = result.definedAs?.isIdiom === true;
      const ctx: ResultRenderContext = {
        sentence: e.sentence,
        url: e.url,
        title: e.title,
        // A12: always offered, regardless of provider count/idiom-ness (unlike the picker/
        // force-literal, which only appear conditionally) — the card always shows the row.
        onOverrideSourceLang: (code: SourceLangCode | 'auto') => {
          void runLookup(e, providerOverride, forceLiteral, code).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        },
        ...(effectiveSourceLang !== undefined ? { sourceLang: effectiveSourceLang } : {}),
        ...(showPicker ? { providers: settings.configuredProviders, onSwitchProvider: (p: Provider) => {
          void runLookup(e, p, forceLiteral, sourceLangOverride).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        } } : {}),
        ...(isIdiom ? { onForceLiteral: () => {
          void runLookup(e, providerOverride, true, sourceLangOverride).catch((err) =>
            deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
          );
        } } : {}),
      };
      if (!controller.signal.aborted) deps.renderer.renderResult(result, ctx);
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }
```

**Behavior-preserving note on `onSwitchProvider`/`onForceLiteral`:** today these two callbacks call
`runLookup(e, p)` / `runLookup(e, undefined, true)` respectively — each one implicitly _drops_ the
other override when it fires (switching provider forgets a prior force-literal choice, and vice
versa; this is the existing, already-shipped behavior, unchanged by this card). This card's own
override (`onOverrideSourceLang`) follows that same established convention: it does not thread the
current `providerOverride`/`forceLiteral` through either — a fresh source-language pick is its own
independent one-shot, exactly like the other two. The three callbacks above thread `sourceLangOverride`
through each other only so a provider-switch or a force-literal re-run does not silently discard an
already-chosen manual source language; they intentionally do **not** thread `providerOverride`/
`forceLiteral` back through `onOverrideSourceLang`, matching today's precedent exactly.

### 5.10 `packages/app/src/ports.ts`

`ResultRenderContext` gains two fields, placed after `onForceLiteral`:

```ts
  /**
   * A12: the effective source-language code (bare BCP-47 subtag, e.g. 'fr') used for this
   * result — from auto-detection or a manual override. Absent means "could not be determined"
   * (the auto-phrase fallback was used). Always present on the ctx object when set (unlike
   * `providers`, which is conditional on >=2 configured); the card's Source row shows
   * "Auto-detect" when this is absent.
   */
  sourceLang?: string;
  /**
   * A12: re-run the SAME selection once with a manually picked source language (or 'auto' to
   * reset detection). Always present — unlike onSwitchProvider/onForceLiteral, this control is
   * offered unconditionally on every result.
   */
  onOverrideSourceLang?: (code: string) => void;
```

### 5.11 `packages/app/src/ui/lookup-card.ts`

`CardState`'s `result` variant gains one field, after `saved`/`status`/`nudge`:

```ts
      /** A12: the effective source-language code for this result (bare code, e.g. 'fr'); absent
       * means auto-detect found nothing and no override was chosen — the row shows "Auto-detect". */
      sourceLang?: string;
```

New UI-only display table + row renderer (placed near `PROVIDER_LABELS`, mirroring its exact shape):

```ts
import type { LookupError, Provider, SavedWordStatus, SourceLangCode } from '../index';
import { SOURCE_LANG_CODES } from '../index';
...
/** A12: display names for the fixed source-language picker. UI-only — the wire/prompt only ever
 * carries the bare code (see domain/source-lang.ts's doc comment for why). Keyed by
 * SourceLangCode so a missing entry is a compile error. */
export const SOURCE_LANG_LABELS: Record<SourceLangCode, string> = {
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  vi: 'Vietnamese',
  ar: 'Arabic',
  hi: 'Hindi',
  pl: 'Polish',
  tr: 'Turkish',
  sv: 'Swedish',
  el: 'Greek',
  th: 'Thai',
  id: 'Indonesian',
  en: 'English',
};
```

`renderCardState`'s result branch (240-288) gains one row, after the idiom row and before `body`:

```ts
const nodes: Node[] = [h, renderSaveRow(state)];
if (state.nudge === true) nodes.push(renderNudgeRow(state));
const definedAsRow = state.definedAs ? renderDefinedAsRow(state.definedAs) : null;
if (definedAsRow) nodes.push(definedAsRow);
nodes.push(renderSourceLangRow(state)); // A12: always shown for a result
nodes.push(body);
```

New function, placed after `renderDefinedAsRow`:

```ts
/**
 * A12: the "Source: <language> / Change" row — always rendered for a result. Structurally
 * identical to renderMetaRow's provider-switch button + listbox (lines 452-500): a disclosure
 * button toggles a role="listbox" menu of Auto-detect + every SOURCE_LANG_CODES entry, current
 * selection disabled, others dispatch a composed override-source-lang event.
 */
function renderSourceLangRow(state: { sourceLang?: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'src-lang-row';
  const current = state.sourceLang as SourceLangCode | undefined;

  const label = document.createElement('span');
  label.className = 'src-lang-row__label';
  label.textContent = `Source: ${current ? (SOURCE_LANG_LABELS[current] ?? current) : 'Auto-detect'}`;
  row.append(label);

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'src-lang-row__change';
  changeBtn.setAttribute('aria-haspopup', 'listbox');
  changeBtn.setAttribute('aria-expanded', 'false');
  changeBtn.setAttribute('aria-label', 'Change source language');
  changeBtn.textContent = 'Change';

  const menu = document.createElement('span');
  menu.className = 'src-lang-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const options: { code: string; label: string }[] = [
    { code: 'auto', label: 'Auto-detect' },
    ...SOURCE_LANG_CODES.map((code) => ({ code, label: SOURCE_LANG_LABELS[code] })),
  ];
  for (const opt of options) {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.setAttribute('role', 'option');
    optBtn.dataset['code'] = opt.code;
    optBtn.textContent = opt.label;
    const isCurrent = opt.code === (current ?? 'auto');
    optBtn.setAttribute('aria-selected', String(isCurrent));
    if (isCurrent) {
      optBtn.disabled = true;
    } else {
      optBtn.addEventListener('click', () => {
        menu.hidden = true;
        changeBtn.setAttribute('aria-expanded', 'false');
        optBtn.dispatchEvent(
          new CustomEvent('override-source-lang', {
            detail: { code: opt.code },
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
    menu.append(optBtn);
  }

  changeBtn.addEventListener('click', () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    changeBtn.setAttribute('aria-expanded', String(willOpen));
  });

  row.append(changeBtn, menu);
  return row;
}
```

CSS additions. In the shadow `CSS` template string (near the other `::slotted(...)` rules, right
after `.defined-as`'s rule at line 137):

```css
::slotted(.src-lang-row) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 2px 0 8px;
  font-size: var(--adp-text-2xs);
  color: var(--ad-ink-faint);
}
```

In `CARD_DOC_CSS` (document-scoped descendant rules, appended after the `.defined-as__literal-btn`
block, mirroring `.prov-switch`/`.prov-menu` verbatim):

```css
lookup-card .src-lang-row__change {
  border: 1px solid var(--ad-line);
  background: transparent;
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 2px 10px;
  font: inherit;
  font-size: var(--adp-text-2xs);
  cursor: pointer;
}
lookup-card .src-lang-row__change:hover {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
lookup-card .src-lang-row__change:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
lookup-card .src-lang-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  width: 100%;
  margin-top: 2px;
}
lookup-card .src-lang-menu[hidden] {
  display: none;
}
lookup-card .src-lang-menu [role='option'] {
  border: 1px solid var(--ad-line);
  background: var(--ad-surface);
  color: var(--ad-ink-soft);
  border-radius: var(--adp-radius-control);
  padding: 2px 10px;
  font: inherit;
  font-size: var(--adp-text-2xs);
  cursor: pointer;
}
lookup-card .src-lang-menu [role='option']:hover:not([disabled]) {
  background: var(--ad-surface-raised);
  color: var(--ad-ink);
}
lookup-card .src-lang-menu [role='option']:focus-visible {
  outline: 2px solid var(--ad-accent);
  outline-offset: 2px;
}
lookup-card .src-lang-menu [role='option'][disabled] {
  opacity: 0.55;
  cursor: default;
}
```

### 5.12 `packages/app/src/app/inline-bottom-sheet-renderer.ts`

`ensureCard()` gains one more listener (after the existing `force-literal` listener):

```ts
// One-shot source-language override (A12): the card fires `override-source-lang` when the
// reader picks a language (or Auto-detect); delegate to the handler the workflow installed.
card.addEventListener('override-source-lang', (e) =>
  this.onSourceLangOverride?.((e as CustomEvent<{ code: string }>).detail.code),
);
```

New private field alongside `onSwitch`/`onForceLiteral`:

```ts
  // A12: same pattern as onSwitch/onForceLiteral, for the card's one `override-source-lang` listener.
  private onSourceLangOverride: ((code: string) => void) | undefined;
```

`renderResult` (88-107) gains the wiring + the forwarded field:

```ts
  renderResult(r: LookupResult, ctx?: ResultRenderContext): void {
    this.onSwitch = ctx?.onSwitchProvider;
    this.onForceLiteral = ctx?.onForceLiteral;
    this.onSourceLangOverride = ctx?.onOverrideSourceLang;
    this.setState({
      kind: 'result',
      safeHtml: this.sanitize(r.markdown),
      word: r.word,
      target: r.target,
      ...(r.provider !== undefined ? { provider: r.provider } : {}),
      ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
      ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
      ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
      ...(ctx?.sourceLang !== undefined ? { sourceLang: ctx.sourceLang } : {}),
      saved: ctx?.saved === true,
      nudge: r.nudge === true,
    });
  }
```

`setSaved`/`setStatus`/`dismissNudge` all spread `...this.lastState`/`...rest` already — `sourceLang`
rides through those re-renders automatically, no change needed to any of them.

### 5.13 `packages/app/src/index.ts`

One new barrel line, grouped with the other prompt-related domain modules:

```ts
export * from './domain/types';
export * from './ports';
export * from './domain/default-template';
export * from './domain/prompt-template';
export * from './domain/source-lang';
export * from './domain/legacy-templates';
```

## 6. Testing strategy

1. **Unit — new `packages/app/test/source-lang.test.ts`**: `primarySubtag` normalizes case and strips
   regional suffixes (`"FR-ca"` → `"fr"`); `detectSourceLangCode` recognizes every one of the 20
   codes (parametrized over `SOURCE_LANG_CODES`), returns `undefined` for `undefined`/`''`/an
   unrecognized tag (`"xx"`), and recognizes `"en-US"` → `'en'`.
2. **Unit — `packages/app/test/default-template.test.ts`**: `PROMPT_ENVELOPE` contains
   `{source_lang}` and does NOT contain the literal substring `"of English"`; a new
   `AUTO_SOURCE_LANG_PHRASE` describes non-empty text that does not read as an instruction to assume
   English (`.not.toContain("assume English")` would be wrong — it explicitly says NOT to assume
   English; assert instead that it contains `'infer'` and does not equal `'English'`).
3. **Unit — `packages/app/test/prompt-template.test.ts`**: replace the existing "defaults
   `{source_lang}` to English" test with one asserting the `AUTO_SOURCE_LANG_PHRASE` fallback;
   add a `buildPrompt`-level test that a supplied `source_lang` (e.g. `'fr'`) reaches the assembled
   prompt's persona line via the real `PROMPT_ENVELOPE` end-to-end.
4. **Unit — `packages/app/test/wire-schema.test.ts`**: a `lookup` message accepts `req.sourceLang`
   and `req.sourceLangOverride`, both optional (omitted, and present).
5. **Unit — `packages/app/test/app/router.test.ts`**: `req.sourceLangOverride: true` skips the cache
   read (mirrors the existing `provider`/`forceLiteral` skip-cache tests at lines 95-122 exactly);
   an ordinary `req.sourceLang` set WITHOUT `sourceLangOverride` still hits the cache normally
   (documents the accepted §2.7 limitation).
6. **Unit — `packages/app/test/app/dom-selection-source.test.ts`**: `defaultReader` captures
   `document.documentElement.lang` as `pageLang` when set; a `lang` attribute on an ancestor element
   of the selection wins over `document.documentElement.lang`; no `lang` anywhere → `pageLang` is
   `undefined` (key absent from the returned object, `exactOptionalPropertyTypes`-safe).
7. **Unit — `packages/app/test/workflow.test.ts`**: a recognized `e.pageLang` (e.g. `'fr'`) yields
   `req.sourceLang === 'fr'` with `req.sourceLangOverride` absent; an unrecognized/absent `pageLang`
   yields `req.sourceLang` absent; `ctx.sourceLang` always mirrors the effective value;
   `ctx.onOverrideSourceLang` re-runs the same selection with the picked code, sets
   `req.sourceLangOverride: true`, and bypasses the cooldown gate (mirrors the existing
   `onSwitchProvider`/`onForceLiteral` cooldown-bypass tests); overriding with `'auto'` clears
   `req.sourceLang` (key absent) while still setting `sourceLangOverride: true`.
8. **Unit — `packages/app/test/ui/lookup-card.test.ts`**: `renderCardState` on a result with
   `sourceLang: 'fr'` shows `"Source: French"`; a result with `sourceLang` absent shows
   `"Source: Auto-detect"`; clicking a non-current listbox option dispatches a composed
   `override-source-lang` event with the right `code` in its detail; the currently-selected option is
   `disabled` and cannot be clicked.
9. **Unit — `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`**: `renderResult` forwards
   `ctx.sourceLang` into `CardState`; clicking the card's Change → an option invokes
   `ctx.onOverrideSourceLang` with the chosen code (mirrors the existing `switch-provider`/
   `force-literal` wiring tests).
10. **e2e — new `packages/extension-chrome/e2e/a12-non-english-source.spec.ts`**:
    - A fixture page stamped `document.documentElement.lang = 'fr'` (via `page.evaluate` after
      `gotoFixture`, no `helpers.ts` change needed) → selecting a word sends a prompt to the mocked
      Gemini endpoint containing `learners of fr` (proving the persona line resolved
      `{source_lang}`), and the card shows `"Source: French"`.
    - No `lang` attribute anywhere on the page → the sent prompt contains the
      `AUTO_SOURCE_LANG_PHRASE` text and does NOT contain `"learners of English"`; the card shows
      `"Source: Auto-detect"`.
    - Clicking `Change` → `"Japanese"` fires a **second** mocked Gemini call (proving the cache was
      bypassed) whose prompt contains `learners of ja`; the card updates to `"Source: Japanese"`.
    - An ancestor element with its own `lang="ja"` wrapping the selection, on a page whose `<html>`
      is `lang="en"`, resolves to the ancestor's language (`"Source: Japanese"`), proving the
      nearest-ancestor rule beats the page-level default.

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries: the suites run (unit: app package; e2e: the new
`a12-non-english-source.spec.ts` plus the existing `default-template-context.spec.ts` and
`advanced-prompt.spec.ts` as regression guards for the shared `prompt-template`/`http-lookup-client`
surface), test counts, and gates passed (lint, format check, typecheck, `bun run test`, the Chrome
build with `GEMINI_API_KEY=` cleared). No `pr-assets/*` branch is created for this card.

## 8. Risk / rollback

- **Risk: low-moderate.** The riskiest single line is `default-template.ts:14`'s prose→placeholder
  swap — every existing lookup's prompt persona line changes text for the first time since A8/B2 were
  added. Mitigated by: (a) the swap is a single, mechanical placeholder substitution with no logic
  change; (b) `prompt-template.test.ts`'s and `default-template-context.spec.ts`'s existing assertions
  (§6.3, and the e2e's own "financial institution" outcome check) act as regression guards that the
  overall lookup pipeline still produces a correct, sense-disambiguated answer; (c) for the common
  case (a page correctly marked `lang="en"` or one falling through to the auto-phrase on genuinely
  English text), the model's own inference from the sentence content converges on the same answer
  either way — the wording change affects _instruction phrasing_, not the disambiguation mechanism
  (`{context}` still carries the full sentence, unchanged).
- **Risk: cache staleness for a manual override**, addressed directly by §2.7/§5.4's skip-cache guard
  and its dedicated router test (§6.5).
- **No data migration.** No persisted shape changes — `SavedWordEntry`, `HistoryEntry`,
  `LookupResult`, `PublicSettings` are all untouched; the two new `LookupRequest` fields are
  in-flight/optional only (CONTRACTS §3's wire-evolution precedent).
- **Rollback:** revert the single PR. `PROMPT_ENVELOPE`'s persona line reverts to literal "English",
  `prompt-template.ts`'s fallback reverts to `'English'`, and the new card row simply disappears
  (its presence was purely additive UI, gated on an optional `CardState` field with no other reader).
  No stored data becomes invalid; `legacy-templates.ts`'s migration-detection table was never touched,
  so no user's stored envelope is reclassified by the rollback either.

## 9. Concurrency

Files this card modifies that other unshipped cards in this batch also modify:

- `packages/app/src/domain/prompt-template.ts` / `default-template.ts` — CONTRACTS §5 lists
  "prompt-builder (A12 B12)"; B12 (LLM auto-grouping) uses a wholly separate prompt (its own
  clustering request), so a collision is unlikely to be semantic, but both cards touch these files —
  serialize or diff-review carefully if run concurrently.
- `packages/app/src/wire.ts` / `packages/app/src/app/router.ts` — not on CONTRACTS §5's literal
  "any card adding messages" list (this card adds no new message type), but it DOES modify the
  existing `lookup` arm's schema and the `handleLookup` cache-skip guard — any other card that also
  touches `LookupRequestSchema` or that same guard block (none currently known in this batch, but
  future cards adding request fields would) should diff-review this card's hunk before merging.
  Recommend treating these two files as soft-serialized alongside the "wire+router" entry in
  CONTRACTS §5 even though this card is not "adding a message."
- `packages/app/src/app/dom-selection-source.ts` — **not** on CONTRACTS §5's "content-script/trigger"
  list (which names A5 A6 A13 A14 A15 B3 B4), but this card also touches it (`defaultReader`'s
  `pageLang` capture). As of this reading, the file already carries A15's `SELECTION_FIRED_MARK`
  instrumentation (`performance.mark` in `onSelection`'s handler) — evidence that A15's own work has
  already landed in this shared worktree ahead of this card. This card's addition is a separate,
  independent piece of `defaultReader` (a new local `readPageLang` helper + one appended object key)
  and does not touch the `onSelection`/mark code A15 added — but re-verify line numbers/hunks against
  the file's actual state at implementation time, not this spec's citations, since the file is being
  concurrently edited across this batch. Add this file to the orchestrator's serialization list
  alongside A5/A6/A13/A14/A15/B3/B4.
- `packages/app/src/ports.ts` — any other unshipped card that also extends `ResultRenderContext`
  (none currently known) should diff-review against this card's two new optional fields.
- `packages/app/src/ui/lookup-card.ts` — CONTRACTS §5's "lookup-card UI" hot-file group (A1 A2 A3 A5
  A7 A10) does not list A12, but this card also touches `CardState`/`renderCardState`/`CARD_DOC_CSS`
  in this file — add A12 to that hot-file group for the orchestrator's serialization plan.
- `packages/app/src/index.ts` — a one-line barrel addition; any other card adding a new domain module
  in the same batch will also touch this file (low collision risk, trivial to resolve).
