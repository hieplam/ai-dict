# Options Page Redesign — Design

**Date:** 2026-06-07
**Status:** Approved; re-baselined onto post-#24 master
**Scope:** Chrome options page only. Safari is explicitly out of scope.

## Problem

The options page (`settings-form` web component) is visually unthemed: plain
`system-ui` text, hardcoded grays/blues (`#202124`, `#1a73e8`, `#f1f3f4`), no
dark mode, and five action buttons (Save, Test connection, Clear cache, Clear
history, Export history) crammed into one equal-weight row. It does not match
the "winter-morning" theme the side panel uses (#18 then brightened in #21).

The redesign brings the options page onto that theme — the ribbon, holly mark,
candlelit glow, serif title, OKLCH token palette, dark-mode adaptation, and
"Stays on your device" footer — and reorganizes the controls so the one primary
action (Save) no longer competes with destructive ones.

## Goal

A purely visual + structural reskin of the **shared** `settings-form`
component plus a small edit to **Chrome's** `options.ts`. No behavior change to
storage, the wire protocol, or the form's public contract.

## Integration with #24 (CRITICAL — this is the live base)

This branch is rebased on `origin/master` after PR **#24** ("surface a status
line for every options action and wire export-history") landed. #24 changed the
exact files this redesign touches, so the reskin must PRESERVE its work:

- `settings-form` now has a **`setStatus(text, tone)` method** and a
  **`<p id="status" role="status" aria-live="polite" hidden>`** element, with
  `#status` / `#status.error` CSS. The reskin keeps the method byte-for-byte and
  re-homes `#status` into the themed markup with themed (token-based) styling.
- **Export-history is already fully wired** (`packages/app/src/app/history-export.ts`,
  `index.ts` export, listeners + a `download()` helper in both shells). The
  redesign must NOT create a competing implementation, must NOT add export
  listeners, and must NOT touch `history-export.ts`.
- #24 added e2e `packages/extension-chrome/e2e/options-actions.spec.ts` and four
  `setStatus` unit tests — all must stay green.

## Hard Invariants (must NOT change)

Pinned by e2e (`settings.spec.ts`, `options-actions.spec.ts`) and unit tests
(`settings-form.test.ts`). Breaking any of them breaks the build.

- **Shadow-DOM element IDs**, unchanged and still queryable: `#key`, `#reveal`,
  `#target`, `#tpl`, `#cache`, `#history`, `#save`, `#test`, `#clear-cache`,
  `#clear-history`, `#export`, `#key-help`, **`#status`**.
- **Public API:** the `save` CustomEvent + `SettingsFormValue` shape; `value`
  setter/getter; `keyFromEnv` setter/getter; **`setStatus(text, tone)`** method;
  relayed events `test-connection`, `clear-cache`, `clear-history`,
  `export-history`.
- **Key-lock behavior:** `keyFromEnv` locks the field read-only, blanks it, shows
  the placeholder, hides Reveal, swaps help text on focus/blur
  (`ENV_KEY_HINT` ↔ `ENV_KEY_NOTICE`); `collect()` echoes the stored key on save.
- **Single adopted stylesheet:** `root.adoptedStyleSheets.length === 1`.
- **axe stays clean** (`wcag2a/2aa/21a/21aa`) for default + locked states.
- `#target` keeps `<option value="vi">Vietnamese` and `<option value="es">Spanish`.
- `#status` is hidden until `setStatus` is called; `setStatus` sets text via
  `textContent` only (S4 — never innerHTML).

## Theme Application

Import `LIGHT_VARS`, `DARK_VARS`, `HOLLY_SVG` from `./styles/tokens` and reference
everything via `var(--ad-*)` — never hardcoded OKLCH/hex (the palette was
brightened in #21; this design inherits it automatically). Follow the
`side-panel-view.ts` pattern:

- `:host{ <LIGHT_VARS>; min-height:100vh; background:var(--ad-glow),var(--ad-surface);
color:var(--ad-ink); color-scheme:light dark }` then
  `@media (prefers-color-scheme:dark){ :host{ <DARK_VARS> } ... }`, one CSS string.
- Full-bleed **ribbon** (`linear-gradient(90deg,var(--ad-pine),var(--ad-amber) 52%,var(--ad-cranberry))`).
- **Header**: `HOLLY_SVG` + "AI Dictionary" brand (pine).
- Centered reading column (`max-width:~640px`).
- Serif **"Settings"** title with the gradient underline (`.focus h2` pattern).
- Token-styled inputs/selects/textarea, amber focus ring; checkboxes
  `accent-color:var(--ad-pine)`.
- **Footer**: a local `ICON_SHIELD` SVG + "Stays on your device".
- **Icons:** inline SVG + text only — **no emoji**.

**Primary button accessibility:** the Save button is filled with the brand
**pine** (`var(--ad-pine)`) and `var(--ad-surface)` text. Light mode passes AA
(~4.7:1). Dark-mode pine (`oklch 0.7`) on dark surface text is ~4.3:1 (just under
4.5:1), so the dark `@media` block lightens the button background via
`color-mix(in oklab, var(--ad-pine) 86%, white)` (token-based, ~4.7:1). Verified
in-browser during the evidence step.

## Structure — Three Grouped Sections

Soft-bordered groups (`1px solid var(--ad-line)`, `border-radius:13px`, faint
fill). IDs stay put; only surrounding markup changes.

1. **Connection** — `#key` + `#reveal`, `#key-help`, inline env-notice
   (`#env-notice`, shown when `keyFromEnv`), `#test` as a small button.
2. **Translation** — `#target`, `#tpl`.
3. **Privacy & data** — `#cache` / `#history` toggles; `#clear-cache`,
   `#clear-history` as small buttons, `#export` as a link-style action.

Below the sections: a standalone pine **`#save` "Save settings"** primary button,
then the existing **`#status`** line (themed), and the footer.

## Env-Key Inline Notice

When `keyFromEnv` is true, the component renders `ENV_KEY_NOTICE` as a themed
inline notice in the Connection section (amber left-border) and the field locks.
**Chrome's `options.ts`** drops its hand-injected blue banner and its now-unused
`ENV_KEY_NOTICE` import; it keeps all of #24's status/export wiring.
`ENV_KEY_NOTICE` stays the single source of truth for the wording.

## Out of Scope / Known Follow-up (Safari)

Safari's `options.ts` is NOT touched. Because the inline notice is driven by the
shared component, a Safari build baking in `GEMINI_API_KEY` would show the notice
inline (new) AND via Safari's existing banner (duplicate). Recorded as a known
follow-up to fix when Safari is themed; intentionally not addressed here.

## Testing

- All existing unit + e2e suites stay green unchanged (including #24's `setStatus`
  tests and `options-actions.spec.ts`).
- New unit assertions in `settings-form.test.ts`: ribbon/brand/footer present;
  the three section headings; all required IDs (incl. `#status`) still present;
  single adopted stylesheet; inline env-notice appears with `ENV_KEY_NOTICE` text
  under `keyFromEnv`.
- Visual evidence (before/after, light + dark, env-notice state) via agent-browser,
  hosted same-origin per repo convention.
