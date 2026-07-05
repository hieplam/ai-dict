# A16 — Sticky save bar on Settings (design)

> Roadmap idea **A16** (`docs/ROADMAP.md`): _Impact 3 · Effort S · Score 3.0_.
> Category A (seamless reading UX). Decision authority: **Lead decides** (sticky-bar over
> FAB, dirty-cue style); **no owner escalation**.

## Problem

The Settings form (`packages/app/src/ui/settings-form.ts`) is a long, single-column form
(Connection → Translation → Appearance → Privacy & data). The only **Save settings** button
sits in a plain `.savebar` at the very bottom (`settings-form.ts:212`). It is not sticky.

On the narrow popup / side-panel width (~360px, short viewport) the form is taller than the
viewport, so:

1. **Friction** — changing any field near the top forces a scroll to the bottom to save.
2. **Silent data loss** — a user edits a field, navigates away, and never realizes the change
   was never saved. There is no cue that the form holds unsaved edits.

## Goal

Keep the primary action reachable from anywhere in the form, and make unsaved state visible —
so nothing is silently lost. **No change to what Save does, no change to the fields.**

## Non-goals (scope fence)

- Positioning + dirty-state **only**. Save's behavior and the field set are untouched.
- No floating action button (rejected in the roadmap: less discoverable, overlaps content;
  a sticky bar matches the existing footer pattern).
- `--ad-*` / `--adp-*` design tokens only — no hex/oklch, no theme-name branching, no
  per-component `prefers-color-scheme` (Standing constraint 5). Reduced-motion respected.

## Design

All changes live in the single file `packages/app/src/ui/settings-form.ts` and reuse the
existing markup.

### 1. Sticky bar (CSS)

`.savebar` (CSS at `settings-form.ts:115`) gains:

- `position: sticky; bottom: 0` — pins it to the bottom of the scrolling viewport while the
  taller form scrolls behind it, releasing only at the form's natural end.
- `background: var(--ad-surface)` + `border-top: 1px solid var(--ad-line)` — a token surface
  and rule that separate the pinned bar from the content scrolling underneath.
- Full-bleed padding: `padding: 14px 22px` with `margin: 16px -22px 0`. The `-22px` side
  margins exactly cancel `.col`'s `22px` horizontal padding, so the bar's background spans the
  full page width and fully masks content behind it (no side-gutter bleed-through, and — since
  it cancels an equal padding — introduces no horizontal overflow).

No ancestor sets `overflow`, so sticky resolves against the root scroller. On a short form the
bar simply rests at the bottom (harmless); on the tall narrow layout — the actual problem
case — stickiness engages.

### 2. Dirty cue (markup + CSS)

Add one element to the `.savebar`, hidden by default:

```html
<span id="dirty" class="dirty" hidden>● Unsaved changes</span>
```

- Styled with a token accent color (`--ad-accent-ink`). The **text** carries the meaning
  (the `●` is decorative), so it is not a color-only signal — the a11y (axe) gate stays green.
- **Swap, not clutter:** when the form is dirty, `#dirty` shows and the existing
  `.savebar .muted` hint ("Changes apply after saving") hides; when clean, they swap back.
- Toggling `hidden` involves no motion, so reduced-motion is honored by construction.

### 3. Dirty tracking (`_dirty` flag)

A private `_dirty` boolean drives the cue via a single `refreshDirty()` that toggles the two
spans' `hidden` state.

**Set dirty on a real settings edit:**

- A form-level `input` **and** `change` listener (added in `connectedCallback`) marks dirty for
  any edit to a save-form control (`#provider`, `#key`, `#target`, `#tpl`, `#envelope`,
  `#cache`, `#history`). The handler **excludes `#error-reporting`**, which is not part of
  `SettingsFormValue` and persists through its own `error-reporting-change` event — toggling it
  must not mark the save form dirty.
- The existing `#theme` segment **click** handler marks dirty (theme is a button press, not an
  `input`/`change` event). This handler only runs on user interaction, never on hydration.
- `restoreDefaultTemplate()` and `resetEnvelope()` mark dirty — they change a textarea value
  programmatically (which fires no `input` event), and both already tell the user to "Save
  settings to apply", so the form genuinely is dirty afterward.

**Clear dirty:**

- On `submit` (the moment the `save` event is dispatched) — the edits are now being saved.
- On `set value` (hydration) — a freshly hydrated form is the clean baseline.

**Why programmatic `.value` / `.checked` assignments don't false-trigger:** setting a
control's property in code does not fire `input`/`change`, so hydration and the key-stash logic
never mark the form dirty.

## Testing

Environment: `happy-dom` (unit) + Playwright (e2e), per repo convention.

### Unit tests (`packages/app/test/ui/settings-form.test.ts`)

New `describe('<settings-form> sticky save bar + dirty state')`:

1. Starts clean after hydration: `#dirty` hidden, `.muted` visible.
2. Typing in a field (`input` on `#tpl`) marks dirty: `#dirty` visible, `.muted` hidden.
3. Changing a checkbox (`change` on `#cache`) marks dirty.
4. Submitting (save) clears the cue back to clean.
5. Re-hydrating via `value` resets a dirty form to clean.
6. `restoreDefaultTemplate` (Restore default click, confirmed) marks dirty.
7. Toggling `#error-reporting` does **not** mark the save form dirty.
8. CSS assertion: the adopted stylesheet contains `position:sticky` for `.savebar` (mirrors the
   existing `--ad-surface` / system-color CSS-contains tests). happy-dom cannot lay out sticky,
   so the visual pin is proven by e2e, not asserted here.
9. Axe: no violations with the dirty cue shown.

Coverage stays ≥90% (the file's gate).

### E2E evidence (`packages/extension-chrome`)

Screenshot the options page at the narrow width via the e2e harness (`seedSettings`, options
page URL): dirty state with the bar pinned. Before/after is captured by screenshotting a
`master` build (non-sticky) vs the branch build (pinned + cue).

## Evidence & delivery

- Before/after PNGs hosted on a `pr-assets/<slug>` branch, embedded via same-origin
  `https://github.com/<owner>/<repo>/raw/<branch>/<path>` URLs (private-repo rule).
- Definition of done (roadmap §1): PR squash-merged into master, lint + format + tests green,
  evidence attached. No C3 change (no architecture/topology change — a UI-internal tweak to an
  existing `c3-117 ui-components` surface).

## Risk / rollback

Single-file, additive, token-only change with no wire/domain/permission surface. Rollback =
revert the one commit. The only behavioral subtlety (sticky release at form end, status line
below the bar) is cosmetic and covered by the e2e screenshot.
