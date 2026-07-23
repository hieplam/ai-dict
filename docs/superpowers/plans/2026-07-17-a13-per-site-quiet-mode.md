# A13 Per-Site Quiet Mode Implementation Plan

> **For agentic workers:** implement task-by-task, TDD (red → green → commit) per task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Dispatch every implementation/fix task to the
> `hunter` subagent — never a generic implementer.

**Goal:** a per-site "don't show the Define button here" list. Muting a site (registrable domain
granularity) makes the floating trigger bubble stop visibly appearing there — but the A4
`define-selection` keyboard shortcut still fires a real lookup on a muted site, because the
trigger element is still created and wired, just never mounted to the page. Sites are muted from
two places: the settings page's new "Quiet sites" list (add/remove, the only way to unmute) and a
one-click "Mute this site" action on the card header (add-only, idempotent, no unmute path).

**Architecture:** a new, independent domain module (`packages/app/src/domain/quiet-site-policy.ts`,
`c3-1`) owns a `quiet:index` KV keyspace (`ref-kv-storage-prefixes`) — sibling to `saved:*`/
`nudge:*`, never a `Settings`/`PublicSettings` field (the content-script write-ban in
`MessageRelaySettingsStore.set()` forbids that path). Three new wire messages
(`quiet.list`/`quiet.add`/`quiet.remove`) let both the content script and the options page read
and mutate that keyspace. `ChromeFloatingTrigger` (`c3-2`) gains a `quiet: boolean` property that
gates only the _visible-mount_ half of `show()` — the element is always created and wired, so
`activate()` (A4's keyboard path) keeps working even when nothing was ever painted. Full design
rationale, including why path-level matching, a `Settings` field, and a context-menu control were
all rejected: `docs/superpowers/specs/2026-07-17-a13-per-site-quiet-mode-design.md`.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit), Playwright (e2e), zod (wire schemas).

## Global Constraints

- Implementer: dispatch each task to the `hunter` subagent.
- Start in a fresh git worktree under `.claude/worktrees/` on branch `feature/A13QuietMode`.
- Commit subject: `[A13QuietMode] feat: <imperative summary> (A13)`. No `Co-Authored-By` trailer,
  no attribution footer.
- `bun run lint` + `bun run format:check` green before every commit; per-package
  `bun run typecheck` green after every task (`packages/app`, and `packages/extension-chrome` from
  Task 3 on).
- **Task 2 (wire.ts + router.ts) is ONE task, per house rule** — the three new arms and their
  router cases cannot typecheck apart (exhaustive `switch(msg.type)`, no `default`).
- E2e build clears the ambient key: `GEMINI_API_KEY= bun run build:chrome` (never rely on shell
  state — a baked-in env key skips onboarding, which is unrelated to this card but still governs
  how the e2e build must be invoked).
- E2e must never fetch the live landing page — this card's e2e uses only the existing
  `gotoFixture` local fixture; it never touches `docs/index.html`.
- **Concurrency (CONTRACTS §5) — read before Tasks 3 and 5.** This worktree is shared with other
  in-flight cards. Verified live at plan-authoring time (2026-07-23):
  - `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts` — pre-listed hot group
    (`A5 A6 A13 A14 A15 B3 B4`). Confirmed clean against `origin/master` with **no in-flight edit**
    right now (A15 has not landed). Task 3's line citations are anchored to that current state, but
    re-read the file first regardless.
  - `packages/app/src/ui/lookup-card.ts` and `packages/app/src/ui/styles/tokens.ts` — **actively
    being edited by A7 (Pin cards) in this exact worktree as of this plan's authoring** (confirmed
    via `git diff origin/master --stat`, both show uncommitted changes: a `canPin`/`pinned`
    `CardState` extension, a `renderPinRow` function, an `ICON_PIN` token). Task 5's line numbers
    are anchored to that current state, but this file is a known-hot moving target — **before
    editing, re-locate every insertion point by searching for the unique code string named in each
    step (e.g. `actions.append(`, `actionButton(`), not by trusting the line number alone.**
  - `packages/app/src/ui/settings-form.ts` — pre-listed hot group (`A5 A9 A13 B6 C9`); clean today.
  - `packages/app/src/wire.ts` / `packages/app/src/app/router.ts` — pre-listed "wire+router" group;
    clean today. If another card's wire/router change has landed by the time Task 2 runs, re-anchor
    against the new arm/case list rather than assuming the append-after-X point named below still
    holds.
- UI reads only `--ad-*`/`--adp-*` design tokens (no hard-coded colors); the new "Quiet sites"
  section and the mute icon follow this exactly (§3.9/§3.7 of the design spec).
- S1/S4 are not implicated: no API key or model output is anywhere near this feature (design spec
  §4 scope fence).

---

### Task 1: Domain module — `quiet-site-policy.ts`

**Files:**

- Create: `packages/app/src/domain/quiet-site-policy.ts`
- Create: `packages/app/test/quiet-site-policy.test.ts`
- Modify: `packages/app/src/index.ts`

**Interfaces:**

```ts
export interface QuietSiteDeps {
  storage: Storage;
}
export function registrableDomain(input: string): string;
export function quietSiteAdd(deps: QuietSiteDeps, domain: string): Promise<string[]>;
export function quietSiteRemove(deps: QuietSiteDeps, domain: string): Promise<string[]>;
export function quietSiteList(deps: QuietSiteDeps): Promise<string[]>;
export function isQuietSite(domains: string[], hostname: string): boolean;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/app/test/quiet-site-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  registrableDomain,
  quietSiteAdd,
  quietSiteRemove,
  quietSiteList,
  isQuietSite,
} from '../src/domain/quiet-site-policy';
import type { Storage } from '../src';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}

describe('quiet-site-policy', () => {
  describe('registrableDomain', () => {
    it('collapses a subdomain to its registrable last-two-labels domain', () => {
      expect(registrableDomain('docs.google.com')).toBe('google.com');
      expect(registrableDomain('www.example.com')).toBe('example.com');
    });

    it('passes through a bare 2-label host and localhost unchanged', () => {
      expect(registrableDomain('example.com')).toBe('example.com');
      expect(registrableDomain('localhost')).toBe('localhost');
    });

    it('passes through an IPv4 literal unchanged', () => {
      expect(registrableDomain('192.168.1.10')).toBe('192.168.1.10');
    });

    it('accepts a full https URL as input, not just a bare hostname', () => {
      expect(registrableDomain('https://docs.google.com/document/1')).toBe('google.com');
    });

    it('is case-insensitive', () => {
      expect(registrableDomain('DOCS.GOOGLE.COM')).toBe('google.com');
    });
  });

  describe('quietSiteAdd / quietSiteRemove / quietSiteList', () => {
    it('adds a new domain and returns the sorted list', async () => {
      const s = memStorage();
      const list = await quietSiteAdd({ storage: s }, 'example.com');
      expect(list).toEqual(['example.com']);
      expect(await quietSiteList({ storage: s })).toEqual(['example.com']);
    });

    it('adding an already-present domain is a no-op (no duplicate)', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'example.com');
      const list = await quietSiteAdd({ storage: s }, 'example.com');
      expect(list).toEqual(['example.com']);
    });

    it('normalizes to the registrable domain before storing (a subdomain matches the bare domain)', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'https://docs.google.com');
      const list = await quietSiteAdd({ storage: s }, 'mail.google.com');
      expect(list).toEqual(['google.com']);
    });

    it('removes a present domain', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'example.com');
      const list = await quietSiteRemove({ storage: s }, 'example.com');
      expect(list).toEqual([]);
    });

    it('removing an absent domain is a no-op', async () => {
      const s = memStorage();
      const list = await quietSiteRemove({ storage: s }, 'example.com');
      expect(list).toEqual([]);
    });

    it('quietSiteList reflects the current state across add/remove, sorted', async () => {
      const s = memStorage();
      await quietSiteAdd({ storage: s }, 'b.com');
      await quietSiteAdd({ storage: s }, 'a.com');
      expect(await quietSiteList({ storage: s })).toEqual(['a.com', 'b.com']);
      await quietSiteRemove({ storage: s }, 'a.com');
      expect(await quietSiteList({ storage: s })).toEqual(['b.com']);
    });
  });

  describe('isQuietSite', () => {
    it('is true when the hostname normalizes to a domain in the list', () => {
      expect(isQuietSite(['example.com'], 'www.example.com')).toBe(true);
    });

    it('is false when it does not', () => {
      expect(isQuietSite(['example.com'], 'other.com')).toBe(false);
    });
  });
});
```

Run: `cd packages/app && bunx vitest run test/quiet-site-policy.test.ts`
Expected: failure — `Cannot find module '../src/domain/quiet-site-policy'` (the file doesn't exist
yet).

- [ ] **Step 2: Implement.** Create `packages/app/src/domain/quiet-site-policy.ts`:

```ts
import type { Storage } from '../ports';

const INDEX_KEY = 'quiet:index';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface QuietSiteDeps {
  storage: Storage;
}

/**
 * A13: resolve a URL or bare hostname to its registrable domain — the last two dot-separated
 * labels (e.g. `docs.google.com` -> `google.com`), so muting one subdomain silences the whole
 * site. Naive heuristic, no public-suffix list (see the design spec §2.1 for the accepted
 * false-positive-only limitation on multi-label suffixes like `co.uk`). IPv4 literals and
 * single/no-label hosts (`localhost`) are returned unchanged.
 */
export function registrableDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  let hostname = trimmed;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname;
  } catch {
    // Not URL-parseable (e.g. ''); fall back to the raw trimmed input.
  }
  if (IPV4.test(hostname)) return hostname;
  const parts = hostname.split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

async function readIndex(s: Storage): Promise<string[]> {
  const raw = await s.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/** Idempotent: adding an already-muted domain is a no-op (the card's "Mute this site" action
 * relies on this — it never checks current state first, see design spec §2.3). Returns the
 * full, sorted list after the write. */
export async function quietSiteAdd(deps: QuietSiteDeps, domain: string): Promise<string[]> {
  const d = registrableDomain(domain);
  const idx = await readIndex(deps.storage);
  if (idx.includes(d)) return idx;
  const next = [...idx, d].sort();
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(next));
  return next;
}

/** Idempotent: removing an unmuted domain is a no-op, matching savedWordDelete's contract
 * (saved-words-policy.ts:71). Returns the full list after the write. */
export async function quietSiteRemove(deps: QuietSiteDeps, domain: string): Promise<string[]> {
  const d = registrableDomain(domain);
  const next = (await readIndex(deps.storage)).filter((x) => x !== d);
  await deps.storage.setItem(INDEX_KEY, JSON.stringify(next));
  return next;
}

export async function quietSiteList(deps: QuietSiteDeps): Promise<string[]> {
  return readIndex(deps.storage);
}

/** Pure membership check against an already-fetched list — the primitive a content script (or a
 * future B3 scanner, design spec §2.5) uses locally without a KV round trip per check. */
export function isQuietSite(domains: string[], hostname: string): boolean {
  return domains.includes(registrableDomain(hostname));
}
```

No `now`/clock DI seam is needed here (unlike `saved-words-policy.ts`'s `now?: () => number`) —
nothing in this module is time-stamped.

In `packages/app/src/index.ts`, add one line after the existing `nudge-policy` export (current
file, line 10):

```ts
export * from './domain/nudge-policy';
export * from './domain/quiet-site-policy';
```

Run: `cd packages/app && bunx vitest run test/quiet-site-policy.test.ts`
Expected: all 12 tests pass.

Run: `cd packages/app && bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/domain/quiet-site-policy.ts packages/app/test/quiet-site-policy.test.ts packages/app/src/index.ts
git commit -m "[A13QuietMode] feat: add quiet-site-policy domain module (A13)"
```

---

### Task 2: Wire protocol + Router — `quiet.list` / `quiet.add` / `quiet.remove`

**Files:**

- Modify: `packages/app/src/wire.ts`
- Modify: `packages/app/src/app/router.ts`
- Modify: `packages/app/test/wire-schema.test.ts`
- Modify: `packages/app/test/app/router.test.ts`

**Interfaces:**

```ts
// New WireMessageSchema arms:
{ type: 'quiet.list' }
{ type: 'quiet.add'; domain: string /* min length 1 */ }
{ type: 'quiet.remove'; domain: string /* min length 1 */ }
// New WireReplySchema arm:
{ ok: true; type: 'quiet'; domains: string[] }
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/wire-schema.test.ts`,
      inside the existing `describe('wire-schema', ...)` block, just before its closing `});`:

```ts
it('accepts quiet.list, quiet.add, quiet.remove; rejects an empty domain (A13)', () => {
  expect(WireMessageSchema.safeParse({ type: 'quiet.list' }).success).toBe(true);
  expect(WireMessageSchema.safeParse({ type: 'quiet.add', domain: 'example.com' }).success).toBe(
    true,
  );
  expect(WireMessageSchema.safeParse({ type: 'quiet.remove', domain: 'example.com' }).success).toBe(
    true,
  );
  expect(WireMessageSchema.safeParse({ type: 'quiet.add', domain: '' }).success).toBe(false);
  expect(WireMessageSchema.safeParse({ type: 'quiet.remove', domain: '' }).success).toBe(false);
});

it('accepts a quiet reply with an empty or populated domains array (A13)', () => {
  expect(WireReplySchema.safeParse({ ok: true, type: 'quiet', domains: [] }).success).toBe(true);
  expect(
    WireReplySchema.safeParse({ ok: true, type: 'quiet', domains: ['example.com'] }).success,
  ).toBe(true);
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts`
Expected: both new tests fail — `'quiet.list'`/`'quiet.add'`/`'quiet.remove'`/`'quiet'` are not
yet valid discriminant literals, so `safeParse` returns `success: false` for the first three
assertions and the reply test fails too.

Append to `packages/app/test/app/router.test.ts`, as a new top-level `describe` block right after
the existing `describe('buildRouter', ...)` block's closing `});` (end of file):

```ts
describe('quiet-site messages (A13)', () => {
  it('quiet.list on an empty store returns an empty domains array', async () => {
    const d = deps();
    const route = buildRouter(d);
    const reply = await route({ type: 'quiet.list' });
    expect(reply).toEqual({ ok: true, type: 'quiet', domains: [] });
  });

  it('quiet.add then quiet.list round-trips the domain', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route({ type: 'quiet.add', domain: 'example.com' });
    const reply = await route({ type: 'quiet.list' });
    expect(reply).toEqual({ ok: true, type: 'quiet', domains: ['example.com'] });
  });

  it('quiet.add twice for the same domain does not duplicate it in the returned list', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route({ type: 'quiet.add', domain: 'example.com' });
    const reply = await route({ type: 'quiet.add', domain: 'example.com' });
    expect(reply).toEqual({ ok: true, type: 'quiet', domains: ['example.com'] });
  });

  it('quiet.remove drops a present domain and is a no-op on an absent one', async () => {
    const d = deps();
    const route = buildRouter(d);
    await route({ type: 'quiet.add', domain: 'example.com' });
    const removed = await route({ type: 'quiet.remove', domain: 'example.com' });
    expect(removed).toEqual({ ok: true, type: 'quiet', domains: [] });
    const noop = await route({ type: 'quiet.remove', domain: 'example.com' });
    expect(noop).toEqual({ ok: true, type: 'quiet', domains: [] });
  });
});
```

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: the 4 new router tests fail too — `buildRouter`'s exhaustive switch has no `'quiet.*'`
case, so the returned promise resolves to `undefined` (no matching `case`, no `default`), which
fails every `toEqual` assertion above.

- [ ] **Step 2: Implement wire.ts.** In `packages/app/src/wire.ts`, add three new arms to
      `WireMessageSchema` (current file, appended after the `errlog.set-consent` arm, lines
      136-140):

```ts
  z.object({
    type: z.literal('errlog.set-consent'),
    state: z.enum(['granted', 'declined', 'disabled']),
  }),
  // A13: read/add/remove entries in the independent `quiet:*` keyspace (per-site quiet mode).
  // `quiet.add`/`quiet.remove` both reply with the full, updated list so the caller (card or
  // settings page) never needs a second round trip.
  z.object({ type: z.literal('quiet.list') }),
  z.object({ type: z.literal('quiet.add'), domain: z.string().min(1) }),
  z.object({ type: z.literal('quiet.remove'), domain: z.string().min(1) }),
]);
```

Add the same three literals to `MessageTypeEnum` (current file, lines 143-158), appended after
`'saved.setStatus'`:

```ts
const MessageTypeEnum = z.enum([
  'lookup',
  'lookup.cancel',
  'settings.get',
  'history.list',
  'history.clear',
  'history.delete',
  'cache.clear',
  'connection.test',
  'open-options',
  'errlog.status',
  'errlog.set-consent',
  'saved.save',
  'saved.delete',
  'saved.setStatus',
  'quiet.list',
  'quiet.add',
  'quiet.remove',
]);
```

Add one new success-reply arm to `WireReplySchema` (current file, appended after the `errlog`
reply arm, lines 176-182):

```ts
  z.object({
    ok: z.literal(true),
    type: z.literal('errlog'),
    consent: z.enum(['unset', 'granted', 'disabled']),
    pending: z.boolean(),
    count: z.number(),
  }),
  z.object({ ok: z.literal(true), type: z.literal('quiet'), domains: z.array(z.string()) }),
```

No change to `PublicSettingsSchema` or the `AssertEqual` compile-time drift-guard tuple — quiet
sites are not part of `Settings`/`PublicSettings` (design spec §2.2), so there is no domain type
for a schema to drift against; the new reply's `domains: string[]` has no matching domain type to
assert equality with, exactly like `WireReplySchema`'s existing `errlog` arm has none either.

- [ ] **Step 3: Implement router.ts.** In `packages/app/src/app/router.ts`, add three imports
      alongside the existing `saved*`/`evaluateNudge` imports (current file, lines 13-16):

```ts
  savedWordUpsert,
  savedWordDelete,
  savedWordSetStatus,
  evaluateNudge,
  quietSiteAdd,
  quietSiteRemove,
  quietSiteList,
```

Add three new cases to the exhaustive switch (current file, appended after the
`'errlog.set-consent'` case, i.e. right before the switch's closing `}` at line 286):

```ts
      case 'errlog.set-consent':
        await deps.errlog?.setConsent(msg.state);
        return { ok: true, type: 'ack' };
      case 'quiet.list':
        return { ok: true, type: 'quiet', domains: await quietSiteList({ storage: deps.kv }) };
      case 'quiet.add': {
        const domains = await deps.queue.run(() => quietSiteAdd({ storage: deps.kv }, msg.domain));
        return { ok: true, type: 'quiet', domains };
      }
      case 'quiet.remove': {
        const domains = await deps.queue.run(() =>
          quietSiteRemove({ storage: deps.kv }, msg.domain),
        );
        return { ok: true, type: 'quiet', domains };
      }
```

Writes go through `deps.queue.run(...)` (the existing `WriteQueue`) exactly like
`saved.save`/`saved.delete`/`saved.setStatus` — this serializes a concurrent `quiet.add` racing a
`quiet.remove` (e.g. the card action and the settings page firing near-simultaneously) so neither
read-modify-write clobbers the other. `quiet.list` is a pure read, no queue needed (mirrors
`history.list`). No change to `RouterDeps` — the new cases only need `deps.kv` and `deps.queue`,
both already present.

Run: `cd packages/app && bunx vitest run test/wire-schema.test.ts test/app/router.test.ts`
Expected: all tests pass (existing + 2 new wire-schema + 4 new router tests).

Run: `cd packages/app && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/wire.ts packages/app/src/app/router.ts packages/app/test/wire-schema.test.ts packages/app/test/app/router.test.ts
git commit -m "[A13QuietMode] feat: add quiet.list/quiet.add/quiet.remove wire messages + router cases (A13)"
```

---

### Task 3: `ChromeFloatingTrigger` — `quiet` property + gated `show()`

**Files:**

- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`
- Modify: `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`

**Interfaces:**

```ts
set quiet(q: boolean): void;
get quiet(): boolean;
```

- [ ] **Step 1: Write the failing tests.** Append to
      `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`, as a new
      `describe` block right after the existing `describe('ChromeFloatingTrigger ...', ...)`
      block's closing `});` (end of file):

```ts
describe('ChromeFloatingTrigger quiet mode (A13)', () => {
  it('show() with quiet=true never mounts the trigger element, but activate() still fires onClick', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.quiet = true;
    const onClick = vi.fn();
    trigger.show({ x: 10, y: 20, w: 5, h: 5 }, onClick);
    expect(host.querySelector('lookup-trigger')).toBeNull();
    expect(trigger.activate()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a mid-session quiet flip does not retroactively hide an already-visible bubble; the NEXT show() after hide() honors it', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
    expect(host.querySelector('lookup-trigger')).not.toBeNull();
    trigger.quiet = true; // flips mid-session, after the bubble is already mounted
    expect(host.querySelector('lookup-trigger')).not.toBeNull(); // not retroactively hidden
    trigger.hide();
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
    expect(host.querySelector('lookup-trigger')).toBeNull(); // the NEXT show() honors it
  });

  it('quiet defaults to false — show() mounts normally when quiet was never set', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new ChromeFloatingTrigger(host);
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, vi.fn());
    expect(host.querySelector('lookup-trigger')).not.toBeNull();
  });
});
```

Run:
`cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: the first new test fails — assigning `trigger.quiet = true` sets an unrelated ad hoc
property (no `quiet` setter exists yet), so `show()` still mounts unconditionally and
`host.querySelector('lookup-trigger')` is NOT null, failing the `toBeNull()` assertion.

- [ ] **Step 2: Implement.** In
      `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`, add a new `quiet`
      settable property, mirroring `theme`'s existing shape (current file, lines 20-27):

```ts
  /** Stored theme preference, stamped as an attribute on the bubble (set by content.ts). */
  set theme(t: Theme) {
    this._theme = t;
    this.el?.setAttribute('data-ad-theme', t);
  }
  get theme(): Theme {
    return this._theme;
  }

  private _quiet = false;

  /** A13: true when the current page's registrable domain is in the quiet-sites list. Read once
   * per show() call — a site muted while an earlier bubble is already visible does not
   * retroactively hide that bubble; the mute takes effect starting with the next selection
   * (mirrors theme's own "settings arrive after the bubble is already up" precedent above). */
  set quiet(q: boolean) {
    this._quiet = q;
  }
  get quiet(): boolean {
    return this._quiet;
  }
```

Replace `show()` (current file, lines 29-42) so it still always creates the element and wires its
click listener, but gates only the visible-mount steps:

```ts
  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.setAttribute('data-ad-theme', this._theme);
      this.el.addEventListener('lookup-click', this.handler);
      // A13: on a muted site, the element is still created and wired (so A4's activate() can
      // still click it) but never mounted to the page — no DOM node, no paint. This is
      // "visually silent" literally, not display:none, and needs no CSS/attribute at all.
      if (!this._quiet) {
        this.host.append(this.el);
        // Capture phase so pages that stopPropagation can't trap the dismissal.
        for (const t of DISMISS_EVENTS) document.addEventListener(t, this.onOutsidePress, true);
      }
    }
    if (!this._quiet) {
      this.el.style.position = 'fixed';
      this.el.style.left = `${anchor.x}px`;
      this.el.style.top = `${anchor.y + anchor.h}px`;
    }
  }
```

`activate()` and `hide()` are **unchanged**. `hide()`'s unconditional
`document.removeEventListener(t, this.onOutsidePress, true)` calls remain safe no-ops on a muted
site where the listeners were never added (`removeEventListener` on an unregistered listener is
defined to do nothing).

Run:
`cd packages/extension-chrome && bunx vitest run src/adapters/chrome-floating-trigger.test.ts`
Expected: all 12 tests pass (existing 9 + 3 new).

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/adapters/chrome-floating-trigger.ts packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts
git commit -m "[A13QuietMode] feat: add quiet property + gated show() to ChromeFloatingTrigger (A13)"
```

---

### Task 4: Content script wiring

**Files:**

- Modify: `packages/extension-chrome/src/content.ts`

No dedicated unit test exists for `content.ts` in this repo — it is a composition root, covered
by e2e only (same precedent as B5's/C2's `content.ts`/`options.ts` edits). This task's
correctness is proven by Task 8's e2e; still run the typecheck gate below so a regression in
existing behavior (save/status/nudge listeners, all in the same file) is caught immediately.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/content.ts`, add two names to the
      existing `@ai-dict/app` import (current file, lines 1-11):

```ts
import {
  runLookupWorkflow,
  InlineBottomSheetRenderer,
  DomSelectionSource,
  MessageRelayLookupClient,
  buildConsentFooter,
  createSaveReplyGuard,
  registrableDomain,
  isQuietSite,
  type SettingsStore,
  type SavedWordStatus,
  type WireReply,
} from '@ai-dict/app';
```

Add new module-level state and a refresh helper, right after the existing `trigger` construction
(current file, line 22):

```ts
const trigger = new ChromeFloatingTrigger();

// A13: this page's registrable domain, computed once — a content script is a fresh instance per
// page load, so there is no need to recompute this per selection (see design spec §2.4).
const siteDomain = registrableDomain(location.hostname);
let quietDomains: string[] = [];

function refreshQuiet(): void {
  trigger.quiet = isQuietSite(quietDomains, siteDomain);
}

/** Re-fetch the quiet-sites list and re-apply it to the trigger. Called once at startup and on
 * every chrome.storage.onChanged event (mirrors MessageRelaySettingsStore's own "any storage
 * change invalidates the cache" pattern, adapters/message-relay-settings-store.ts:8-12, rather
 * than filtering on the `quiet:index` key specifically — keeping the KV key name out of the
 * content script matches ref-kv-storage-prefixes's "adapters never interpret keys" spirit). */
function loadQuiet(): void {
  void chrome.runtime
    .sendMessage({ type: 'quiet.list' })
    .then((raw: unknown) => {
      const reply = raw as WireReply | undefined;
      if (reply?.ok && reply.type === 'quiet') {
        quietDomains = reply.domains;
        refreshQuiet();
      }
    })
    .catch(() => undefined); // SW asleep / no reply — keep the last-known (or default false) state
}
loadQuiet();
chrome.storage.onChanged.addListener(() => loadQuiet());
```

Add one new document event listener, alongside the existing `open-settings`/`toggle-save`/etc.
block (current file, lines 142-206), placed right after the `dismiss-nudge` listener (which ends
at line 192, immediately before the `open-side-panel` listener):

```ts
document.addEventListener('dismiss-nudge', () => {
  inline.dismissNudge();
});

// A13: the card's "Mute this site" header button bubbles a composed `mute-site` event with no
// payload (the composition root computes the domain, same as every other content.ts write — see
// design spec §2.3 for why this is one-directional/idempotent, no round-trip UI update needed).
document.addEventListener('mute-site', () => {
  void chrome.runtime.sendMessage({ type: 'quiet.add', domain: siteDomain }).catch(() => undefined);
});

// The card's "Open in side panel" action (Chrome only) bubbles a composed `open-side-panel`
```

(That last line is the existing comment immediately preceding the `open-side-panel` listener —
included only to make the insertion point unambiguous; do not duplicate it.)

`themedSettings`/`runLookupWorkflow` are **unchanged** — quiet mode never touches the
`Settings`/`SettingsStore` path (design spec §2.2).

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean.

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/content.ts
git commit -m "[A13QuietMode] feat: wire quiet-site check + mute-site listener into content.ts (A13)"
```

---

### Task 5: Card header action — "Mute this site"

**Files:**

- Modify: `packages/app/src/ui/styles/tokens.ts`
- Modify: `packages/app/src/ui/lookup-card.ts`
- Modify: `packages/app/test/ui/lookup-card.test.ts`

**⚠️ Hot-file notice (re-read the Global Constraints concurrency note above first):** both
`tokens.ts` and `lookup-card.ts` currently carry uncommitted changes from the in-flight A7 (Pin
cards) card in this shared worktree. The line numbers below are accurate as of this plan's
authoring (2026-07-23) — **before editing, re-open each file and confirm the insertion point by
locating the exact code string quoted in each step**, since a concurrent commit could shift lines
again before you get here.

**Interfaces:**

```ts
export const ICON_MUTE: string;
// LookupCard.actionButton's act union extended:
type Act = 'settings' | 'close' | 'side-panel' | 'mute-site';
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/lookup-card.test.ts`,
      as a new `describe` block at the end of the file (after the current last `describe('<lookup-card> — pin control (A7)', ...)` block's closing `});`):

```ts
describe('<lookup-card> mute-site header action (A13)', () => {
  it('a result state renders a mute-site button with the expected aria-label', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-act="mute-site"]')!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Mute this site');
  });

  it('clicking mute-site dispatches a composed mute-site event with no detail, then disables itself', () => {
    const el = mountCard();
    el.state = { kind: 'result', word: 'bank', target: 'vi', safeHtml: safe('<p>x</p>') };
    const handler = vi.fn();
    document.body.addEventListener('mute-site', handler);
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-act="mute-site"]')!;
    btn.click();
    document.body.removeEventListener('mute-site', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toBeUndefined();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Site muted — manage in Settings');
  });

  it('the mute-site button is present in the loading and error states too (a header action, not state-gated)', () => {
    const el = mountCard();
    expect(el.shadowRoot!.querySelector('button[data-act="mute-site"]')).not.toBeNull();
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all 3 new tests fail — no `button[data-act="mute-site"]` exists yet.

- [ ] **Step 2: Add the icon.** In `packages/app/src/ui/styles/tokens.ts`, append after the
      existing `ICON_PIN` export (current end of file):

```ts
// Mute (bell with a slash) — card bar "Mute this site" action, A13.
export const ICON_MUTE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8.5 8.2a3.5 3.5 0 017 0v3.6l2 3.4H6.5l2-3.4V8.2z"/>' +
  '<path d="M10.3 18.4a1.9 1.9 0 003.4 0"/>' +
  '<line x1="4" y1="4" x2="20" y2="20"/></svg>';
```

- [ ] **Step 3: Implement the card action.** In `packages/app/src/ui/lookup-card.ts`, add
      `ICON_MUTE` to the existing `tokens.ts` import list (current file, lines 3-13):

```ts
import {
  BASE_VARS,
  THEME_CSS,
  BRAND_MARK_SVG,
  ICON_CLOSE,
  ICON_SHIELD,
  ICON_SETTINGS,
  ICON_SIDE_PANEL,
  ICON_STAR,
  ICON_PIN,
  ICON_MUTE,
} from './styles/tokens';
```

Add the `mute-site` button to `actions` in `connectedCallback` (current file, `actions.append(`
block), between the conditional `side-panel` button and the always-present `settings`/`close`
pair:

```ts
actions.append(
  this.actionButton('mute-site', 'Mute this site', ICON_MUTE),
  this.actionButton('settings', 'Settings', ICON_SETTINGS),
  this.actionButton('close', 'Close', ICON_CLOSE),
);
```

Extend `actionButton` (current file — locate by its signature `private actionButton(`) to accept
`'mute-site'` and give its click an extra, purely-local optimistic disable (no card re-render, no
state plumbing — design spec §2.3):

```ts
  private actionButton(
    act: 'settings' | 'close' | 'side-panel' | 'mute-site',
    label: string,
    icon: string,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset['act'] = act;
    b.setAttribute('aria-label', label);
    // A native tooltip on the icon-only side-panel control (Settings carries a visible word; the
    // bare panel/close glyphs benefit from a hover title — and the handoff specifies title here).
    if (act === 'side-panel') b.title = label;
    b.innerHTML = icon; // decorative aria-hidden SVG; accessible name comes from aria-label
    // Settings carries a visible "Settings" word so it reads as a control, not a twin of the
    // bare X. aria-label still wins as the accessible name, so this never double-announces.
    if (act === 'settings') {
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = label;
      b.append(lbl);
    }
    // Each action maps to the composed event name the shell already routes:
    //  settings → open-settings; close → close; side-panel → open-side-panel;
    //  mute-site → mute-site (A13).
    const event =
      act === 'settings'
        ? 'open-settings'
        : act === 'side-panel'
          ? 'open-side-panel'
          : act === 'mute-site'
            ? 'mute-site'
            : 'close';
    b.addEventListener('click', () => {
      // A13: optimistic, local-only feedback — quietSiteAdd (domain/quiet-site-policy.ts) is
      // idempotent, so the button never needs to know if this site is already muted; it just
      // disables itself so a double-click can't fire two wire messages.
      if (act === 'mute-site') {
        b.disabled = true;
        b.setAttribute('aria-label', 'Site muted — manage in Settings');
      }
      this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
    });
    return b;
  }
```

No new CSS: the button inherits the existing generic `button[data-act]` square-icon-button rule —
the same rule `close`/`side-panel` already use with no bespoke styling of their own.

Run: `cd packages/app && bunx vitest run test/ui/lookup-card.test.ts`
Expected: all tests pass (existing suite + 3 new).

Run: `cd packages/app && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/styles/tokens.ts packages/app/src/ui/lookup-card.ts packages/app/test/ui/lookup-card.test.ts
git commit -m "[A13QuietMode] feat: add Mute this site card header action (A13)"
```

---

### Task 6: Settings page — "Quiet sites" section

**Files:**

- Modify: `packages/app/src/ui/settings-form.ts`
- Modify: `packages/app/test/ui/settings-form.test.ts`

**Interfaces:**

```ts
set quietSites(list: string[]): void;
get quietSites(): string[];
// Composed events dispatched by the form:
// 'add-quiet-site'    detail: { domain: string }
// 'remove-quiet-site' detail: { domain: string }
```

- [ ] **Step 1: Write the failing tests.** Append to `packages/app/test/ui/settings-form.test.ts`,
      as a new `describe` block at the end of the file:

```ts
describe('<settings-form> quiet sites (A13)', () => {
  it('quietSites renders one <li> per domain with a Remove button', () => {
    const el = mountForm();
    el.quietSites = ['example.com'];
    const items = el.shadowRoot!.querySelectorAll('#quiet-list li');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('example.com');
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('#quiet-list li button')).not.toBeNull();
  });

  it('an empty quietSites list renders the empty-state message', () => {
    const el = mountForm();
    el.quietSites = [];
    const ul = el.shadowRoot!.querySelector('#quiet-list')!;
    expect(ul.querySelector('.quiet-empty')).not.toBeNull();
    expect(ul.querySelectorAll('li').length).toBe(0);
  });

  it('typing a domain and clicking Add dispatches a composed add-quiet-site event with the trimmed domain, then clears the input', () => {
    const el = mountForm();
    const input = el.shadowRoot!.querySelector<HTMLInputElement>('#quiet-domain')!;
    input.value = '  example.com  ';
    const handler = vi.fn();
    el.addEventListener('add-quiet-site', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#quiet-add')!.click();
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ domain: string }>;
    expect(event.detail).toEqual({ domain: 'example.com' });
    expect(input.value).toBe('');
  });

  it('clicking Add with an empty input is a no-op (no event)', () => {
    const el = mountForm();
    const handler = vi.fn();
    el.addEventListener('add-quiet-site', handler);
    el.shadowRoot!.querySelector<HTMLButtonElement>('#quiet-add')!.click();
    expect(handler).not.toHaveBeenCalled();
  });

  it("clicking a row's Remove button dispatches remove-quiet-site with that row's domain", () => {
    const el = mountForm();
    el.quietSites = ['example.com', 'other.com'];
    const handler = vi.fn();
    el.addEventListener('remove-quiet-site', handler);
    const rows = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('#quiet-list li button');
    rows[1]!.click(); // other.com's row
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent<{ domain: string }>;
    expect(event.detail).toEqual({ domain: 'other.com' });
  });
});
```

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all 5 new tests fail — `#quiet-list`/`#quiet-domain`/`#quiet-add` don't exist yet and
`quietSites` isn't a settable property.

- [ ] **Step 2: Implement.** In `packages/app/src/ui/settings-form.ts`, add a new "Quiet sites"
      section to `MARKUP`, right after the existing "Privacy & data" `</section>` and before the
      `<div class="savebar">` (current file, between lines 212 and 213):

```html
    </section>
    <section class="sec" aria-labelledby="sec-quiet">
      <h2 class="sec-h" id="sec-quiet">Quiet sites</h2>
      <p id="quiet-help">
        The Define button never appears on these sites. The keyboard shortcut still works there.
      </p>
      <div class="keyrow">
        <input id="quiet-domain" type="text" autocomplete="off" placeholder="example.com" />
        <button type="button" id="quiet-add">Add</button>
      </div>
      <ul id="quiet-list" class="quiet-list"></ul>
    </section>
    <div class="savebar">
```

Add new CSS, appended to the `CSS` template literal right before the closing `` `[hidden]{display:none}` `` line (current file, end of `CSS` constant):

```css
#quiet-help {
  margin: 7px 0 12px;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
.quiet-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.quiet-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: var(--ad-surface-sunken);
  border: 1px solid var(--ad-line);
  border-radius: 8px;
  font-size: var(--adp-text-sm);
  color: var(--ad-ink);
}
.quiet-list button {
  padding: 5px 11px;
  font-size: var(--adp-text-xs);
}
.quiet-empty {
  margin: 0;
  font-size: var(--adp-text-xs);
  color: var(--ad-ink-faint);
}
```

Add a new private field + settable property to the `SettingsForm` class, alongside the existing
`_errorReporting` field (current file, lines 230-248):

```ts
  private _keyFromEnv = false;
  private _errorReporting = false;
  private _provider: Provider = 'gemini';
  private _keys: Record<Provider, string> = { gemini: '', openai: '', anthropic: '' };
  private _envelopeEdited = false;
  private _konamiProgress = 0;
  private _devUnlocked = false;
  private readonly _onKonamiKey = (e: KeyboardEvent): void => this.handleKonamiKey(e);
  private _dirty = false;
  // A13: the current quiet-sites list, fetched by the composition root over `quiet.list` and
  // re-set after every add/remove reply. Deliberately absent from SettingsFormValue/collect() —
  // quiet sites persist via their own quiet.add/quiet.remove wire round trip, not the settings
  // save flow (design spec §2.2/§2.3), mirroring errorReporting's own exclusion below.
  private _quietSites: string[] = [];

  set quietSites(list: string[]) {
    this._quietSites = list;
    if (this.shadowRoot) this.renderQuietList();
  }
  get quietSites(): string[] {
    return this._quietSites;
  }
```

Add a new private render method, alongside the class's other private helpers (e.g. right after
`resetEnvelope`):

```ts
  private renderQuietList(): void {
    const ul = this.q<HTMLUListElement>('#quiet-list');
    ul.replaceChildren();
    if (this._quietSites.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'quiet-empty';
      empty.textContent = 'No muted sites yet.';
      ul.append(empty);
      return;
    }
    for (const domain of this._quietSites) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = domain;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Unmute ${domain}`);
      remove.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent<{ domain: string }>('remove-quiet-site', {
            detail: { domain },
            bubbles: true,
            composed: true,
          }),
        );
      });
      li.append(label, remove);
      ul.append(li);
    }
  }
```

Wire the "Add" button in `connectedCallback`, alongside the other direct listeners (near
`#reset-tpl`, current file lines 322-324), plus render the initial (empty) list once on connect —
right after the existing `this.q<HTMLInputElement>('#error-reporting').checked = this._errorReporting;`
line at the very end of `connectedCallback`:

```ts
this.q<HTMLButtonElement>('#reset-tpl').addEventListener('click', () =>
  this.restoreDefaultTemplate(),
);
```

(insert the new listener right after the block above, still inside `connectedCallback`):

```ts
this.q<HTMLButtonElement>('#quiet-add').addEventListener('click', () => {
  const input = this.q<HTMLInputElement>('#quiet-domain');
  const domain = input.value.trim();
  if (domain.length === 0) return;
  this.dispatchEvent(
    new CustomEvent<{ domain: string }>('add-quiet-site', {
      detail: { domain },
      bubbles: true,
      composed: true,
    }),
  );
  input.value = '';
});
```

And at the very end of `connectedCallback` (after
`this.q<HTMLInputElement>('#error-reporting').checked = this._errorReporting;`):

```ts
    this.q<HTMLInputElement>('#error-reporting').checked = this._errorReporting;
    this.renderQuietList();
  }
```

No change to `SettingsFormValue`, `collect()`, or `set value()` — quiet sites never ride the main
save event.

Run: `cd packages/app && bunx vitest run test/ui/settings-form.test.ts`
Expected: all tests pass (existing suite + 5 new).

Run: `cd packages/app && bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/app/src/ui/settings-form.ts packages/app/test/ui/settings-form.test.ts
git commit -m "[A13QuietMode] feat: add Quiet sites section to settings-form (A13)"
```

---

### Task 7: Composition root — wire quiet-sites into `options.ts`

**Files:**

- Modify: `packages/extension-chrome/src/options.ts`

No dedicated unit test exists for `options.ts` (composition root, e2e-covered only — same
precedent as Task 4 and as C2's `options.ts` edit). This task's correctness is proven by Task 8's
e2e; still run the typecheck gate below.

- [ ] **Step 1: Implement.** In `packages/extension-chrome/src/options.ts`, inside `mountSettings`
      (current file, lines 84-111), fetch the quiet-sites list once on mount and wire the two new
      form events, right after the existing `error-reporting-change` listener block and before the
      trailing `if (status) form.setStatus(status);`:

```ts
function mountSettings(initial: Settings, status?: string): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  wireSettings(form);
  // Error-reporting consent lives in errlog KV (separate from settings). Reflect + control it here.
  void send({ type: 'errlog.status' }).then((r) => {
    if (r.ok && r.type === 'errlog') form.errorReporting = r.consent === 'granted';
  });
  form.addEventListener('error-reporting-change', (e) => {
    const { enabled } = (e as CustomEvent<{ enabled: boolean }>).detail;
    void send({ type: 'errlog.set-consent', state: enabled ? 'granted' : 'disabled' }).then(
      (r) =>
        form.setStatus(
          r.ok
            ? enabled
              ? 'Error reporting enabled'
              : 'Error reporting disabled'
            : 'Could not update error reporting',
          r.ok ? 'ok' : 'error',
        ),
      () => form.setStatus('Could not update error reporting', 'error'),
    );
  });
  // A13: fetch + wire the quiet-sites list (independent of the settings save flow, design spec
  // §2.2/§3.9).
  void send({ type: 'quiet.list' }).then((r) => {
    if (r.ok && r.type === 'quiet') form.quietSites = r.domains;
  });
  form.addEventListener('add-quiet-site', (e) => {
    const { domain } = (e as CustomEvent<{ domain: string }>).detail;
    void send({ type: 'quiet.add', domain }).then(
      (r) => {
        if (r.ok && r.type === 'quiet') {
          form.quietSites = r.domains;
          form.setStatus(`Muted ${domain}`);
        } else form.setStatus('Could not mute that site', 'error');
      },
      () => form.setStatus('Could not mute that site', 'error'),
    );
  });
  form.addEventListener('remove-quiet-site', (e) => {
    const { domain } = (e as CustomEvent<{ domain: string }>).detail;
    void send({ type: 'quiet.remove', domain }).then(
      (r) => {
        if (r.ok && r.type === 'quiet') {
          form.quietSites = r.domains;
          form.setStatus(`Unmuted ${domain}`);
        } else form.setStatus('Could not unmute that site', 'error');
      },
      () => form.setStatus('Could not unmute that site', 'error'),
    );
  });
  if (status) form.setStatus(status);
}
```

`wireSettings`, `mountOnboarding`, `toFormValue`, `load`, `send`, `download` are the existing
helpers/functions in this file — unchanged.

Run: `cd packages/extension-chrome && bun run typecheck`
Expected: clean.

- [ ] **Step 2: Commit** — gate, then commit:

```
cd packages/app && bun run typecheck && cd ../extension-chrome && bun run typecheck && cd ../.. && bun run lint && bun run format:check
```

```
git add packages/extension-chrome/src/options.ts
git commit -m "[A13QuietMode] feat: wire quiet-sites list into the settings composition root (A13)"
```

---

### Task 8: e2e coverage

**Files:**

- Create: `packages/extension-chrome/e2e/a13-per-site-quiet-mode.spec.ts`

- [ ] **Step 1: Write the spec.** Create
      `packages/extension-chrome/e2e/a13-per-site-quiet-mode.spec.ts`:

```ts
import { test, expect } from './fixtures';
import {
  seedSettings,
  mockGemini,
  gotoFixture,
  selectWord,
  openTrigger,
  getServiceWorker,
  relayCommand,
} from './helpers';

/** Read the `quiet:index` raw JSON value via the service worker (only extension contexts have
 * the `chrome` global — the content page's main world does not, same reasoning as
 * saved-word.spec.ts's swStorageDump). */
async function quietIndex(
  sw: Awaited<ReturnType<typeof getServiceWorker>>,
): Promise<string | undefined> {
  const dump = (await sw.evaluate(() => chrome.storage.local.get('quiet:index'))) as Record<
    string,
    string
  >;
  return dump['quiet:index'];
}

test.describe('A13 per-site quiet mode', () => {
  test('a muted site never shows the trigger bubble on selection', async ({
    context,
    extensionId,
  }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['test.fixture']) }),
    );

    const page = await context.newPage();
    await gotoFixture(page);
    await page.waitForTimeout(1_000); // let content.ts's loadQuiet() resolve before selecting
    await selectWord(page, 't', 'bank');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('the A4 keyboard shortcut still fires a lookup on a muted site with no bubble ever visible', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['test.fixture']) }),
    );

    const page = await context.newPage();
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);

    await relayCommand(sw, 'define-selection');
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });
  });

  test('the card\'s "Mute this site" action mutes the current site; the next selection stays silent', async ({
    context,
    extensionId,
  }) => {
    await mockGemini(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);

    const page = await context.newPage();
    await gotoFixture(page, 'The river bank is steep here.');
    await page.waitForTimeout(1_000);
    await selectWord(page, 't', 'river bank');
    await openTrigger(page);
    await expect(page.locator('bottom-sheet lookup-card')).toContainText('financial institution', {
      timeout: 10_000,
    });

    await page.locator('bottom-sheet lookup-card button[data-act="mute-site"]').click();

    const sw = await getServiceWorker(context);
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['test.fixture']));

    // content.ts's chrome.storage.onChanged listener re-fetches asynchronously; give it a beat.
    await page.waitForTimeout(500);
    await selectWord(page, 't', 'steep');
    await page.waitForTimeout(300);
    await expect(page.locator('lookup-trigger')).toHaveCount(0);
  });

  test('settings page lists, removes, and adds quiet sites', async ({ context, extensionId }) => {
    const sw = await getServiceWorker(context);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'quiet:index': JSON.stringify(['example.com', 'other.com']) }),
    );

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await seedSettings(options);
    await options.reload();
    await options.waitForSelector('settings-form');

    const rows = options.locator('settings-form #quiet-list li');
    await expect(rows).toHaveCount(2);

    await options
      .locator('settings-form #quiet-list li', { hasText: 'other.com' })
      .locator('button')
      .click();
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['example.com']));

    await options.locator('settings-form #quiet-domain').fill('third.com');
    await options.locator('settings-form #quiet-add').click();
    await expect.poll(() => quietIndex(sw)).toBe(JSON.stringify(['example.com', 'third.com']));
  });
});
```

Run:

```
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a13-per-site-quiet-mode
```

Expected: 4 passed.

- [ ] **Step 2: Commit** — gate, then commit:

```
GEMINI_API_KEY= bun run build:chrome
bun run lint && bun run format:check
```

```
git add packages/extension-chrome/e2e/a13-per-site-quiet-mode.spec.ts
git commit -m "[A13QuietMode] feat: add per-site quiet mode e2e coverage (A13)"
```

---

## Final gate (run once, after Task 8, before opening the PR)

```
cd packages/app && bun run typecheck
cd ../extension-chrome && bun run typecheck
cd ../..
bun run test
bun run lint
bun run format:check
GEMINI_API_KEY= bun run build:chrome
cd packages/extension-chrome && bunx playwright test a13-per-site-quiet-mode keyboard-commands saved-word settings options-actions
```

Expected: typecheck clean on both packages; the full Vitest suite green (including every new test
added across Tasks 1, 2, 3, 5, 6); lint/format clean; the Chrome build succeeds with the env key
cleared; the new `a13-per-site-quiet-mode.spec.ts` passes, and the regression guards
(`keyboard-commands` for A4, `saved-word` for the card header/B1 star row, `settings`/
`options-actions` for the settings page) all still pass.

## PR

- [ ] Open the PR:
  - Title: `[A13QuietMode] Per-site quiet mode`
  - Regular merge commit — **squash prohibited** (owner ruling 2026-07-16).
  - Jira ticket link per the repo convention: `https://prospa.atlassian.net/browse/A13QuietMode`
    (branch-suffix-derived; correct if an actual Jira ticket ID exists for this card instead).
  - Body includes a **"Testing performed"** section (owner ruling 2026-07-16 — no
    screenshots/video for this PR; no `pr-assets/*` branch) listing:
    - Unit: `bun run test` — full suite green, including the new `quiet-site-policy.test.ts`
      (Task 1), the `quiet.*` additions to `wire-schema.test.ts`/`router.test.ts` (Task 2), the
      `quiet` mode additions to `chrome-floating-trigger.test.ts` (Task 3), the mute-site header
      action tests in `lookup-card.test.ts` (Task 5), and the "Quiet sites" section tests in
      `settings-form.test.ts` (Task 6).
    - Typecheck: `packages/app` and `packages/extension-chrome`, both clean.
    - Lint + format: clean.
    - e2e: `a13-per-site-quiet-mode.spec.ts` (4 new scenarios) + regression guards
      (`keyboard-commands`, `saved-word`, `settings`, `options-actions`) — all green, built with
      `GEMINI_API_KEY=` cleared.
  - Design choices (≤3 bullets, per this repo's PR-writing convention): registrable-domain
    granularity (not path-level); independent `quiet:` keyspace (not a `Settings` field, since
    content scripts cannot write settings over the wire); the trigger element is always
    created/wired even when muted, so A4's keyboard shortcut keeps working with no bubble ever
    painted.
