# Restore-default prompt button — design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)

## Problem

The options screen lets a user edit the Gemini prompt template in a free-form
textarea. Once they have changed it, there is no way back to the shipped default
short of reinstalling or hand-retyping the template. Users need a one-click
"restore default" affordance.

## Scope

- **In:** a "Restore default" button beside the prompt-template textarea on the
  options screen that re-populates the field with the shipped `DEFAULT_TEMPLATE`.
- **Out:** auto-saving on restore; disabling the button when already default;
  any new toast/notification system; touching the service worker.

## Where it lives

The change is confined to the shared `<settings-form>` web component:

- `packages/app/src/ui/settings-form.ts`

Both the Chrome (`packages/extension-chrome`) and Safari
(`packages/extension-safari`) options pages mount this same component, so the
button appears in **both** shells with no edits to either `options.ts`.
Restoring is pure client-side UI — no service-worker round-trip — so neither
`options.ts` nor the wire protocol changes.

`DEFAULT_TEMPLATE` already lives in the dependency-free domain layer
(`packages/app/src/domain/default-template.ts`) and is re-exported from
`@ai-dict/app`. The component imports it directly:

```ts
import { DEFAULT_TEMPLATE } from '../domain/default-template';
```

UI → domain is the allowed one-way dependency direction
(`ref-core-dependency-rule`), so this introduces no architectural violation.

## Markup

A small button in an `inline-actions` row directly beneath the
`<textarea id="tpl">`, inside the existing **Translation** section:

```
  Prompt template
  ┌────────────────────────────┐
  │ (textarea, 6 rows)         │
  └────────────────────────────┘
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   (inline-actions, dashed top border)
  [ Restore default ]              button#reset-tpl.sm  type="button"
```

The `.inline-actions` and `.sm` styles already exist in the component CSS and
are reused — no new styling beyond placing the row.

## Behavior

On click of `#reset-tpl`:

1. Read the current textarea value.
2. **If it already equals `DEFAULT_TEMPLATE`:** do not prompt. Call
   `setStatus('Prompt template is already the default.')`. No change.
3. **If it differs:** call
   `window.confirm('Replace your prompt template with the default? Your current prompt will be lost.')`.
   - **Cancel (false):** do nothing — textarea unchanged, no status.
   - **OK (true):** set the textarea value to `DEFAULT_TEMPLATE` and call
     `setStatus('Prompt template restored — Save settings to apply.')`.

Restoring only fills the field. Nothing persists until the user clicks **Save
settings**, consistent with the form's existing "Changes apply after saving"
contract. Status text is written via the existing `setStatus()` →
`textContent`, never `innerHTML`, so `rule-sanitize-model-output` stays
satisfied.

### Decisions (from brainstorming)

- **Save behavior:** fill field only; Save still required. (Not auto-save.)
- **Overwrite guard:** confirm popup before replacing a customized prompt.
  Refinement: skip the popup when the field is already the default, since there
  is nothing to lose.

## Error handling

There are no failure paths — the operation is synchronous DOM mutation. The
`confirm` cancel path is a normal no-op, not an error.

## Testing

### Unit — `packages/app/test/ui/settings-form.test.ts`

Add a `describe('<settings-form> restore default prompt')` block. `window.confirm`
is mocked per-case with `vi.spyOn(window, 'confirm')`.

1. **Restore when customized + confirm accepted:** seed `value` with a non-default
   `promptTemplate`, stub `confirm → true`, click `#reset-tpl`, assert
   `#tpl.value === DEFAULT_TEMPLATE` and the status line shows the restored copy.
2. **Restore cancelled:** seed a non-default template, stub `confirm → false`,
   click, assert `#tpl.value` is unchanged and `confirm` was called once.
3. **Already default → no prompt:** seed `value.promptTemplate = DEFAULT_TEMPLATE`,
   spy on `confirm`, click, assert `confirm` was **not** called and the status
   shows the "already the default" copy.
4. **Control-presence list:** add `#reset-tpl` to the existing
   "keeps every required control" assertion list.
5. **Accessibility:** the existing `has no axe violations` test continues to pass
   with the new button present (button has discernible text "Restore default").

### E2E — `packages/extension-chrome/e2e/options-actions.spec.ts`

One happy-path test:

1. Open the options page.
2. Type a custom value into the prompt-template textarea.
3. Register a dialog handler that accepts the `confirm`.
4. Click "Restore default".
5. Assert the textarea value equals the shipped default (assert on a stable
   substring of `DEFAULT_TEMPLATE`, e.g. the `bilingual dictionary` opening line,
   to avoid brittleness on the full multi-line string).

## Evidence for the PR

Per repo conventions: Before/After screenshots of the options screen (button
absent → present, and the field after restore), hosted on a `pr-assets/<slug>`
branch and referenced by same-origin `github.com/.../raw/...` URLs. Captured via
the agent-browser skill against the built Chrome extension.
