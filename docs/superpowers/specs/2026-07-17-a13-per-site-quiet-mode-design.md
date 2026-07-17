# A13 — Per-site quiet mode

Roadmap card: `docs/ROADMAP.md` §4 A13 (Impact 2 · Effort S · Score 2.0, lines 277-286).
Depends on: A4 (nice-to-have, for the "still works" path — A4 is shipped, `docs/ROADMAP.md:108-124`).
No `docs/ROADMAP.md` §8 escalation exists for this card — its own line reads **"Escalate: none"**
(`docs/ROADMAP.md:286`), so nothing is quoted/re-opened here. The per-card block in
`.okra/runs/spec-all-cards-2026-07-17/DISPATCH-NOTES.md` ("A13 per-site-quiet-mode") is a Shaman
pin binding this spec — match granularity = registrable domain is taken as given; this document's
job is to state the exact rule, and to pin the remaining open choices the roadmap card lists under
**"Lead decides: match granularity (domain vs. path)."**

## 1. Problem (grounded in code)

Today the Define trigger bubble shows on **every** text selection, on **every** site, with no way
to opt a site out:

- `runLookupWorkflow`'s selection handler calls `deps.trigger.show(e.anchor, onClick)`
  unconditionally on every `SelectionSource.onSelection` firing
  (`packages/app/src/domain/workflow.ts:123-138`) — there is no site check anywhere in the
  pipeline between "text got selected" and "bubble appears."
- `ChromeFloatingTrigger.show()` (`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts:31-45`)
  unconditionally creates the `<lookup-trigger>` element, appends it to `this.host` (`document.body`
  by default, `chrome-floating-trigger.ts:37`), and wires the capture-phase outside-press dismiss
  listeners (`chrome-floating-trigger.ts:38-39`) — every call is a real, visible mount.
- There is no per-site concept anywhere in the domain layer. `packages/app/src/domain/types.ts`'s
  `Settings`/`PublicSettings` (164-217) hold only global preferences (`targetLang`, `theme`,
  `cacheEnabled`, …) — nothing scoped to a hostname. `packages/app/src/ports.ts:71-76`'s `Storage`
  port is a single flat KV; `ref-kv-storage-prefixes` (`.c3/refs/ref-kv-storage-prefixes.md:15`)
  lists the reserved prefixes today — `cache:`, `history:`, `saved:`, `nudge:` — none of which is
  site-scoped.
- On code editors, Gmail, and dashboards — the exact "select constantly" surfaces the card names —
  every mouseup that yields a non-empty selection (`packages/app/src/app/dom-selection-source.ts:15-31`,
  `defaultReader`) pops the bubble. Nothing today distinguishes those pages from reading material.

The payoff line is explicit about the shape of the fix: **"Chosen sites go visually silent; the A4
shortcut still works there, so lookup stays possible — just never uninvited"**
(`docs/ROADMAP.md:283-284`). That is two separate requirements that must both hold at once:

1. The trigger bubble must never visibly appear on a muted site.
2. The A4 `define-selection` keyboard shortcut — which today re-clicks whatever trigger bubble is
   currently showing (`ChromeFloatingTrigger.activate()`, `chrome-floating-trigger.ts:52-59`, calling
   `this.el?.shadowRoot?.querySelector('button')`) — must still be able to fire a lookup on a muted
   site, with **no visible bubble ever having appeared**.

Those two facts together rule out the naive fix ("skip `trigger.show()` entirely when muted") — see
§2.4.

## 2. Design questions (the card's "Lead decides" list, pinned)

### 2.1 Match granularity: registrable domain, computed with a naive last-two-labels heuristic

**Pinned** (Shaman pin, DISPATCH-NOTES A13 block): match granularity is the **registrable
domain** — muting `docs.google.com` silences the button on `mail.google.com` too, and path-level
matching is rejected.

**Why path-level is rejected:** the card's own framing is "per-site," not "per-page" — the payoff
promises muted sites "go visually silent" as a unit (`docs/ROADMAP.md:283`), and the motivating
examples (Gmail, dashboards, code editors) are exactly the single-page-app style of site where a
user visits one hostname under thousands of distinct paths/hashes in a session. A path-level rule
would force the reader to re-mute on every navigation — the opposite of "never uninvited," and
functionally indistinguishable from not having the feature. Domain-level is also the only
granularity CONTRACTS' concurrency map anticipates other quiet-mode consumers reusing (§2.5 below).

**The exact rule (new pure function, `registrableDomain`, §3.1):** given a URL or bare hostname,
resolve it to a `hostname` via `new URL(...)` (falling back to the raw trimmed string if that
throws — e.g. an already-bare hostname with no scheme), then:

- An IPv4 literal (`/^\d{1,3}(\.\d{1,3}){3}$/`) is returned as-is (an IP is not a domain with a
  registrable suffix; slicing it into labels would produce a meaningless string).
- Otherwise, split on `.`; if there are ≤ 2 labels, return the hostname unchanged (`localhost`,
  single-label intranet hosts); otherwise return the **last two labels** joined by `.`
  (`docs.google.com` → `google.com`; `www.example.com` → `example.com`).

**Known, accepted limitation — no public-suffix list.** This repo has no PSL dependency and adding
one would be disproportionate to an Effort-S card with zero server/build budget for it (constraint
1, `docs/ROADMAP.md:81-82` — 100% local, no new heavy dependency). The naive rule mis-splits
multi-label public suffixes: `foo.co.uk` and `bar.co.uk` would both normalize to `co.uk` and
therefore collide (muting one mutes the other). This is a **false-positive-only** failure (it can
only make the button disappear on MORE sites than the user asked for, never fewer) — the safer of
the two possible failure directions for an "unwanted popup" feature, and a rare case in practice
(reading material rarely lives under a `.co.uk`/`.com.au`-style compound suffix's own apex domain).
Rejected alternative: exact-hostname matching (no last-two-labels collapse at all) — correct in
every case but reintroduces the "mute every subdomain individually" friction path-level matching
was rejected for; the Shaman pin explicitly asks for registrable-domain semantics over that.

### 2.2 Storage location: an independent `quiet:` keyspace, not a `Settings` field

**Pinned:** quiet sites live in their own KV keyspace (`quiet:index`), exactly like `saved:*` and
`nudge:*` — **not** as a new field on `Settings`/`PublicSettings`.

**Why not a `Settings` field:** the decisive fact is `MessageRelaySettingsStore.set()`
(`packages/extension-chrome/src/adapters/message-relay-settings-store.ts:25-34`), which is a
**deliberate, hard-coded rejection**: _"The content side MUST NOT write settings over the wire.
Settings are edited on the options page."_ — `set()` always returns a rejected promise. A13 needs
exactly the write path that comment forbids: the card's own "add-current-site affordance" (§2.3)
must let a content script (which alone knows the current page's hostname) persist a mute, and
`content.ts` is a content script. Piggy-backing quiet sites on `Settings` would mean either (a)
weakening that S1-adjacent content-script write ban specifically to smuggle this one field through
— an ad hoc carve-out with no ADR, the same category of shortcut C2's design spec §2 rejected for a
different field — or (b) inventing a second, `Settings`-bypassing write path anyway, which is
exactly the "own keyspace" design below, just with the array physically nested one level deeper for
no benefit. An independent keyspace sidesteps the prohibition entirely: it was never a `settings.*`
message to begin with.

**Why not per-domain keys (`quiet:<domain>`) mirroring `saved:<word>`:** `saved-words-policy.ts`
uses per-item keys because it needs O(1) single-word reads (`savedWordGet`) and per-word deletes at
scale (hundreds of entries). Quiet-site membership has no such access pattern — every check is
"is this ONE domain anywhere in the WHOLE list," and the list is expected to be small (a handful to
low dozens of muted sites, not hundreds). A single flat key holding the whole JSON array —
`quiet:index`, no per-domain keys, no cap — is the simpler, sufficient design, closer in spirit to
`errlog:consent` (`packages/app/src/app/error-reporter.ts:12-14`) than to `saved:*`'s per-item
index. This still "respects `ref-kv-storage-prefixes`" (`.c3/refs/ref-kv-storage-prefixes.md:15`,
"the domain owns reserved key prefixes"): `quiet:` is a new reserved prefix, owned by the new
`quiet-site-policy.ts` domain module, and no adapter interprets it.

### 2.3 Where the mute control lives: settings list (view/manage) + a one-way "Mute this site" card action (add-current-site)

**Pinned — two surfaces, asymmetric by design:**

1. **Settings list UI** (`settings-form.ts`, a new "Quiet sites" section): the authoritative,
   bulk view — see every muted domain, remove any of them, or type one in by hand. This is the
   **only** way to unmute.
2. **"Mute this site" card action** (`lookup-card.ts`, a new header icon button, always present):
   a one-click, one-directional "stop showing me this" affordance fired from the exact moment the
   annoyance is felt — right after Define popped up somewhere the reader didn't want it.

**Rejected: a trigger context-menu.** The card's own dispatch note offers this as an option. It is
rejected because there is no existing context-menu plumbing anywhere in this codebase (no
`contextMenus` permission in `manifest.json:13`, no `chrome.contextMenus` call in any adapter) —
adding one is a **new manifest permission** for a single Effort-S action, which the scope fence
(§4) explicitly forbids paying for here.

**Rejected: a toggle button that reflects current mute state.** A toggle needs to know "is the
CURRENT site muted right now" wherever it renders, which means plumbing a `quiet: boolean` into
`ResultRenderContext`/`CardState` (mirroring `saved`, `status`) and keeping it live — real
additional surface for a card whose only job is "get me out of this list." A **static, always-shown,
idempotent "Mute this site" action** needs none of that: `quietSiteAdd` (§3.1) is already a no-op
when the domain is already muted, so a second click on an already-muted site is harmless. The
button optimistically disables itself after one click (§3.5) so a double-click can't fire the wire
message twice, but it never has to ask "am I already muted" first.

**Why unmute is deliberately NOT available from the card:** muting is an in-the-moment escape
("this is annoying, make it stop **here**"); unmuting is a considered, low-frequency action ("I
changed my mind about this site") that benefits from seeing the whole list for context (was this
the site I meant? are there others I forgot about?). Symmetric one-click mute/unmute on the card
would need the state-plumbing this design deliberately avoids (previous paragraph). This mirrors an
existing asymmetry in the codebase: A8's "Show literal word" is a one-shot override with no
"un-override" button either (`packages/app/src/domain/workflow.ts:103-113`) — some actions are
cheap enough to be one-directional by design.

**Why the side panel does not get a "Mute this site" button:** the header action lives inside
`LookupCard`'s own shadow DOM (`lookup-card.ts:505-595`), which `packages/app/src/ui/
side-panel-view.ts` never instantiates — it imports only the pure `renderCardState` function and
`ICON_SETTINGS` (`side-panel-view.ts:4`) and builds its own chrome. The new button therefore only
ever renders on the in-page inline card (`InlineBottomSheetRenderer`, constructed with
`document.body` in `content.ts:20`), which is exactly the one context that has a real
`location.hostname` to mute. This needs no gating logic — it falls out of the existing split between
`<lookup-card>` (in-page) and `side-panel-view.ts` (its own renderer) for free.

### 2.4 A4 keyboard shortcut still works on a muted site: the trigger element exists and is wired, just never mounted

**The naive fix is wrong.** If quiet mode simply skipped calling `deps.trigger.show(...)` on muted
sites, `ChromeFloatingTrigger`'s `this.el` would stay `null` forever on that site, and
`activate()`'s `this.el?.shadowRoot?.querySelector('button')` (`chrome-floating-trigger.ts:53`)
would always be `null` — A4's `define-selection` would silently no-op on every muted site,
directly breaking the card's own explicit requirement ("A4 shortcut still works there,"
`docs/ROADMAP.md:284`).

**The fix that actually satisfies both requirements at once**, grounded in one fact:
`LookupTrigger`'s shadow root and its `<button>` are built in the **constructor**
(`packages/app/src/ui/lookup-trigger.ts:26-51`, `attachShadow` at line 28), not in
`connectedCallback`. A custom element's constructor runs the instant `document.createElement(...)`
is called, **whether or not the element is ever inserted into the document** — so
`this.el.shadowRoot.querySelector('button')` is populated immediately, with no dependency on
`this.host.append(this.el)` ever running.

**Pinned:** `ChromeFloatingTrigger` gains a settable `quiet: boolean` property (mirroring the
existing `theme` property's shape, `chrome-floating-trigger.ts:22-29`). `show()` still always
creates `this.el`, sets its `data-ad-theme` attribute, and wires the `lookup-click` listener
(`this.el.addEventListener('lookup-click', this.handler)`) exactly as today — that is what makes
`activate()` keep working. The only change is that **when `quiet` is true, `show()` skips**:
`this.host.append(this.el)` (nothing is ever mounted to the page — no DOM node, no paint, no
layout, satisfying "visually silent" literally, not just via CSS `display:none`), the capture-phase
outside-press dismiss listeners (nothing visible to dismiss), the `position`/`left`/`top` styling,
and the `TRIGGER_SHOWN_MARK` performance mark (A15's instrumentation of "the bubble became visible"
— a muted site never makes it visible, so the mark must not fire there; see §9 Concurrency for why
this line is cited against A15's in-flight edit). A4's `activate()` then clicks a real, fully-wired,
but never-mounted `<lookup-trigger>` button — the click fires `runLookup` exactly as it would from a
visible bubble.

**Known, accepted limitation:** `quiet` is read once per `show()` call; if a site is muted via the
card's own "Mute this site" action while a bubble from an earlier (pre-mute) selection is still
visibly mounted, that specific bubble instance is not retroactively hidden — the mute takes effect
starting with the next selection. This mirrors the existing precedent for `theme` (`chrome-floating-
trigger.ts:22-26`'s doc comment: "settings arrive after the bubble is already up" is an accepted,
already-tested case) and needs no special handling.

### 2.5 Highlighting (B3) interplay: no code to touch today; the reusable surface is the exported `isQuietSite`/`registrableDomain` pair

`docs/superpowers/specs/2026-07-16-b3-re-encounter-highlighting-design.md:115` already records the
gap this spec closes: _"A13 quiet-mode interplay N/A (A13 not [authored yet])."_ B3 has a spec but
**no implementation exists yet** (`grep -rn` across `packages/extension-chrome/src` and
`packages/app/src` for a highlighting/scanner module returns nothing) — there is no B3 file for this
spec to modify. Nothing in this plan touches B3.

**What this spec does instead, so B3 does not have to re-derive the quiet-site check when it
lands:** `registrableDomain` and `isQuietSite` (§3.1) are exported from the package barrel
(`packages/app/src/index.ts`) as plain, dependency-free domain functions — exactly the shape a
future B3 content-script scanner needs (`isQuietSite(domains, location.hostname)` against a
`quiet.list`-fetched array, the same two calls `content.ts` itself makes in §3.4). This spec makes
no promise about how B3 will consume them (that is B3's own future design question), only that the
primitives already exist in the right layer when B3 is authored.

## 3. The change

### 3.1 New domain module — `packages/app/src/domain/quiet-site-policy.ts`

New file, mirroring `saved-words-policy.ts`'s shape (`packages/app/src/domain/saved-words-policy.ts`)
and `ref-kv-storage-prefixes`'s "domain owns the prefix" pattern:

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

### 3.2 `packages/app/src/index.ts` — barrel export

Add one line, in the same position other per-feature domain policy modules occupy (after
`nudge-policy`, `index.ts:10`):

```ts
export * from './domain/nudge-policy';
export * from './domain/quiet-site-policy';
```

### 3.3 Wire protocol — `packages/app/src/wire.ts`

Three new message arms in `WireMessageSchema` (appended after the `errlog.set-consent` arm,
`wire.ts:136-140`, mirroring how `saved.*` was appended after the initial block rather than
alphabetically inserted):

```ts
// A13: read/add/remove entries in the independent `quiet:*` keyspace (per-site quiet mode).
// `quiet.add`/`quiet.remove` both reply with the full, updated list so the caller (card or
// settings page) never needs a second round trip.
z.object({ type: z.literal('quiet.list') }),
z.object({ type: z.literal('quiet.add'), domain: z.string().min(1) }),
z.object({ type: z.literal('quiet.remove'), domain: z.string().min(1) }),
```

`MessageTypeEnum` (`wire.ts:143-158`, used only to type the `type` field of a failure reply) gains
the same three literals, appended after `'saved.setStatus'`:

```ts
  'saved.setStatus',
  'quiet.list',
  'quiet.add',
  'quiet.remove',
]);
```

One new success-reply arm in `WireReplySchema` (appended after the `errlog` reply arm,
`wire.ts:176-182`):

```ts
z.object({ ok: z.literal(true), type: z.literal('quiet'), domains: z.array(z.string()) }),
```

No change to `PublicSettingsSchema` (`wire.ts:61-68`) or the `AssertEqual` compile-time drift-guard
tuple (`wire.ts:203-209`) — quiet sites are not part of `Settings`/`PublicSettings` (§2.2), so there
is no domain type for a schema to drift against; the new reply's `domains: string[]` has no
matching domain type to assert equality with, exactly like `WireReplySchema`'s existing `errlog`
arm (`consent`/`pending`/`count`) has none either.

### 3.4 Router — `packages/app/src/app/router.ts`

Import the three new functions alongside the existing `saved*`/`evaluateNudge` imports
(`router.ts:13-16`):

```ts
  savedWordUpsert,
  savedWordDelete,
  savedWordSetStatus,
  evaluateNudge,
  quietSiteAdd,
  quietSiteRemove,
  quietSiteList,
```

Three new cases in the exhaustive switch (`router.ts:213-287`), appended after `'errlog.set-consent'`
(no `default:` — TypeScript's exhaustiveness check on `WireMessage` is what keeps this safe; adding
these three cases is what makes the switch compile again once the three new arms exist on the
`WireMessage` union):

```ts
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

Writes go through `deps.queue.run(...)` (the existing `WriteQueue`, `router.ts:29-39`) exactly like
`saved.save`/`saved.delete`/`saved.setStatus` (`router.ts:242-266`) — this serializes a concurrent
`quiet.add` racing a `quiet.remove` (e.g., the card action and the settings page firing near-
simultaneously) so neither read-modify-write clobbers the other. `quiet.list` is a pure read, no
queue needed (mirrors `history.list`, `router.ts:221-222`).

No change to `RouterDeps` (`router.ts:41-71`) — the new cases only need `deps.kv` and `deps.queue`,
both already present.

### 3.5 `ChromeFloatingTrigger` — `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`

New `quiet` settable property, mirroring `theme`'s existing shape (`chrome-floating-trigger.ts:22-29`):

```ts
  private _quiet = false;

  /** A13: true when the current page's registrable domain is in the quiet-sites list. Read
   * once per show() call — see the design spec §2.4's "known, accepted limitation." */
  set quiet(q: boolean) {
    this._quiet = q;
  }
  get quiet(): boolean {
    return this._quiet;
  }
```

`show()` (current file, lines 31-45 — this file already carries an in-flight, uncommitted A15 edit
at line 44 as of this spec's authoring; see §9 Concurrency) changes to gate the visible-mount steps
on `this._quiet`, while unconditionally still creating the element and wiring its click listener:

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
      requestAnimationFrame(() => performance.mark(TRIGGER_SHOWN_MARK));
    }
  }
```

`activate()` (`chrome-floating-trigger.ts:52-59`) and `hide()` (`chrome-floating-trigger.ts:61-67`)
are **unchanged**. `hide()`'s unconditional `document.removeEventListener(t, this.onOutsidePress,
true)` calls remain safe no-ops on a muted site where the listeners were never added (`removeEvent-
Listener` on an unregistered listener is defined to do nothing).

### 3.6 Content script — `packages/extension-chrome/src/content.ts`

Import two new names from `@ai-dict/app` (added to the existing import block, `content.ts:1-11`):
`registrableDomain`, `isQuietSite`.

New module-level state and a small refresh helper, placed after the existing `trigger`
construction (`content.ts:22`):

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

One new document event listener, alongside the existing `open-settings`/`toggle-save`/etc. block
(`content.ts:142-206`), placed after `dismiss-nudge`:

```ts
// A13: the card's "Mute this site" header button bubbles a composed `mute-site` event with no
// payload (the composition root computes the domain, same as every other content.ts write — see
// design spec §2.3 for why this is one-directional/idempotent, no round-trip UI update needed).
document.addEventListener('mute-site', () => {
  void chrome.runtime.sendMessage({ type: 'quiet.add', domain: siteDomain }).catch(() => undefined);
});
```

`themedSettings`/`runLookupWorkflow` (`content.ts:28-116`) are **unchanged** — quiet mode never
touches the `Settings`/`SettingsStore` path (§2.2).

### 3.7 New icon — `packages/app/src/ui/styles/tokens.ts`

New exported constant, appended after `ICON_STAR` (`tokens.ts:211-215`), same style (stroked,
`currentColor`, `aria-hidden`):

```ts
// Mute (bell with a slash) — card bar "Mute this site" action, A13.
export const ICON_MUTE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8.5 8.2a3.5 3.5 0 017 0v3.6l2 3.4H6.5l2-3.4V8.2z"/>' +
  '<path d="M10.3 18.4a1.9 1.9 0 003.4 0"/>' +
  '<line x1="4" y1="4" x2="20" y2="20"/></svg>';
```

### 3.8 Card header action — `packages/app/src/ui/lookup-card.ts`

Import `ICON_MUTE` alongside the other icon imports (`lookup-card.ts:3-12`).

`connectedCallback` (`lookup-card.ts:508-550`): add the new button to `actions`, between the
conditional `side-panel` button and the always-present `settings`/`close` pair
(`lookup-card.ts:519-527`):

```ts
const actions = document.createElement('span');
actions.className = 'actions';
if (this.hasAttribute('side-panel')) {
  actions.append(this.actionButton('side-panel', 'Open in side panel', ICON_SIDE_PANEL));
}
actions.append(
  this.actionButton('mute-site', 'Mute this site', ICON_MUTE),
  this.actionButton('settings', 'Settings', ICON_SETTINGS),
  this.actionButton('close', 'Close', ICON_CLOSE),
);
```

`actionButton` (`lookup-card.ts:552-581`): extend the `act` union and the event-name mapping, and
give the mute-site click an extra, purely-local optimistic disable (no card re-render, no state
plumbing — §2.3):

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
    if (act === 'side-panel') b.title = label;
    b.innerHTML = icon;
    if (act === 'settings') {
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = label;
      b.append(lbl);
    }
    // Each action maps to the composed event name the shell already routes:
    //  settings -> open-settings; close -> close; side-panel -> open-side-panel;
    //  mute-site -> mute-site (A13).
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

No new CSS: the button inherits the existing generic `button[data-act]` square-icon-button rule
(`lookup-card.ts:101-104`) — the same rule `close`/`side-panel` already use with no bespoke styling
of their own.

### 3.9 Settings page — `packages/app/src/ui/settings-form.ts`

New markup: a "Quiet sites" `<section class="sec">`, added after the existing "Privacy & data"
section and before the closing `</div></form>` (markup block, current file's `sec-priv` section):

```html
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
```

New CSS, appended near the other list-adjacent rules (reuses existing token variables only):

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

New class state + a settable `quietSites` property, alongside `_errorReporting`
(`settings-form.ts:174-186`'s field block) — persists independently of `SettingsFormValue`/
`collect()`, exactly mirroring `errorReporting`'s own documented exclusion (`settings-form.ts:417-
421`: _"wired to the errlog consent store... NOT the settings save flow"_):

```ts
  private _quietSites: string[] = [];

  /**
   * A13: the current quiet-sites list, fetched by the composition root over `quiet.list` and
   * re-set after every add/remove reply. Deliberately absent from SettingsFormValue/collect() —
   * quiet sites persist via their own quiet.add/quiet.remove wire round trip, not the settings
   * save flow (design spec §2.2/§2.3), mirroring errorReporting's own exclusion above.
   */
  set quietSites(list: string[]) {
    this._quietSites = list;
    if (this.shadowRoot) this.renderQuietList();
  }
  get quietSites(): string[] {
    return this._quietSites;
  }
```

New private render method + wiring, alongside `renderDevPanel`/other private helpers:

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

`connectedCallback` (`settings-form.ts:189-347`): wire the "Add" button, alongside the other
`relay`/direct listeners (near `#reset-tpl`, `settings-form.ts:322-324`), plus render the initial
(empty) list once on connect:

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
this.renderQuietList();
```

No change to `SettingsFormValue` (`settings-form.ts:27-40`), `collect()` (`settings-form.ts:563-
580`), or `set value()` (`settings-form.ts:582-611`) — quiet sites never ride the main save event.

### 3.10 Composition root — `packages/extension-chrome/src/options.ts`

`mountSettings` (`options.ts:84-111`): fetch the list once on mount and wire the two new events,
alongside the existing `errlog.status` fetch (`options.ts:92-94`):

```ts
function mountSettings(initial: Settings, status?: string): void {
  const form = document.createElement('settings-form') as unknown as SettingsForm;
  if (KEY_FROM_ENV) form.keyFromEnv = true;
  (form as unknown as HTMLElement).setAttribute('data-ad-theme', initial.theme);
  app.replaceChildren(form);
  (form as unknown as { value: SettingsFormValue }).value = toFormValue(initial);
  wireSettings(form);
  void send({ type: 'errlog.status' }).then((r) => {
    if (r.ok && r.type === 'errlog') form.errorReporting = r.consent === 'granted';
  });
  form.addEventListener('error-reporting-change', (e) => {
    /* unchanged */
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

`wireSettings`, `mountOnboarding`, `toFormValue`, `load`, `send`, `download` (`options.ts:45-207`)
are **unchanged**.

### 3.11 No change to the following files

- `packages/app/src/domain/workflow.ts` — the selection→lookup pipeline is completely untouched;
  quiet mode is a pure visibility gate at the `ChromeFloatingTrigger` layer (§2.4/§3.5), never a
  gate on whether a lookup can run.
- `packages/app/src/app/inline-bottom-sheet-renderer.ts`, `packages/app/src/ui/side-panel-view.ts`,
  `packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts` — the mute action is a
  header button on `<lookup-card>` only (§2.3/§3.8); nothing about how the card's _content_ renders
  or mirrors to the side panel changes.
- `packages/app/src/domain/types.ts`, `PublicSettingsSchema`/`Settings`/`PublicSettings` — quiet
  sites are not a settings field (§2.2); no domain type changes.
- `packages/extension-chrome/src/manifest.json` — no new permission; `chrome.storage` (already
  granted, `manifest.json:13`) is all this card needs, same as every other KV-backed feature.
- `packages/app/src/app/dom-selection-source.ts` — selection capture is unaffected; A15's in-flight
  `SELECTION_FIRED_MARK` addition there is unrelated and untouched by this card.
- `packages/extension-safari/**` — see §4 scope fence.

## 4. Scope fence (from the card, held exactly)

- **Site list + toggle only** (`docs/ROADMAP.md:285`) — no auto-detection of "annoying" sites, no
  machine-learned quiet suggestions, no per-path override. Held: the only inputs to the quiet
  decision are (a) the stored `quiet:index` list and (b) the current page's registrable domain
  (§2.1); nothing else influences it.
- **Depends on A4 for the "still-works" path, not as a hard gate** — A4 is already shipped
  (`docs/ROADMAP.md:110`); §2.4/§3.5 is what keeps `ChromeFloatingTrigger.activate()` working on a
  muted site without any change to `command-messages.ts` or the A4 relay path in `sw.ts:189-196`/
  `content.ts:208-226` — those files are untouched by this plan.
- **No new manifest permission** — §3.11; a context-menu control was explicitly rejected in §2.3
  for exactly this reason.
- **Design tokens only** — §3.9's new CSS and §3.7's new icon read/derive from `--ad-*`/`--adp-*`
  tokens exclusively; no hard-coded color, no new `prefers-color-scheme` branch.
- **100% local** (constraint 1) — the entire feature is a KV list plus two small UI surfaces; no
  network call, no server, no account.
- **Constraint 4 (no background LLM calls)** — quiet mode never touches the lookup/token path at
  all; it only ever gates a UI element's visibility.
- **S1/S4** — not implicated: quiet-site domains are page metadata the extension already reads
  (`location.hostname`) via `<all_urls>` host permission already granted; no API key or model
  output is anywhere near this feature.

## 5. Testing strategy

1. **Unit — `packages/app/test/quiet-site-policy.test.ts`** (new): `registrableDomain` collapses
   `docs.google.com`/`www.example.com` to their last two labels, passes through `localhost` and a
   bare 2-label host unchanged, passes through an IPv4 literal unchanged, and accepts both a bare
   hostname and a full `https://...` URL as input. `quietSiteAdd` persists a new domain and returns
   the sorted list; adding an already-present domain is a no-op (list unchanged, no duplicate).
   `quietSiteRemove` on a present/absent domain; `quietSiteList` reflects the current state.
   `isQuietSite` true/false against a fetched list, including the domain-normalization case (a
   hostname with a `www.` prefix still matches a stored bare domain).
2. **Unit — `packages/app/test/wire-schema.test.ts`**: `WireMessageSchema` accepts `quiet.list`
   (no payload), `quiet.add`/`quiet.remove` with a non-empty `domain`, and rejects an empty-string
   `domain` (the `.min(1)` guard). `WireReplySchema` accepts `{ ok:true, type:'quiet', domains: [] }`.
3. **Unit — `packages/app/test/app/router.test.ts`**: `quiet.list` on an empty store returns `{
domains: [] }`; `quiet.add` then `quiet.list` round-trips; `quiet.add` twice for the same domain
   does not duplicate it in the returned list; `quiet.remove` drops a present domain and is a no-op
   on an absent one.
4. **Unit — `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts`**: with
   `trigger.quiet = true` set before `show()`, the `<lookup-trigger>` element is never appended to
   the host (`host.querySelector('lookup-trigger')` stays `null`) AND `activate()` still returns
   `true` and fires `onClick` — the two-part contract from §2.4, asserted together so a regression
   in either half fails the test. A mid-session quiet flip (`trigger.quiet = true` after an
   already-visible `show()`) does NOT retroactively hide the current bubble (§3.5's documented
   limitation) but the NEXT `show()` after a `hide()` honors it.
5. **Unit — `packages/app/test/ui/lookup-card.test.ts`**: the `mute-site` header button is present
   with `aria-label="Mute this site"` for a `result` state; clicking it dispatches a composed
   `mute-site` event (no detail payload) and disables itself with the updated aria-label; a second
   click cannot fire a second event (button is disabled).
6. **Unit — `packages/app/test/ui/settings-form.test.ts`**: `quietSites = ['example.com']` renders
   one `<li>` with the domain text and a `Remove` button; an empty list renders the empty-state
   `<p>`; typing a domain and clicking `#quiet-add` dispatches a composed `add-quiet-site` event
   with the trimmed `{domain}` detail and clears the input; an empty input is a no-op (no event);
   clicking a row's `Remove` dispatches `remove-quiet-site` with that row's domain.
7. **e2e — new `packages/extension-chrome/e2e/a13-per-site-quiet-mode.spec.ts`**:
   - Seed `quiet:index` for `test.fixture` before navigating; select a word; assert
     `lookup-trigger` never attaches (`page.locator('lookup-trigger')` stays absent after the
     selection, checked with a bounded wait rather than an indefinite one).
   - Same muted setup; use `relayCommand(sw, 'define-selection')` (the A4 simulator) and assert the
     lookup card still renders the result — proving the shortcut fires with no bubble ever visible.
   - Unmuted site: select a word, click the card's "Mute this site" button, assert
     `quiet:index` in storage now contains `test.fixture`'s domain, then trigger a fresh selection
     and assert the bubble no longer attaches (the next `show()` after the mute honors it, per §3.5).
   - Settings page: seed `quiet:index` with two domains, open options, assert both render in the
     list, remove one via its row button, assert storage now holds only the other, add a third by
     typing + clicking Add, assert storage holds all three.

## 6. Testing performed (PR evidence — replaces screenshot/video capture)

Per this worktree's `CLAUDE.md` (owner ruling 2026-07-16): **no screenshots or video for this PR.**
The PR body's "Testing performed" section lists the suites run, counts, and e2e scenarios exercised
— matching §5 above (gates: lint, format check, typecheck for both `@ai-dict/app` and
`@ai-dict/extension-chrome`, the full unit suite, and the new + regression-guard e2e specs). No
`pr-assets/*` branch is created for this card.

## 7. Risk / rollback

- **Risk: low.** The feature is additive at every layer — a new domain module, three new wire
  arms appended (not inserted) into existing schemas, three new router cases appended to an
  exhaustive switch, one new settable property + a conditional inside one existing method
  (`ChromeFloatingTrigger.show()`), one new content-script event listener, one new card header
  button, and one new settings-form section. No existing behavior branches on quiet-site state
  except the trigger's own visibility gate, and that gate defaults to `false` (`_quiet = false`,
  `chrome-floating-trigger.ts`) — an empty `quiet:index` list means the feature is a no-op and every
  site behaves exactly as it does today.
- **Correctness-sensitive spot:** §3.5's `show()` gating is the one place a bug could silently
  break the two-part A4 contract (§2.4) — either by hiding the bubble AND breaking `activate()`
  (regressing the card's explicit requirement) or by failing to hide it at all (feature does
  nothing). Directly covered by unit test #4 in §5, which asserts both halves together.
- **No data migration.** `quiet:index` is a brand-new key; there is nothing to migrate from and no
  existing key it could collide with (`ref-kv-storage-prefixes`'s prefix table, REPO-FACTS.md §9,
  has no `quiet:` entry today).
- **Rollback:** revert the single PR. `quiet:index` becomes an orphaned, harmless key in
  `chrome.storage.local` (matching A9's own "old cache entries simply miss — acceptable, it's a
  cache" precedent for harmless post-revert KV residue); no other stored data is touched.

## 8. Files touched (summary)

| File                                                                     | Change                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `packages/app/src/domain/quiet-site-policy.ts`                           | **New** — `registrableDomain`, `quietSiteAdd/Remove/List`, `isQuietSite`             |
| `packages/app/test/quiet-site-policy.test.ts`                            | **New** — unit tests (§5.1)                                                          |
| `packages/app/src/index.ts`                                              | + barrel export                                                                      |
| `packages/app/src/wire.ts`                                               | + 3 `WireMessageSchema` arms, + `MessageTypeEnum` entries, + 1 `WireReplySchema` arm |
| `packages/app/test/wire-schema.test.ts`                                  | + schema tests (§5.2)                                                                |
| `packages/app/src/app/router.ts`                                         | + 3 imports, + 3 switch cases                                                        |
| `packages/app/test/app/router.test.ts`                                   | + router tests (§5.3)                                                                |
| `packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`      | + `quiet` property, `show()` gated                                                   |
| `packages/extension-chrome/src/adapters/chrome-floating-trigger.test.ts` | + adapter tests (§5.4)                                                               |
| `packages/extension-chrome/src/content.ts`                               | + quiet-check wiring, + `mute-site` listener                                         |
| `packages/app/src/ui/styles/tokens.ts`                                   | + `ICON_MUTE`                                                                        |
| `packages/app/src/ui/lookup-card.ts`                                     | + `mute-site` header action                                                          |
| `packages/app/test/ui/lookup-card.test.ts`                               | + card tests (§5.5)                                                                  |
| `packages/app/src/ui/settings-form.ts`                                   | + "Quiet sites" section, `quietSites` property                                       |
| `packages/app/test/ui/settings-form.test.ts`                             | + form tests (§5.6)                                                                  |
| `packages/extension-chrome/src/options.ts`                               | + fetch/wire quiet-sites in `mountSettings`                                          |
| `packages/extension-chrome/e2e/a13-per-site-quiet-mode.spec.ts`          | **New** — e2e (§5.7)                                                                 |

No change to `packages/app/src/domain/workflow.ts`, `packages/app/src/domain/types.ts`,
`packages/app/src/app/inline-bottom-sheet-renderer.ts`, `packages/app/src/ui/side-panel-view.ts`,
`packages/extension-chrome/src/adapters/chrome-side-panel-mirror.ts`,
`packages/extension-chrome/src/sw.ts`, `packages/extension-chrome/src/command-messages.ts`,
any manifest file, `docs/index.html`, or `packages/extension-safari/**`.

## 9. Concurrency

Per CONTRACTS §5, files this card modifies that other unshipped cards in this batch also modify:

- **`packages/extension-chrome/src/adapters/chrome-floating-trigger.ts`** — the pre-listed
  "content-script/trigger" hot group (`A5 A6 A13 A14 A15 B3 B4`). This file **already carries an
  uncommitted edit as of this spec's authoring** (A15's `TRIGGER_SHOWN_MARK` perf-mark call inside
  `show()`, confirmed via `git diff` in this worktree) — §3.5's diff is written against that current
  state; whoever implements this plan must re-read the file first and re-anchor the exact line
  numbers if A15 (or A6/A14) has landed first, since all of them touch `show()`.
- **`packages/extension-chrome/src/content.ts`** — same hot group; A5/A6/A14/A15/B3/B4 all wire
  something near the selection→trigger→render flow. This plan's edits (§3.6) are additive (new
  top-level consts + one new `document.addEventListener` block) and should merge cleanly, but the
  orchestrator should serialize actual implementation against whichever of those cards lands
  concurrently.
- **`packages/app/src/ui/settings-form.ts`** — the pre-listed "settings-form" hot group
  (`A5 A9 A13 B6 C9`). This plan adds one new, self-contained section (§3.9); low collision risk
  with A5/A9's likely edits (different sections) but still the same file.
- **`packages/app/src/wire.ts` / `packages/app/src/app/router.ts`** — the pre-listed "wire+router
  (any card adding messages)" group. This plan appends 3 new arms/cases; per CONTRACTS §2 the
  orchestrator serializes any two cards that both touch these files in the same window.
- **Not pre-listed, flagged here:** this spec also modifies **`packages/app/src/ui/lookup-card.ts`**
  and **`packages/app/src/ui/styles/tokens.ts`**, which CONTRACTS §5's hot-file map lists only under
  the "lookup-card UI" group (`A1 A2 A3 A5 A7 A10`) — A13 is not in that list. Both edits here are
  small and additive (one new header button, one new icon constant) but the orchestrator should be
  aware A13 is a de facto ninth consumer of that hot file, not just the eight already named.
