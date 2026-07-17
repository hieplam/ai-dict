# A9 Instant Cache Hits Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a repeat lookup of a word+sentence already in the local cache renders a visible
`Cached` badge (in both the in-page card and the side panel) and structurally proves it made
zero network calls; the < 100 ms repeat-speed guarantee is documented as already-true (no code
path change) and enforced by an e2e test that asserts zero extra provider calls plus a generous
wall-clock tripwire — not a flaky tight-ms hard gate.

**Architecture:** this card is pure UI-signal threading over an already-correct cache engine.
`LookupResult.fromCache: boolean` (`packages/app/src/domain/types.ts:47`) and the matching wire
field (`packages/app/src/wire.ts:48`) are already required, non-optional, and already populated
correctly by `cacheGet`/`cachePut` (`packages/app/src/domain/cache-policy.ts:55,66`) and returned
on every `handleLookup` reply (`packages/app/src/app/router.ts:97-172`) — cache-hit or not. **Zero
changes** to `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`,
`packages/app/src/domain/workflow.ts`, or the actual caching/eviction logic in
`packages/app/src/domain/cache-policy.ts` (which gets one clarifying comment only). The work is:
(1) thread the already-present `fromCache` flag from `LookupResult` into `CardState` at the two
composition points that build it (`InlineBottomSheetRenderer.renderResult`, `side-panel.ts`'s
`resultToFocus`), and (2) render it as a badge in the one shared function both surfaces already
call (`renderMetaRow` inside `packages/app/src/ui/lookup-card.ts`). Full design rationale —
including why the cache key needs no change and why the < 100 ms guarantee is enforced
structurally rather than with a flaky ms-level CI gate — is in
`docs/superpowers/specs/2026-07-17-a9-instant-cache-hits-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e).

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A9InstantCacheHits`.
- **Do not touch `packages/app/src/wire.ts`, `packages/app/src/app/router.ts`, or
  `packages/app/src/domain/workflow.ts`.** `fromCache` is already required on the wire schema and
  already returned correctly on every reply (design spec §1/§3.5/§3.6). If a task in this plan
  seems to need a wire/router/workflow change, stop — that means the "already correct" grounding
  broke somewhere and the plan needs re-grounding, not an ad hoc edit.
- **Do not change the cache key composition** in `packages/app/src/domain/cache-policy.ts` beyond
  the one clarifying comment in Task 1 — the key already disambiguates by sentence (design spec
  §2.1). No re-hash, no migration.
- This card adds **no wire message**, so the "wire.ts arm + router.ts case = one task" rule does
  not apply here.
- **< 100 ms is a structural guarantee, not a new fast path to build**: a cache hit already skips
  the network entirely (design spec §2.2). The e2e task enforces this with (a) a hard zero-extra-
  network-calls assertion and (b) a documented, generous wall-clock tripwire (500 ms) that is
  explicitly NOT the product's real latency number — see Task 5.
- `bun run lint` and `bun run format:check` clean before every commit.
- Every task must leave `cd packages/app && bun run typecheck` (and, from Task 4 on,
  `cd packages/extension-chrome && bun run typecheck`) green.
- The e2e build must clear any ambient `GEMINI_API_KEY` (`GEMINI_API_KEY= bun run build:chrome`).
- UI additions read only `--ad-*`/`--adp-*` design tokens (no hard-coded colors) — the new
  `.cache-badge` rule reuses `--ad-accent`/`--ad-accent-soft`/`--ad-accent-ink`, already used
  elsewhere on this card (e.g. the save button's pressed state).
- S4 (sanitize model output) is not engaged: the badge's text is a static literal (`'Cached'`),
  never model output — no new content passes through `sanitizeMarkdown`.
- Commit subject convention for every task in this plan:
  `[A9InstantCacheHits] feat: <imperative summary> (A9)`. No `Co-Authored-By` trailer, no
  attribution footer (repo convention).

---

### Task 1: `cache-policy.ts` — clarifying comment, zero behavior change

**Files:**

- Modify: `packages/app/src/domain/cache-policy.ts`

**Interfaces:** none — no exported signature changes.

This task has no red/green cycle (it changes zero executable lines), so its "test" is a
before/after regression run of the existing suite proving byte-for-byte identical behavior.

- [ ] **Step 1: Run the existing suite first (baseline).**

```
cd packages/app && bunx vitest run test/cache-policy.test.ts
```

Expected: all tests pass (baseline, before any edit).

- [ ] **Step 2: Add the comment.** In `packages/app/src/domain/cache-policy.ts`, insert this doc
      comment immediately above the existing `deriveCacheKey` function (currently line 15,
      `export function deriveCacheKey(...)`), with NO other change to the function body:

```ts
/**
 * A9: the hash already includes `context` (the full sentence the word was selected in, see
 * `workflow.ts`'s `context: e.sentence`), not just the word — so two different senses of the
 * same headword ("bank" river vs. money) never collide, because they never share the same
 * sentence. This was verified against the roadmap's stated concern (docs/ROADMAP.md §4 A9) and
 * intentionally left unchanged; do not add a separate "sense" field without re-reading
 * `docs/superpowers/specs/2026-07-17-a9-instant-cache-hits-design.md` §2.1 first.
 */
export function deriveCacheKey(req: { word: string; context: string; target: string }): string {
  const norm = `${req.word.trim().toLowerCase()}|${req.context.trim()}|${req.target}`;
  return fnv1a64Hex(norm);
}
```

- [ ] **Step 3: Re-run the same suite (confirm zero drift).**

```
cd packages/app && bunx vitest run test/cache-policy.test.ts
```

Expected: identical pass count to Step 1 — same tests, same result, proving the comment changed
nothing executable.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/domain/cache-policy.ts
git commit -m "[A9InstantCacheHits] feat: document why the cache key needs no sense field (A9)" \
  -m $'Tribe-Card: a9-instant-cache-hits\nTribe-Task: 1/6'
```

---

### Task 2: `lookup-card.ts` — the `Cached` badge

**Files:**

- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**Interfaces:**

```ts
// CardState's 'result' variant gains:
fromCache?: boolean;

// renderMetaRow's parameter type gains the same field; its guard widens from
// `if (!state.provider) return null;` to `if (!state.provider && state.fromCache !== true) return null;`
```

- [ ] **Step 1: Write the failing tests.** Insert a new `describe` block into
      `packages/app/test/ui/lookup-card.test.ts` immediately after the existing provider-metadata
      block's closing `});` (currently line 466, right before
      `describe('<lookup-card> idiom label + force-literal button (A8)', ...)`):

```ts
describe('<lookup-card> instant-cache badge (A9)', () => {
  it('fromCache:true renders a .cache-badge reading "Cached", before the provider badge', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      fromCache: true,
    };
    const row = el.querySelector('.meta-row')!;
    const badge = row.querySelector('.cache-badge')!;
    expect(badge.textContent).toBe('Cached');
    // Cache badge is the leading child — first thing the eye lands on.
    expect(row.firstElementChild).toBe(badge);
    expect(row.querySelector('.prov-badge')).not.toBeNull();
  });

  it('fromCache:true with NO provider still renders the row with the cache badge', () => {
    const nodes = renderCardState({
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      fromCache: true,
    });
    const row = nodes.find(
      (n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('meta-row'),
    );
    expect(row).toBeDefined();
    expect(row!.querySelector('.cache-badge')!.textContent).toBe('Cached');
    expect(row!.querySelector('.prov-badge')).toBeNull();
  });

  it('fromCache:false renders no .cache-badge', () => {
    const el = mountCard();
    el.state = {
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
      provider: 'gemini',
      fromCache: false,
    };
    expect(el.querySelector('.cache-badge')).toBeNull();
    expect(el.querySelector('.prov-badge')).not.toBeNull(); // unaffected
  });

  it('fromCache absent and no provider still renders no .meta-row at all (unchanged guard)', () => {
    const nodes = renderCardState({
      kind: 'result',
      word: 'bank',
      target: 'vi',
      safeHtml: safe('<p>x</p>'),
    });
    const hasMeta = nodes.some((n) => n instanceof HTMLElement && n.classList.contains('meta-row'));
    expect(hasMeta).toBe(false);
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: the 4 new tests fail — `CardState` has no `fromCache` field yet (a type error on
`el.state = {..., fromCache: true}` /`renderCardState({..., fromCache: true})`), and no
`.cache-badge` exists in the render output.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/lookup-card.ts`:

1. Add `fromCache?: boolean` to `CardState`'s `'result'` variant, right after the existing `nudge?`
   field (currently `lookup-card.ts:51-53`):

```ts
      /** B7: whether to show the repeat-offender nudge banner — stamped once, ever, per word by
       * the router the moment its within-30-day history count first crosses the threshold. */
      nudge?: boolean;
      /** A9: true when this result was served from the local cache (zero tokens, no network
       * call) — see domain/cache-policy.ts's cacheGet. Renders a leading "Cached" badge in the
       * meta-row. Always explicit true/false when the composition root threads a real
       * LookupResult (LookupResult.fromCache is a required field); absent only for hand-built
       * test/legacy CardState literals that predate this field. */
      fromCache?: boolean;
    }
  | { kind: 'error'; error: LookupError };
```

2. Replace `renderMetaRow` in full (currently `lookup-card.ts:431-503`) with:

```ts
function renderMetaRow(state: {
  provider?: Provider;
  fallbackFrom?: Provider;
  providers?: Provider[];
  fromCache?: boolean;
}): HTMLElement | null {
  if (!state.provider && state.fromCache !== true) return null;
  const row = document.createElement('div');
  row.className = 'meta-row';

  // A9: leads the row — the card's own payoff is "you can see it was free", so this is the
  // first thing the eye should land on for a repeat lookup, ahead of which provider answered.
  if (state.fromCache === true) {
    const cacheBadge = document.createElement('span');
    cacheBadge.className = 'cache-badge';
    cacheBadge.textContent = 'Cached';
    cacheBadge.title = 'Served from your local cache — no tokens used';
    row.append(cacheBadge);
  }

  if (state.provider) {
    const badge = document.createElement('span');
    badge.className = 'prov-badge';
    badge.textContent = providerLabel(state.provider);
    row.append(badge);

    if (state.fallbackFrom) {
      const note = document.createElement('span');
      note.className = 'fallback-note';
      note.textContent = `${providerLabel(state.fallbackFrom)} unavailable — answered by ${providerLabel(state.provider)}`;
      row.append(note);
    }

    if (state.providers && state.providers.length >= 2) {
      const current = state.provider;
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'prov-switch';
      switchBtn.setAttribute('aria-haspopup', 'listbox');
      switchBtn.setAttribute('aria-expanded', 'false');
      switchBtn.textContent = 'Switch';

      const menu = document.createElement('span');
      menu.className = 'prov-menu';
      menu.setAttribute('role', 'listbox');
      menu.hidden = true;

      for (const p of state.providers) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.setAttribute('role', 'option');
        opt.dataset['provider'] = p;
        opt.textContent = providerLabel(p);
        const isCurrent = p === current;
        opt.setAttribute('aria-selected', String(isCurrent));
        if (isCurrent) {
          opt.disabled = true;
        } else {
          opt.addEventListener('click', () => {
            menu.hidden = true;
            switchBtn.setAttribute('aria-expanded', 'false');
            // Ask the shell to re-run this lookup once against the picked provider.
            opt.dispatchEvent(
              new CustomEvent('switch-provider', {
                detail: { provider: p },
                bubbles: true,
                composed: true,
              }),
            );
          });
        }
        menu.append(opt);
      }

      switchBtn.addEventListener('click', () => {
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        switchBtn.setAttribute('aria-expanded', String(willOpen));
      });

      row.append(switchBtn, menu);
    }
  }

  return row;
}
```

Note: the provider/fallback/switcher block's content and order are byte-for-byte identical to
before — only re-nested one level under `if (state.provider)` so it never runs against an
`undefined` provider (the sole new case that can reach this function without one: a cache hit
with no recorded provider, e.g. an entry cached before A8 added the field — the same class of
legacy tolerance already documented for the provider badge at `lookup-card.ts:426`).

3. Add the `.cache-badge` CSS rule to `CARD_DOC_CSS` (currently `lookup-card.ts:145-180`), right
   after the existing `lookup-card .prov-badge{...}` rule (line 146):

```css
lookup-card .cache-badge {
  border: 1px solid var(--ad-accent);
  border-radius: var(--adp-radius-control);
  padding: 1px 8px;
  color: var(--ad-accent-ink);
  background: var(--ad-accent-soft);
}
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing + 4 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "[A9InstantCacheHits] feat: render a Cached badge in the lookup-card meta-row (A9)" \
  -m $'Tribe-Card: a9-instant-cache-hits\nTribe-Task: 2/6'
```

---

### Task 3: `inline-bottom-sheet-renderer.ts` — thread `fromCache` into the in-page card

**Files:**

- Modify: `packages/app/src/app/inline-bottom-sheet-renderer.ts`
- Modify: `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`

**Interfaces:** none new — `renderResult`'s signature is unchanged; only the `CardState` object
it builds internally gains one field.

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/app/test/app/inline-bottom-sheet-renderer.test.ts`, as a new `describe` block at
      the very end of the file (after the existing `describe('InlineBottomSheetRenderer —
repeat-offender nudge (B7)', ...)` block's closing `});`, currently the file's last line):

```ts
describe('InlineBottomSheetRenderer — instant-cache badge (A9)', () => {
  it('renderResult reflects r.fromCache=true', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult({ ...result, fromCache: true });
    expect(card(h).querySelector('.cache-badge')).not.toBeNull();
  });

  it('renderResult reflects r.fromCache=false (the shared fixture default)', () => {
    const h = host();
    new InlineBottomSheetRenderer(h).renderResult(result);
    expect(card(h).querySelector('.cache-badge')).toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: the first new test fails (`.cache-badge` is null — `renderResult` never threads
`fromCache` yet); the second passes vacuously (already null before this change) but is kept as
the paired regression guard.

- [ ] **Step 2: Implement.** In `packages/app/src/app/inline-bottom-sheet-renderer.ts`, add one
      line to the object literal inside `renderResult` (currently `inline-bottom-sheet-renderer.ts:93-105`),
      right after the existing `target: r.target,` line:

```ts
this.setState({
  kind: 'result',
  safeHtml: this.sanitize(r.markdown),
  word: r.word,
  target: r.target,
  // A9: fromCache is a required boolean on LookupResult (never undefined), so thread it
  // unconditionally — same style as word/target above, not the `? {...} : {}` pattern used
  // for genuinely optional fields like provider/definedAs below.
  fromCache: r.fromCache,
  ...(r.provider !== undefined ? { provider: r.provider } : {}),
  ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
  ...(r.definedAs !== undefined ? { definedAs: r.definedAs } : {}),
  ...(ctx?.providers !== undefined ? { providers: ctx.providers } : {}),
  saved: ctx?.saved === true,
  // B7: r.nudge is a transient per-reply annotation (never persisted — see router.ts);
  // always explicit true/false, same style as `saved` above.
  nudge: r.nudge === true,
});
```

Run: `cd packages/app && bunx vitest run test/app/inline-bottom-sheet-renderer.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/app/src/app/inline-bottom-sheet-renderer.ts packages/app/test/app/inline-bottom-sheet-renderer.test.ts
git commit -m "[A9InstantCacheHits] feat: thread fromCache into the in-page card's CardState (A9)" \
  -m $'Tribe-Card: a9-instant-cache-hits\nTribe-Task: 3/6'
```

---

### Task 4: `side-panel.ts` — thread `fromCache` into the panel's focus state

**Files:**

- Modify: `packages/extension-chrome/src/side-panel.ts`

No dedicated unit test exists for `side-panel.ts` in this repo — it is a composition root
(same precedent as `options.ts` in the C2 plan), covered by e2e only. This task's correctness is
proven by Task 5's e2e scenario 3; still run the typecheck gate below so a regression elsewhere
in this file (which many other cards also touch) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/side-panel.ts`, add one line to
      the object `resultToFocus` returns (currently `side-panel.ts:114-128`), right after the
      existing `target: r.target,` line:

```ts
function resultToFocus(r: LookupResult): PanelFocusState {
  // Show the provider badge + fallback note in the panel too, but no one-shot picker here
  // (the panel is a persistent surface, not the transient in-page card) — omit `providers`.
  return {
    kind: 'result',
    safeHtml: sanitizeMarkdown(r.markdown),
    word: r.word,
    target: r.target,
    // A9: fromCache is a required boolean on LookupResult; thread it unconditionally, same as
    // word/target above — see inline-bottom-sheet-renderer.ts's identical choice (A9 design
    // spec §3.3/§3.4).
    fromCache: r.fromCache,
    ...(r.provider !== undefined ? { provider: r.provider } : {}),
    ...(r.fallbackFrom !== undefined ? { fallbackFrom: r.fallbackFrom } : {}),
    // B7: nudge is a transient per-reply annotation on LookupResult (never persisted); thread it
    // through so the panel's own focus region shows the same banner the in-page card does.
    ...(r.nudge === true ? { nudge: true } : {}),
  };
}
```

Run:

```
cd packages/extension-chrome && bun run typecheck
```

Expected: clean (no type errors) — `fromCache` is already an optional field on `CardState`
(Task 2), so assigning `PanelFocusState`'s `'result'` variant (a `CardState` alias) the value of
`r.fromCache` typechecks.

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/src/side-panel.ts
git commit -m "[A9InstantCacheHits] feat: thread fromCache into the side panel's focus state (A9)" \
  -m $'Tribe-Card: a9-instant-cache-hits\nTribe-Task: 4/6'
```

---

### Task 5: e2e coverage — new `a9-instant-cache-hits.spec.ts`

**Files:**

- Create: `packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts`

- [ ] **Step 1: Write the spec.** Create
      `packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { seedSettings, gotoFixture, selectWord, openTrigger, mockGemini } from './helpers';
import type { BrowserContext } from '@playwright/test';

/** Repeats gotoFixture's default sentence deterministically so two lookups of "bank" in the
 * same test share an identical word+sentence+target cache key (see design spec §5.3). */
async function doLookup(page: import('@playwright/test').Page): Promise<void> {
  await gotoFixture(page);
  await page.waitForTimeout(1_000);
  await selectWord(page, 't', 'bank');
  await openTrigger(page);
  await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
    timeout: 10_000,
  });
}

/** Minimal local twin of side-panel.spec.ts's openPanelAndSender (not exported there) — opens
 * the panel plus a second extension page that can post {to:'side-panel', ...} messages to it. */
async function openPanelAndSender(context: BrowserContext, extensionId: string) {
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/options.html`);
  await seedSettings(sender);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await panel.waitForSelector('side-panel-view');
  return { panel, sender };
}

test.describe('A9 instant cache hits', () => {
  test('a repeat lookup of the same word+sentence shows Cached and makes zero extra network calls', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: true });

    await doLookup(page); // miss — first time this word+sentence is looked up
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(1);

    await doLookup(page); // hit — identical word+sentence+target as above
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toContainText('Cached', {
      timeout: 10_000,
    });
    // The hard gate (design spec §2.2(1)): a cache hit makes ZERO additional network calls.
    expect(calls.count).toBe(1);
  });

  test('cacheEnabled:false never shows the badge and always hits the network', async ({
    context,
    extensionId,
  }) => {
    const calls = await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: false });

    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await doLookup(page);
    await expect(page.locator('bottom-sheet lookup-card .cache-badge')).toHaveCount(0);
    await expect.poll(() => calls.count, { timeout: 5_000 }).toBe(2); // no caching → two calls
  });

  test('the side panel shows the same Cached badge for a mirrored fromCache:true payload', async ({
    context,
    extensionId,
  }) => {
    const { panel, sender } = await openPanelAndSender(context, extensionId);
    await sender.evaluate(() =>
      chrome.runtime.sendMessage({
        to: 'side-panel',
        state: 'result',
        payload: {
          markdown: '## bank\nA financial institution.',
          word: 'bank',
          target: 'vi',
          fromCache: true,
        },
      }),
    );
    await expect(panel.locator('side-panel-view .cache-badge')).toContainText('Cached', {
      timeout: 5_000,
    });
  });

  test('wall-clock smoke check: repeat lookup renders the badge well under the CI-jitter margin', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(page, { cacheEnabled: true });

    await doLookup(page); // miss, populates the cache
    await gotoFixture(page);
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'bank');

    const t0 = Date.now();
    await openTrigger(page);
    await page.locator('bottom-sheet lookup-card .cache-badge').waitFor({ state: 'visible' });
    const elapsed = Date.now() - t0;

    // NOT the product's real latency number — Playwright/CDP round trips and headless CI
    // scheduling add overhead unrelated to the extension's own code path (design spec §2.2(2)).
    // The actual guarantee is enforced structurally (zero extra network calls, asserted above);
    // this is a coarse tripwire against a gross regression only.
    expect(elapsed).toBeLessThan(500);
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a9-instant-cache-hits
```

Expected: 4 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

Commit:

```
git add packages/extension-chrome/e2e/a9-instant-cache-hits.spec.ts
git commit -m "[A9InstantCacheHits] feat: e2e coverage for the Cached badge and zero-network-on-hit guarantee (A9)" \
  -m $'Tribe-Card: a9-instant-cache-hits\nTribe-Task: 5/6'
```

---

### Task 6: Final gate + open the PR

- [ ] **Step 1: Run every gate.**

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a9-instant-cache-hits cache-history side-panel
```

Expected: typecheck clean on both packages; the full Vitest suite green (including the 4
`lookup-card.test.ts` additions and 2 `inline-bottom-sheet-renderer.test.ts` additions); lint/
format clean; the Chrome build succeeds with the env key cleared; `a9-instant-cache-hits.spec.ts`
(4 new scenarios), `cache-history.spec.ts` (regression guard — this task's edits share the cache
read/write path), and `side-panel.spec.ts` (regression guard — this task's edits share
`resultToFocus`) all pass.

- [ ] **Step 2: Open the PR.** Title: `[A9InstantCacheHits] Instant cache hits`. Regular merge
      (no squash). Include the Jira link per the repo convention and a **"Testing performed"**
      section per this worktree's evidence policy (design spec §6) instead of screenshots/video —
      list the suites above with pass counts:

      - Unit: `lookup-card.test.ts` (+4), `inline-bottom-sheet-renderer.test.ts` (+2),
        `cache-policy.test.ts` (unchanged pass count, regression-proves the comment-only edit).
      - e2e: `a9-instant-cache-hits.spec.ts` (4 passed, new), `cache-history.spec.ts` (regression
        guard, unchanged), `side-panel.spec.ts` (regression guard, unchanged).
      - Gates: typecheck (app + extension-chrome), lint, format:check, Chrome build with
        `GEMINI_API_KEY=` cleared.
