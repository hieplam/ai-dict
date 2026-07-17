# C11 — Install-aware landing page

Roadmap card: `docs/ROADMAP.md` §4 C11 (Impact 3 · Effort S · Score 3.0, added 2026-07-16).
Depends on: — (richer once C1/C2 ship, but this card stands alone; neither is a hard
dependency — `docs/ROADMAP.md` §4 C11 "Depends on: — (richer with C1/C2 shipped)").

## 1. Problem (grounded in code)

`docs/index.html`'s `#start` section (`docs/index.html:1477-1529`) is a static 3-step checklist —
"Add it to Chrome" → "Get your free Gemini key" → "Paste, save, read" — and it renders identically
for every visitor: someone who has never heard of the extension, someone who installed it five
minutes ago and hasn't pasted a key yet, and someone who finished setup weeks ago and is just
back to read the docs. The hero's primary call-to-action, `docs/index.html:996-1002` (`<a
class="btn btn-primary" href="https://chromewebstore.google.com/...
" data-i18n="hero-cta-primary">Add to Chrome, it's free</a>`), makes the same "go install me" pitch
to all three.

The page is not inert to an installed extension, though — `manifest.json`'s two content scripts
both match `<all_urls>` (`packages/extension-chrome/src/manifest.json:30-41`:
`content-elements.js` in `world: "MAIN"` at 30-36, `content.js` in the default isolated world at
37-41), so `content.ts` — the exact composition root that runs on every reading page — is already
executing on `docs/index.html` today, unconditionally, the moment the page loads
(`packages/extension-chrome/src/content.ts:1-38`). It never looks at where it's running. That is
the gap this card closes: give that already-running script one small, deliberately narrow job on
this one page — say "I'm here, and here's whether the reader still needs a key" — and let the
static page adapt around it.

**Confirmed: `docs/index.html`'s two toggle scripts are the site's only existing JS**, and neither
one is a build step — the file is served byte-for-byte from `/docs` on `master`
(`docs/ROADMAP.md` §4 Category C intro). The theme toggle
(`docs/index.html:1630`/`1645`, `document.documentElement.setAttribute('data-ad-theme', t)`) and
the language toggle (`docs/index.html:1819-1862`, an IIFE keyed off `document.documentElement.lang`
and `data-i18n`/`data-i18n-attrs` node attributes) both already read/write attributes on
`document.documentElement` (`<html>`) directly — this card's marker follows that exact, established
pattern rather than inventing a new one.

## 2. Design questions (every "Lead decides" item on the card, pinned)

### 2.1 What exactly does the marker carry, and how many attributes is that?

The roadmap card's scope fence (`docs/ROADMAP.md` §4 C11) says, verbatim: _"The marker carries
install state and version only — never settings, never key state beyond a boolean 'setup
finished', never any user data."_ `CONTRACTS.md` §4 paraphrases the same pin as "install boolean +
version ONLY." Read together — the fence is the authoritative, fuller text; `CONTRACTS.md`'s line
is a compressed summary of it, not a narrower re-pin — the fence explicitly carves out room for
exactly one more field: a boolean "setup finished" signal, on top of install-state and version.
Without it, the card's own stated Payoff ("Visitors always see exactly one next action") cannot be
met: the checklist would forever say "next: add your key" even to a visitor who finished setup
weeks ago, which is literally one of the two dead-ends the card's **Today** section names ("a
fully-configured user who needs nothing").

**Pinned: three attributes on `document.documentElement` (`<html>`), stamped only on the landing
origin (§2.2):**

| Attribute                | Type                                                                      | Source                                                           |
| ------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `data-ad-dict-installed` | `"true"` (only ever this value; the attribute is simply absent otherwise) | presence of the content script running here at all               |
| `data-ad-dict-version`   | semver string, e.g. `"1.8.0"`                                             | `chrome.runtime.getManifest().version`                           |
| `data-ad-dict-ready`     | `"true"` \| `"false"`                                                     | `PublicSettings.hasKey` (`packages/app/src/domain/types.ts:172`) |

**Why `hasKey` and nothing richer.** `hasKey` is already the wire-safe, pre-computed boolean the
rest of the codebase treats as the canonical "does the reader have a usable key" signal — it is
derived by `hasKeyFor` (`packages/app/src/domain/types.ts:183-193`, "does the _selected_ provider
have a key?") inside `ChromeStorageStore.get()` (`packages/extension-chrome/src/adapters/
chrome-storage-store.ts:54`: `hasKey: hasKeyFor(s ?? {}) || this.envGeminiKey`) and shipped as a
field on `PublicSettings`, the exact shape `PublicSettingsSchema` already enforces as `z.strictObject`
over the wire (S1: rejects `apiKey`/`openaiApiKey`/`anthropicApiKey` if anyone ever tried to add
them). Nothing new is computed for this card — `hasKey` already exists, is already S1-safe, and is
already what `content.ts` receives from every `settings.get()` call. **Rejected: a richer payload**
(e.g. `configuredProviders`, `provider`, `targetLang`) — the fence forbids "any user data" beyond
the one boolean, and none of those fields are needed to answer "is there one next action, and what
is it?". **Rejected: omitting the ready signal** (marker = install + version only, matching
`CONTRACTS.md`'s literal wording) — this satisfies the letter of the compressed pin but defeats the
card's own stated Payoff for the "fully-configured visitor" case; the fuller roadmap fence text
explicitly authorizes the boolean this design uses, so the fence, not the paraphrase, governs.

### 2.2 How is "the landing origin" detected, without a manifest change?

`host_permissions: ["<all_urls>"]` (`manifest.json:14`) and both content scripts' `"matches":
["<all_urls>"]` mean `content.ts` already runs on `docs/index.html`'s live URL,
`https://hieplam.github.io/ai-dict/` — no manifest edit is needed to reach the page. The gating the
fence requires ("stamped ONLY on the landing origin") is therefore a **runtime check inside
`content.ts`**, not a narrower content-script match pattern (narrowing `matches` would need a
second content-script block and buys nothing — the check has to exist in code either way to decide
whether to touch the DOM).

**Pinned:**

```ts
export const LANDING_ORIGIN = 'https://hieplam.github.io';
export const LANDING_PATH_PREFIX = '/ai-dict/';

export function isLandingPage(loc: Pick<Location, 'origin' | 'pathname'>): boolean {
  return loc.origin === LANDING_ORIGIN && loc.pathname.startsWith(LANDING_PATH_PREFIX);
}
```

Called as `isLandingPage(location)` — the content script's ambient `window.location`, matching
exactly what a browser navigates to for the real page (confirmed live URL,
`docs/ROADMAP.md` §4 Category C intro: "<https://hieplam.github.io/ai-dict/>"). **Rejected: a
second, narrower `content_scripts` match block** (e.g. `"matches": ["https://hieplam.github.io/
ai-dict/*"]`) — this is a real option architecturally, but it is a second injected script for one
page, doubling the surface CSP/manifest reviewers have to reason about, for a check that still has
to exist in code (a narrower match doesn't remove the need to gate — a MAIN-world script or a
future path segment could still slip in) and buys nothing here since C11 needs no capability the
existing `<all_urls>` script lacks. **Rejected: matching on `document.title` or page content** —
origin+path is the only signal that can't be spoofed by page content and needs no new permission.

### 2.3 Where does the stamping code live, and is it unit-testable?

**Pinned: a new adapter, `packages/extension-chrome/src/adapters/landing-marker.ts`** — three pure
functions (the origin check above, plus two DOM-writing helpers), co-located with a `*.test.ts`
file matching every other adapter in this directory
(`packages/extension-chrome/src/adapters/*.test.ts`, REPO-FACTS §1). `content.ts` imports and calls
them; `content.ts` itself gets no dedicated unit test, matching this repo's own precedent for every
composition root (`sw.ts`, `options.ts`, `content.ts` are all `vitest.config.ts`-excluded from
coverage, `packages/extension-chrome/vitest.config.ts:23-28`, and C2's own plan states explicitly:
"No dedicated unit test exists for `options.ts` in this repo — it is a composition root, covered by
e2e only", `docs/superpowers/plans/2026-07-16-c2-verified-activation.md` Task 2). **Rejected:
writing the DOM-touching logic inline in `content.ts`** — it would still work, but it would sit
outside `src/adapters/**`'s 80%-threshold coverage inclusion (`packages/extension-chrome/
vitest.config.ts:16-17`) and be untestable without a full content-script harness; three one-line
pure functions cost nothing to extract and buy a red→green unit test.

```ts
export function stampInstallMarker(root: HTMLElement, version: string): void {
  root.setAttribute('data-ad-dict-installed', 'true');
  root.setAttribute('data-ad-dict-version', version);
}

export function stampReadyMarker(root: HTMLElement, ready: boolean): void {
  root.setAttribute('data-ad-dict-ready', String(ready));
}
```

### 2.4 Does the ready marker ever update after the tab is already open?

**Pinned: no — it is stamped once, at content-script load, from whatever `PublicSettings.hasKey`
`settings.get()` returns at that moment.** This is a deliberate, documented staleness, not an
oversight, and it matches an existing precedent in the same file: `content.ts`'s own comment at
lines 24-27 notes the reader's theme is "re-applied... on each Define click" and "once at startup"
— an already-open tab does not live-update its theme either when settings change in another tab.
If a reader activates their key in one tab while a landing-page tab from before activation stays
open in the background, that background tab's `data-ad-dict-ready` stays `"false"` until the page
is reloaded. **Rejected: a `chrome.storage.onChanged` subscription that re-stamps on every
settings write** — technically simple to add, but it is new, untested-by-precedent behavior this
card does not need: the funnel this card serves is "a visitor lands on the page," not "a visitor
keeps an already-open landing tab pinned through activation." Adding live-refresh here would be
scope creep past the card's stated Missing/Payoff, and the existing theme precedent already
established that this class of staleness is an accepted trade-off in this codebase.

### 2.5 The checklist/CTA adaptation script — what exactly changes, and how

**Pinned: exactly two DOM targets, both already-existing structural elements, both changed only
after a marker attribute appears (`document.documentElement`'s `MutationObserver`, filtered to
`data-ad-dict-installed`, `data-ad-dict-ready`, and `lang`):**

1. **The hero primary CTA** (`docs/index.html:996-1002`) — the only "Add to Chrome" button on the
   page (confirmed: `grep -c "Add to Chrome" docs/index.html` → 1 occurrence, in the hero). Gains
   `id="hero-cta"`. Three states:
   - **Not installed (no marker):** unchanged — original href, "Add to Chrome, it's free",
     `data-i18n="hero-cta-primary"` still governs its language via the page's existing i18n IIFE.
   - **Installed, not ready:** text → "Open setup" (the card's own literal phrasing), `href="#start"`
     — jumps to the checklist, which by then also shows the adapted status line (below). **Pinned:
     this cannot deep-link into the extension's options page.** A webpage has no way to open a
     `chrome-extension://` URL or navigate to `chrome://extensions/` — Chrome blocks both from web
     content for security, and the only alternative (`externally_connectable` in the manifest) is a
     new manifest surface, forbidden by the Category C standing wall ("no new manifest
     permissions", `docs/ROADMAP.md` §4 Category C intro) and by this card's own fence ("No new
     permissions"). An in-page anchor to the checklist that already explains "click the toolbar icon
     → paste your key → Save & activate" is the closest feasible action, and it is what "Open setup"
     resolves to.
   - **Installed and ready:** text → "You're all set ✓", `href` **removed**, `aria-disabled="true"`,
     `tabindex="-1"` — an inert confirmation, not a dead link, matching "exactly one next action":
     when there is none, the button stops offering one instead of offering a stale one.
2. **A new status line inside `#start`**, `<p class="start-status" id="start-status" hidden></p>`,
   inserted immediately after `#start`'s `<h2>` (`docs/index.html:1479`, before the existing `<ol
class="steps">`). Ships `hidden` — **the fence's "must render perfectly without it" is satisfied
   by construction**: an unvisited/uninstalled reader never sees this element at all. Two states,
   set only when a marker is present:
   - Installed, not ready: **"Install ✓ — next: add your key."** — the card's own literal example
     text (`docs/ROADMAP.md` §4 C11 "Missing").
   - Installed and ready: **"All set ✓ — you're ready to read."**

**Copy ownership and the i18n interaction (why `data-i18n` is removed from `#hero-cta`, not
reused).** `docs/index.html`'s existing i18n IIFE (`docs/index.html:1819-1862`) re-applies every
`[data-i18n]` node's text on every language-toggle click, including `#hero-cta` (it keeps
`data-i18n="hero-cta-primary"` until this card's own script intervenes). Leaving that attribute in
place while ALSO writing the element's text from a second, independent script would race: clicking
the language toggle would flip `#hero-cta` back to the default "Add to Chrome" copy on every click,
because the generic i18n loop has no notion of install state. **Pinned:** the first time
`applyInstallState()` runs in an installed state, it calls `cta.removeAttribute('data-i18n')` —
from that point on, this card's own script fully owns `#hero-cta`'s text, keyed off
`document.documentElement.lang` (which the toggle keeps writing — `docs/index.html:1826`), not off
the generic `EN`/`VI` maps. **Rejected: adding new keys to the global `VI` object and letting the
generic loop own the swap** — technically possible, but it would need the CTA's `data-i18n` key to
change mid-session depending on install state, which the existing IIFE's per-element `EN.set(el,
el.textContent)` first-capture cache (`docs/index.html:1830`) does not support without a second,
parallel change to that shared script; it would also add a shared-file collision with C3's own
planned VI-dict insertion point (§8 below). Keeping this card's install-state copy in a small local
`en`/`vi` object, entirely inside its own new `<script>` block, needs zero edits to the existing
i18n machinery and zero shared insertion points with any other card.

- `#start-status` never carries `data-i18n` at all (it does not exist in the default DOM state), so
  it has no such race to begin with — this card's script is its only writer from the start.

**Re-sync on language toggle.** The `MutationObserver` filters on `attributeFilter: [...,'lang']` —
the language toggle's `apply(lang)` (`docs/index.html:1826`) sets `document.documentElement.lang =
lang` as its first line, so every language switch re-triggers `applyInstallState()`, which
re-reads `document.documentElement.lang` and re-writes both targets in the newly-selected language.
This is why the CTA/status copy is pinned as data, not DOM nodes cloned per language: one function,
re-run on either signal (a marker attribute changing, or the language changing), always converges
to the correct text.

### 2.6 C7 badge consistency (grounding note, no coupling)

C7 (`docs/ROADMAP.md` §4 C11, not yet shipped) will show a toolbar badge "while no usable key
exists" and clear it "the moment activation succeeds" (§4 C7 "Missing"/"Scope fence"). C11's
`ready` boolean and C7's badge condition are defined from the exact same source —
`PublicSettings.hasKey` — so once both ship, the toolbar badge and the landing page will already
agree without any code coupling between the two cards; this card does not read, write, or depend on
anything C7 introduces (C7 doesn't exist in code yet).

## 3. The change

### 3.1 `packages/extension-chrome/src/adapters/landing-marker.ts` (new)

```ts
/** C11: the landing page (docs/index.html, served at https://hieplam.github.io/ai-dict/) is a
 * normal <all_urls> page content.ts already runs on. These three pure helpers are the entire
 * marker surface: detect that origin, and stamp/read three non-sensitive attributes on <html> so
 * the static page can adapt its checklist/CTA. See design spec §2 for the full rationale. */

export const LANDING_ORIGIN = 'https://hieplam.github.io';
export const LANDING_PATH_PREFIX = '/ai-dict/';

/** True only for the real landing origin+path prefix — never spoofable by page content. */
export function isLandingPage(loc: Pick<Location, 'origin' | 'pathname'>): boolean {
  return loc.origin === LANDING_ORIGIN && loc.pathname.startsWith(LANDING_PATH_PREFIX);
}

/** Stamp "the extension is here" + its version. Called unconditionally once isLandingPage() is
 * true — never carries settings, a key, or any other user data (S1 + the card's own fence). */
export function stampInstallMarker(root: HTMLElement, version: string): void {
  root.setAttribute('data-ad-dict-installed', 'true');
  root.setAttribute('data-ad-dict-version', version);
}

/** Stamp the one additional boolean the fence allows: "has the reader finished setup?" Derived
 * from PublicSettings.hasKey (packages/app/src/domain/types.ts:172) — never the key itself. */
export function stampReadyMarker(root: HTMLElement, ready: boolean): void {
  root.setAttribute('data-ad-dict-ready', String(ready));
}
```

### 3.2 `packages/extension-chrome/src/content.ts`

Replace the single seed line (currently `content.ts:38`):

```ts
void themedSettings.get().catch(() => undefined); // seed before the first lookup; light until known
```

with (one wire call, reused for both the existing seed and the new landing-marker read):

```ts
const initialSettings = themedSettings.get();
void initialSettings.catch(() => undefined); // seed before the first lookup; light until known

// C11: install-aware landing page — stamp a minimal, non-sensitive marker (install + version +
// setup-finished) on <html> so docs/index.html's checklist/CTA can adapt. Landing origin only
// (see design spec §2.2); only PublicSettings.hasKey (a boolean, S1-safe — never the key itself)
// crosses into the marker. See design spec §2.4 for why this does not live-update later.
if (isLandingPage(location)) {
  stampInstallMarker(document.documentElement, chrome.runtime.getManifest().version);
  void initialSettings
    .then((s) => stampReadyMarker(document.documentElement, s.hasKey))
    .catch(() => undefined);
}
```

And add the import alongside the existing adapter imports (`content.ts:14-16`):

```ts
import { isLandingPage, stampInstallMarker, stampReadyMarker } from './adapters/landing-marker';
```

No other line in `content.ts` changes. `chrome.runtime.getManifest()` needs no permission beyond
what is already granted (it is a base `chrome.runtime` call, same trust tier as the
`chrome.runtime.sendMessage` calls already all over this file).

### 3.3 `docs/index.html`

**(a) Hero CTA gains an id** (`docs/index.html:996-1002`):

```html
<a
  class="btn btn-primary"
  id="hero-cta"
  href="https://chromewebstore.google.com/detail/ai-dictionary/ipnmjhndmlkbhnifhmbknjjomdocgkeg"
  data-i18n="hero-cta-primary"
>
  Add to Chrome, it’s free
</a>
```

**(b) A hidden status line inside `#start`**, right after its `<h2>` (`docs/index.html:1478-1479`,
before the existing `<ol class="steps">`):

```html
<section id="start" class="reveal">
  <p class="eyebrow" data-i18n="start-eyebrow">Two minutes, once</p>
  <h2 data-i18n="start-h2">Get started</h2>
  <p class="start-status" id="start-status" hidden></p>
  <ol class="steps"></ol>
</section>
```

**(c) CSS** — two new rules, token-only. `.start-status` inserted after the existing `.steps p`
rule (`docs/index.html:850-854`, right before the `/* FAQ */` comment):

```css
.start-status {
  display: inline-block;
  margin: 4px 0 20px;
  padding: 8px 14px;
  border-radius: 999px;
  font: 600 var(--adp-text-sm) / 1.3 var(--adp-font-sans);
  background: var(--ad-accent-soft);
  color: var(--ad-ink);
  border: 1px solid var(--ad-accent);
}
```

`.btn[aria-disabled='true']` inserted after the existing `.btn-quiet` rule
(`docs/index.html:420-424`, right before `.privacy-line`):

```css
.btn[aria-disabled='true'] {
  opacity: 0.72;
  cursor: default;
  pointer-events: none;
}
```

No transition/animation is added by either rule, so there is nothing to gate behind
`prefers-reduced-motion` — the fence's "honor reduced motion" line is satisfied by not introducing
motion at all.

**(d) The checklist-adaptation script** — a new `<script>` block appended right before `</body>`
(after the existing i18n IIFE's closing `</script>` at `docs/index.html:1863`), written in the same
plain-ES5 style as every other inline script in this file (confirmed: zero `const`/`let`/arrow
functions anywhere in `docs/index.html`'s existing `<script>` blocks — this file has no build/
transpile step, so its own established style is the only style to match):

```html
<!-- ====================== C11: INSTALL-AWARE LANDING ====================== -->
<script>
  // The extension's content script (packages/extension-chrome/src/content.ts, landing-origin
  // gated — see design spec §2.2) stamps three attributes on <html> once it runs here:
  // data-ad-dict-installed="true", data-ad-dict-version="<semver>", and
  // data-ad-dict-ready="true"|"false" (PublicSettings.hasKey only — never the key itself, S1).
  // This script adapts the hero CTA + the #start checklist when those attributes appear. Without
  // the extension (or before it stamps them), nothing here runs and the page is exactly as
  // authored — see design spec §2.5's "must render perfectly without it".
  (function () {
    var COPY = {
      en: {
        ctaInstalled: 'Open setup',
        ctaReady: 'You’re all set ✓',
        statusInstalled: 'Install ✓ — next: add your key.',
        statusReady: 'All set ✓ — you’re ready to read.',
      },
      vi: {
        ctaInstalled: 'Mở phần thiết lập',
        ctaReady: 'Đã kích hoạt ✓',
        statusInstalled: 'Đã cài ✓ — tiếp theo: thêm khoá của bạn.',
        statusReady: 'Đã xong ✓ — bạn đã sẵn sàng đọc.',
      },
    };

    function applyInstallState() {
      var root = document.documentElement;
      var installed = root.getAttribute('data-ad-dict-installed') === 'true';
      if (!installed) return; // not installed (or not yet stamped): page stays exactly as authored
      var ready = root.getAttribute('data-ad-dict-ready') === 'true';
      var lang = root.lang === 'vi' ? 'vi' : 'en';
      var t = COPY[lang];

      var cta = document.getElementById('hero-cta');
      if (cta) {
        cta.removeAttribute('data-i18n'); // this script now owns this element's text/lang sync
        if (ready) {
          cta.textContent = t.ctaReady;
          cta.removeAttribute('href');
          cta.setAttribute('aria-disabled', 'true');
          cta.setAttribute('tabindex', '-1');
        } else {
          cta.textContent = t.ctaInstalled;
          cta.setAttribute('href', '#start');
          cta.removeAttribute('aria-disabled');
          cta.removeAttribute('tabindex');
        }
      }

      var status = document.getElementById('start-status');
      if (status) {
        status.textContent = ready ? t.statusReady : t.statusInstalled;
        status.hidden = false;
      }
    }

    applyInstallState();
    new MutationObserver(applyInstallState).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ad-dict-installed', 'data-ad-dict-ready', 'lang'],
    });
  })();
</script>
```

`data-ad-dict-version` is stamped (§2.1) but not rendered by this card — it exists for forward
compatibility (a future diagnostics/version-mismatch surface), matching the card's own pin of
"install boolean + version" without inventing a UI for it that nothing today asks for.

## 4. Not done, and deliberately so

- **No `chrome.storage.onChanged` re-stamp for already-open tabs** — §2.4.
- **No nav link, no new page section, no new anchor ID** — this card only decorates two existing
  elements; there is no `#c11` section to link to.
- **No edit to the shared `VI` translation object** (`docs/index.html:1705-1817`) — §2.5's copy
  ownership rationale; also keeps this card's diff away from C3's own planned insertion point in
  that same object (§8 Concurrency).
- **No manifest change** — §2.2.
- **No wire message, no `wire.ts`/`router.ts`/`ports.ts` change** — the marker is pure DOM, read
  entirely from data `content.ts` already has (`themedSettings.get()`, already called on every
  page load for theming).

## 5. Scope fence (from the card, held exactly)

- **"The marker carries install state and version only — never settings, never key state beyond a
  boolean 'setup finished', never any user data"** (`docs/ROADMAP.md` §4 C11) — held exactly: three
  attributes total (§2.1), the only key-derived one being `hasKey`, already S1-safe.
- **"stamped ONLY on the landing origin"** — `isLandingPage()` gate (§2.2/§3.2); every other page
  this content script runs on is untouched by this card.
- **"the page must render perfectly without it (no extension = today's static page)"** — every new
  element ships `hidden` or with its original default text/href; the adaptation script's first line
  is `if (!installed) return;` (§3.3(d)).
- **"No new permissions (`<all_urls>` content script already covers it)"** — confirmed: zero
  `manifest.json` diff (§2.2); `chrome.runtime.getManifest()` needs none beyond the base runtime API
  every content script already has.
- **Privacy surface unchanged** (Category C standing wall) — the marker never carries the key,
  provider, target language, or any reading content; it is strictly less data than
  `PublicSettings` itself (which is already the wire-safe subset — this card exposes one further-
  reduced field of it, `hasKey`, plus two facts (`installed`, `version`) that are already
  observable by anyone who inspects the installed extension's own listing).
- **Tokens law** — `.start-status` and `.btn[aria-disabled]` read only `--ad-*`/`--adp-*` values
  (§3.3(c)); no hex/oklch literal introduced.
- **E2e must never fetch the live site** — §6.2.

## 6. Testing strategy

1. **Unit — new `packages/extension-chrome/src/adapters/landing-marker.test.ts`** (vitest,
   happy-dom, matching every sibling in `src/adapters/`):
   - `isLandingPage` returns `true` for `{ origin: 'https://hieplam.github.io', pathname:
'/ai-dict/' }` and for a deeper path under the prefix (`/ai-dict/index.html`).
   - `isLandingPage` returns `false` for a different origin (`https://example.com`), a different
     path prefix (`/other-repo/`), and a non-HTTPS origin
     (`http://hieplam.github.io` — origin strings include the scheme, so this fails the exact-match
     check).
   - `stampInstallMarker` sets both `data-ad-dict-installed="true"` and `data-ad-dict-version` to
     the exact string passed in, on a plain `HTMLElement` (not tied to `document.documentElement`,
     proving the function takes any root).
   - `stampReadyMarker` sets `data-ad-dict-ready` to the string `"true"` when passed `true`, and
     `"false"` when passed `false`.
2. **e2e — new `packages/extension-chrome/e2e/c11-install-aware-landing.spec.ts`.** Never fetches
   the live site: `page.route('https://hieplam.github.io/ai-dict/**', ...)` fulfills a small local
   HTML fixture (hero CTA + lang-switch buttons + `#start`'s `<h2>`/`#start-status` + this card's
   real `<script>` block, byte-for-byte the same source as §3.3(d) plus a minimal stand-in for the
   existing language-toggle click handler) before any navigation — satisfying the same rule C10
   established (`docs/ROADMAP.md` §4 C10 landing-page note) and the exact pattern C3's own e2e spec
   plans to use for the same origin (`docs/superpowers/specs/2026-07-16-c3-guided-first-lookup-
   design.md` §5.2). Scenarios:
   - **Installed, no key:** `seedSettings(page, { apiKey: '', hasKey: false })` on the options page,
     then navigate the same page to the routed landing URL. Assert (via `page.locator('html[data-
ad-dict-installed="true"]').waitFor(...)`) the marker attributes appear —
     `data-ad-dict-version` equal to `packages/extension-chrome/src/manifest.json`'s `version`
     field (read from disk by the spec, not hardcoded, so a future version bump can't silently
     desync the test) and `data-ad-dict-ready="false"` — then assert `#hero-cta`'s text is "Open
     setup" and its `href` is `"#start"`, and `#start-status` is visible with the text "Install ✓ —
     next: add your key."
   - **Installed and ready:** same flow with `seedSettings(page, { apiKey: 'AIza-test', hasKey:
true })`. Assert `data-ad-dict-ready="true"`, `#hero-cta`'s text is "You're all set ✓" with no
     `href` and `aria-disabled="true"`, and `#start-status` reads "All set ✓ — you're ready to
     read."
   - **Language toggle re-syncs the adapted copy:** starting from the installed/not-ready state,
     click the fixture's VI language button (which sets `document.documentElement.lang = 'vi'`,
     matching the real page's own toggle at `docs/index.html:1826`) and assert `#hero-cta`/`#start-
status` switch to the Vietnamese strings pinned in §3.3(d) — proving the `MutationObserver`'s
     `lang` filter fires the re-sync, not just the marker-attribute path.
3. **`docs/index.html` itself — no automated test**, matching this exact precedent already set by
   C3's own design spec for the same file (`docs/superpowers/specs/2026-07-16-c3-guided-first-
lookup-design.md` §5.4: "The page is static content with no build step and no existing test harness
   of its own... Verification for this file is manual"). Manual verification for this card: serve
   `docs/` locally (`python3 -m http.server` from `docs/`), confirm `#start-status` stays hidden and
   the hero CTA reads "Add to Chrome, it's free" with no extension loaded, and confirm the language
   toggle still swaps every other section's copy correctly (regression check — this card's script
   must not throw or otherwise break the existing i18n IIFE when no marker is ever set).
4. **Global constraint reminder (this repo, not new to this card):** the e2e build must run with
   `GEMINI_API_KEY` cleared (`GEMINI_API_KEY= bun run build:chrome`) so `chrome.runtime.getManifest()`
   and the rest of the onboarding-adjacent surface behave deterministically — this card's own
   scenarios don't touch onboarding, but the repo-wide e2e run they live in does, per C10's
   documented flake (`docs/ROADMAP.md` §4 C10).

## 7. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section carries the evidence instead — the suites run, test
counts, e2e scenarios exercised, and gates passed (lint, format check, typecheck, unit, e2e),
matching exactly what §6 above enumerates. No `pr-assets/*` branch is created for this card.

## 8. Concurrency

Per `CONTRACTS.md` §5, `docs/index.html` is a listed hot file shared with **C3** (guided first
lookup) — both cards are still unimplemented at authoring time. The two edits do not overlap at the
line level:

- **C3** (`docs/superpowers/specs/2026-07-16-c3-guided-first-lookup-design.md` §3.1) inserts a new
  `#try` section between the existing `<hr class="rule" />` at `docs/index.html:1531` and `#faq`,
  adds one nav link (`docs/index.html:963` area), and appends 6 keys to the shared `VI` object
  (`docs/index.html:1705-1817`). It adds **no new `<script>` block** to the page.
- **C11** (this card) touches the hero CTA (`docs/index.html:996-1002`), the inside of `#start`
  right after its `<h2>` (`docs/index.html:1478-1479`), two small CSS rules, and appends its own new
  `<script>` block at the very end of `<body>`. It makes **no edit to the shared `VI` object**
  (§2.5) and **no nav edit**.

Despite the non-overlapping regions, both cards still touch the same file, so — per
`docs/ROADMAP.md` §5 ("C3 and C11 also touch `docs/index.html`... coordinate those two edits if
they run concurrently") and `CONTRACTS.md` §5 — **the orchestrator should serialize the two PRs**
(merge one, rebase the other) rather than land them from stale, simultaneously-branched worktrees,
even though a clean textual merge is the likely outcome given the distance between the edited
regions. No other card in the current batch touches `docs/index.html`, `packages/extension-chrome/
src/content.ts`, or `packages/extension-chrome/src/adapters/landing-marker.ts` (new file — no
collision possible).

## 9. Risk / rollback

- **Risk: low.** The riskiest logic is the `MutationObserver`/copy-ownership handoff in §3.3(d) —
  a bug there could leave `#hero-cta` flickering between authored and adapted copy on language
  toggle, which §6.2's third scenario directly asserts against. Everything else is either a pure,
  unit-tested function (§3.1) or an additive, `hidden`-by-default DOM node.
- **No data-shape risk.** No wire, router, or persisted-schema change; `PublicSettings` is read,
  never written, by this card.
- **No manifest risk.** Zero `manifest.json` diff (§2.2).
- **`docs/index.html` risk is a content/script risk, not an extension risk.** A bug in the new
  inline script can only affect `docs/index.html` itself — the extension's own pages, wire
  protocol, and every other page's content-script behavior are untouched by this card's markup
  edits (only `isLandingPage()`'s early-return in `content.ts` is shared code, and it is a single
  `if` gate with its own unit tests).
- **Rollback:** revert the single PR. `docs/index.html` reverts to its current static 3-step
  checklist (live the moment the revert PR's merge commit lands on `master`, since GitHub Pages
  serves `/docs` directly — same mechanic C3's spec notes for its own rollback); `content.ts`
  reverts to its current single seed line; no stored data becomes invalid, since no data is ever
  written by this card.

## 10. Files touched (summary)

| File                                                              | Change                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/extension-chrome/src/adapters/landing-marker.ts`        | new — `isLandingPage`, `stampInstallMarker`, `stampReadyMarker`                                                |
| `packages/extension-chrome/src/adapters/landing-marker.test.ts`   | new — unit tests (§6.1)                                                                                        |
| `packages/extension-chrome/src/content.ts`                        | + import, + landing-marker gated block replacing the single seed line (§3.2)                                   |
| `docs/index.html`                                                 | + `id="hero-cta"`, + `#start-status` markup, + 2 CSS rules, + new checklist-adaptation `<script>` block (§3.3) |
| `packages/extension-chrome/e2e/c11-install-aware-landing.spec.ts` | new — functional e2e (§6.2)                                                                                    |

No change to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/ports.ts`, `packages/extension-chrome/src/manifest.json`, or the shared `VI`
object in `docs/index.html`.
