---
bundle: "06"
title: extension-safari
status: AVAILABLE
locked_by: ""
locked_at: ""
done_at: ""
prereqs: ["02", "03", "04"]
owns_files:
  - packages/extension-safari/package.json
  - packages/extension-safari/tsconfig.json
  - packages/extension-safari/vitest.config.ts
  - packages/extension-safari/esbuild.config.mjs
  - packages/extension-safari/src/manifest.json
  - packages/extension-safari/src/sw.ts
  - packages/extension-safari/src/inbound.ts
  - packages/extension-safari/src/router.ts
  - packages/extension-safari/src/global.d.ts
  - packages/extension-safari/src/content.ts
  - packages/extension-safari/src/options.html
  - packages/extension-safari/src/options.ts
  - packages/extension-safari/src/adapters/**
  - packages/extension-safari/test/**
  - packages/extension-safari/e2e/ios-simulator-checklist.md
  - packages/extension-safari/xcode/**
---

# Bundle 06 — extension-safari/ (Safari iOS Web Extension + Xcode wrapper)

**Purpose:** Mirror of the Chrome extension for Safari iOS, using `browser.storage.local`, no `sidePanel` (inline `<bottom-sheet>` is the only surface), Safari `browser_specific_settings`. Includes the **iOS-app-only** Xcode wrapper that loads `dist/`, and the mandatory manual iOS Simulator checklist (no automated E2E — Apple exposes no WebDriver for iOS Safari Web Extensions, so adapter coverage is elevated to compensate).

## Lock protocol
Verify prereqs `02`, `03`, `04` all `DONE`. Flip YAML → LOCKED, commit `[06] lock`, rebase, abort on race. Execute. (May run in parallel with Bundle 05 — disjoint files.)

## Inputs
- Bundles 02/03/04 DONE (same shared contracts as Chrome).
- Spec §5.5 (Safari differences), §6.* flows (shared), §7.3 S1/S3/S6/S8, §8.1 (manual iOS tier), §8.2 (90% coverage — no e2e net), §8.10 (ios checklist outline).

## Outputs
- `manifest.json`: no `sidePanel`; `permissions:["storage"]`; `host_permissions:["<all_urls>","https://generativelanguage.googleapis.com/*"]`; `browser_specific_settings`; strict CSP.
- `sw.ts` + `buildRouter(deps)`, `content.ts` composition root — Safari analogues of the Chrome flows (no side-panel mirror).
- Adapters: `dom-selection-source`, `safari-floating-trigger`, `safari-storage-store`, `safari-kv-store`, `message-relay-lookup-client`, `message-relay-settings-store` (over `browser.storage.local`).
- `options.html/.ts` (full Settings incl. key, direct storage).
- `xcode/`: iOS app target only (App Store wrapper) loading `packages/extension-safari/dist/`; `MARKETING_VERSION` placeholder wired for `release:bump`. **No macOS target.**
- `e2e/ios-simulator-checklist.md` per §8.10 outline.
- `esbuild.config.mjs` → `dist/` (web-ext code; loadable unpacked / syncable into Xcode).

## Definition of Done
- D1: `buildRouter(deps)` unit-tested with fakes: lookup happy path, cache hit, NO_KEY, cancellation suppression, toggles.
- D2: Each adapter unit-tested with hand-rolled fakes over a `browser.storage.local`-like slice (constructor injection); `ext/test ⇏ sibling adapters` honored.
- D3: **[S1]** content side receives `PublicSettings` only; key never crosses the wire; SW strips key on `settings.get`.
- D4: **[S3]** sender check enforced; no `externally_connectable`.
- D5: `manifest.json` matches §7.3 S8 Safari permissions exactly (no `sidePanel`, no `scripting`); CSP per S5; `browser_specific_settings` present.
- D6: `esbuild` emits loadable `dist/`; bundle sizes within §8.7 (content ≤45KB, sw ≤30KB, options ≤40KB gz).
- D7: Xcode project builds the iOS target referencing `dist/` (build verified on macOS in release flow — Bundle 07; here, project structure + sync script exist and are documented).
- D8: `ios-simulator-checklist.md` covers all 12 steps of §8.10.
- D9: Coverage ≥ 90% (spec §8.2 — elevated, no e2e safety net).

## Implementation steps

> Internal dependency order: package setup + manifest → storage adapters → relay adapters → DOM adapters → router (`buildRouter`) → SW listener (sender guard) → composition roots (content/options) → esbuild build → Xcode wrapper + sync script → iOS Simulator checklist → coverage gate. Run filtered: `pnpm --filter @ai-dict/extension-safari test`. All unit/adapter tests run under **happy-dom**; router/listener tests are pure (no `browser` global — every browser slice is constructor-injected per §8.4).
>
> **Platform facts (verified — do not "fix" back):**
> 1. **`browser.*` is native on Safari.** Safari Web Extensions implement the promise-based `browser` namespace natively; the `webextension-polyfill` *runtime* is a Chrome shim and is **not** bundled here (keeps us inside the §8.7 size budgets, S7). We depend only on `@types/webextension-polyfill` (dev) for the `Browser` type and declare the native global in `src/global.d.ts`.
> 2. **`browser_specific_settings.safari`** accepts `strict_min_version` / `strict_max_version` (strings). We pin `strict_min_version: "16.4"` (spec §8.6 compat: Safari iOS 16.4+).
> 3. **No `sidePanel`.** iOS Safari has no side-panel API — the inline `<bottom-sheet>` is the *only* surface (spec decision #2 / §5.5). There is no `ChromeSidePanelMirror` analogue and no `side_panel.html`; the content renderer is the bare `InlineBottomSheetRenderer`.
>
> **Shared-code note (duplication is deliberate).** `src/router.ts` (`buildRouter`/`WriteQueue`/`SUPPRESS`), `src/adapters/dom-selection-source.ts`, and the two relay adapters are **platform-agnostic** — byte-for-byte identical to Bundle 05's, except the storage/relay *defaults* reference `browser.*` instead of `chrome.*` (the injected slices are typed against `Browser.*`). They are reproduced here (not imported from `extension-chrome`) because the two extensions are independent leaf packages — **06 must not depend on 05**, and 06's prereqs are only 02/03/04. Bundle 07 adds a CI guard diffing the two `router.ts` copies. *If a third consumer ever appears, hoist the router + DOM selection source into a shared package; today two copies beat a premature abstraction or a cross-leaf dependency.*

### Task A — Package setup + manifest (CSP/permissions/`browser_specific_settings` early)

**Files:** `package.json`, `tsconfig.json`, `src/global.d.ts`, `vitest.config.ts`, `esbuild.config.mjs`, `src/manifest.json`.

- [ ] **A1: `packages/extension-safari/package.json`** (no Playwright — Safari has no WebDriver; no polyfill runtime dep)

```json
{
  "name": "@ai-dict/extension-safari",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "node esbuild.config.mjs",
    "xcode:sync": "bash xcode/sync-dist.sh"
  },
  "dependencies": {
    "@ai-dict/core": "workspace:*",
    "@ai-dict/shared-ui": "workspace:*",
    "@ai-dict/adapters-shared": "workspace:*"
  },
  "devDependencies": {
    "@types/webextension-polyfill": "^0.12.0",
    "esbuild": "^0.24.0",
    "happy-dom": "^15.0.0"
  }
}
```
Then `pnpm install`.

- [ ] **A2: `packages/extension-safari/src/global.d.ts`** (type the native `browser` global without bundling the polyfill)

```ts
import type { Browser } from 'webextension-polyfill';

declare global {
  // Safari implements the promise-based `browser` namespace natively; we only borrow its type.
  // eslint-disable-next-line no-var
  var browser: Browser;
}

export {};
```

- [ ] **A3: `packages/extension-safari/tsconfig.json`** (DOM; no `"types":["chrome"]` — `browser` typing comes from `global.d.ts`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "test"]
}
```
> No `types` array → all installed `@types/*` (incl. `webextension-polyfill`, `happy-dom`'s ambient globals via vitest) resolve normally; `global.d.ts` is picked up through `include`.

- [ ] **A4: `packages/extension-safari/vitest.config.ts`** (happy-dom + **90%** gate — §8.2, elevated because there is no e2e net)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension-safari',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/adapters/**', 'src/router.ts', 'src/inbound.ts'],
      exclude: ['src/content.ts', 'src/options.ts', 'src/sw.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```
> The testable layer is `adapters + router + inbound` (the pure boundary classifier). `sw.ts` is **import-time browser wiring** (constructs adapters over `browser.storage.local`, registers `onMessage`) — it cannot be imported under happy-dom without a `browser` global, so the pure `classifyInbound` lives in its own `src/inbound.ts` (Task F) and `sw.ts` joins the composition roots in the exclude list. On Safari those wiring files' only verification is the **manual iOS Simulator checklist** (§8.10), so the unit threshold on the testable layer is raised to 90% to compensate (spec §8.2).

- [ ] **A5: `packages/extension-safari/src/manifest.json`** (MV3 — §7.3 S8 Safari list + S5 CSP + `browser_specific_settings`, **verbatim**)

```json
{
  "manifest_version": 3,
  "name": "AI Dictionary",
  "version": "0.0.0",
  "description": "Stay-in-page dictionary lookup powered by your own Gemini API key.",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>", "https://generativelanguage.googleapis.com/*"],
  "browser_specific_settings": {
    "safari": { "strict_min_version": "16.4" }
  },
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }
  ],
  "action": { "default_title": "AI Dictionary" },
  "options_page": "options.html",
  "content_security_policy": {
    "extension_pages": "default-src 'none'; script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none';"
  }
}
```
> Differences from Chrome's manifest: **`permissions: ["storage"]`** only (no `sidePanel` — S8), **no `side_panel` key**, **`browser_specific_settings.safari` added**. Still no `"scripting"` (content scripts statically registered — S8) and no `"externally_connectable"` (S3). `version` is rewritten by Bundle 07's `release:bump` (which also updates the Xcode `MARKETING_VERSION`).

- [ ] **A6: `esbuild.config.mjs`** (3 entry points → `dist/`; copy manifest + options.html — no side-panel)

```js
import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const common = { bundle: true, minify: true, sourcemap: false, target: ['safari16'], logLevel: 'info' };

await esbuild.build({ ...common, entryPoints: ['src/sw.ts'],      outfile: 'dist/sw.js',      format: 'esm' });
await esbuild.build({ ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' });
await esbuild.build({ ...common, entryPoints: ['src/options.ts'], outfile: 'dist/options.js', format: 'esm' });

await copyFile('src/manifest.json', 'dist/manifest.json');
await copyFile('src/options.html',  'dist/options.html');
```
> `content.js` is `iife` (content scripts are not ES modules); `target: 'safari16'` matches the 16.4 floor. The native `browser` global is referenced, never imported — esbuild leaves it as a free global (correct for Safari).

- [ ] **A7: typecheck (fails until sources land) + incremental commit of config**

```bash
git add packages/extension-safari/package.json packages/extension-safari/tsconfig.json packages/extension-safari/src/global.d.ts packages/extension-safari/vitest.config.ts packages/extension-safari/esbuild.config.mjs packages/extension-safari/src/manifest.json pnpm-lock.yaml
git commit -m "feat(extension-safari): package setup + MV3 manifest (browser_specific_settings, no sidePanel)"
```

### Task B — Storage adapters (`SafariKvStore`, `SafariStorageStore`)

**Files:** `src/adapters/safari-kv-store.ts`, `src/adapters/safari-storage-store.ts`, `test/safari-kv-store.test.ts`, `test/safari-storage-store.test.ts`.

> Structurally identical to Bundle 05's `ChromeKvStore`/`ChromeStorageStore` — the only change is the injected slice type (`Browser.Storage.StorageArea`) and the `browser.storage.local` default in the SW composition root. The fake `StorageArea` in tests already returns promises, so the bodies are unchanged.

- [ ] **B1: Failing test** `test/safari-kv-store.test.ts` (Storage contract; `keys()` returns full keys for core's `*Clear`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { SafariKvStore } from '../src/adapters/safari-kv-store';

function fakeArea(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: vi.fn(async (key?: string | null) => {
      if (key === null || key === undefined) return Object.fromEntries(store);
      return store.has(key) ? { [key]: store.get(key) } : {};
    }),
    set: vi.fn(async (obj: Record<string, string>) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); }),
    remove: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

describe('SafariKvStore (Storage over browser.storage.local; no adapter prefix)', () => {
  it('round-trips getItem/setItem/removeItem with the exact key', async () => {
    const area = fakeArea();
    const kv = new SafariKvStore(area);
    await kv.setItem('cache:index', '[]');
    expect(await kv.getItem('cache:index')).toBe('[]');
    expect(area.set).toHaveBeenCalledWith({ 'cache:index': '[]' });
    await kv.removeItem('cache:index');
    expect(await kv.getItem('cache:index')).toBeNull();
  });

  it('keys(prefix) returns FULL keys (so core cacheClear/historyClear can removeItem them)', async () => {
    const kv = new SafariKvStore(fakeArea({ 'cache:index': '[]', 'cache:ab': '{}', 'history:index': '[]', settings: '{}' }));
    expect((await kv.keys('cache:')).sort()).toEqual(['cache:ab', 'cache:index']);
    expect(await kv.keys('history:')).toEqual(['history:index']);
    expect((await kv.keys()).length).toBe(4);
  });
});
```

- [ ] **B2: Implement** `src/adapters/safari-kv-store.ts`

```ts
import type { Storage } from '@ai-dict/core';
import type { Browser } from 'webextension-polyfill';

type StorageAreaLike = Pick<Browser.Storage.StorageArea, 'get' | 'set' | 'remove'>;

// Thin Storage over browser.storage.local. NO adapter-side prefix: core's cache-/history-policy
// own the `cache:` / `history:` namespaces themselves (§02), so a single instance backs both.
export class SafariKvStore implements Storage {
  constructor(private readonly area: StorageAreaLike) {}

  async getItem(key: string): Promise<string | null> {
    const got = (await this.area.get(key)) as Record<string, string | undefined>;
    return got[key] ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }
  async removeItem(key: string): Promise<void> {
    await this.area.remove(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = (await this.area.get(null)) as Record<string, unknown>;
    const ks = Object.keys(all);
    return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks;
  }
}
```
Run → PASS.

- [ ] **B3: Failing test** `test/safari-storage-store.test.ts` (**[S1]** `get()` strips `apiKey`; `set()` merges non-secret fields) — same assertions as 05 B3, `SafariStorageStore` substituted.

```ts
import { describe, it, expect, vi } from 'vitest';
import { SafariStorageStore } from '../src/adapters/safari-storage-store';
import { DEFAULT_TEMPLATE } from '@ai-dict/core';

function fakeArea(seed?: unknown) {
  let stored = seed;
  return {
    get: vi.fn(async () => (stored === undefined ? {} : { settings: stored })),
    set: vi.fn(async (obj: { settings: unknown }) => { stored = obj.settings; }),
    remove: vi.fn(),
    _peek: () => stored,
  };
}

describe('SafariStorageStore (SettingsStore; S1 key isolation)', () => {
  it('get() returns PublicSettings only — apiKey is never exposed', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'tpl', apiKey: 'AIza-secret', cacheEnabled: true, saveHistory: true, hasKey: true });
    const pub = await new SafariStorageStore(area).get();
    expect(pub).toEqual({ targetLang: 'vi', promptTemplate: 'tpl', hasKey: true });
    expect('apiKey' in pub).toBe(false);
  });

  it('get() derives hasKey + fills defaults when unset', async () => {
    const empty = await new SafariStorageStore(fakeArea(undefined)).get();
    expect(empty).toEqual({ targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false });
  });

  it('set() merges only targetLang/promptTemplate, preserving apiKey + toggles', async () => {
    const area = fakeArea({ targetLang: 'vi', promptTemplate: 'old', apiKey: 'AIza', cacheEnabled: false, saveHistory: true, hasKey: true });
    await new SafariStorageStore(area).set({ promptTemplate: 'new' });
    expect(area._peek()).toMatchObject({ promptTemplate: 'new', apiKey: 'AIza', cacheEnabled: false });
  });
});
```

- [ ] **B4: Implement** `src/adapters/safari-storage-store.ts` (identical body to 05 B4 with the `Browser` slice type)

```ts
import { DEFAULT_TEMPLATE, type SettingsStore, type PublicSettings, type Settings } from '@ai-dict/core';
import type { Browser } from 'webextension-polyfill';

type StorageAreaLike = Pick<Browser.Storage.StorageArea, 'get' | 'set' | 'remove'>;

const DEFAULT_TARGET = 'vi';
function defaults(): Settings {
  return { targetLang: DEFAULT_TARGET, promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };
}

export class SafariStorageStore implements SettingsStore {
  constructor(private readonly area: StorageAreaLike) {}

  private async read(): Promise<Settings | undefined> {
    const { settings } = (await this.area.get('settings')) as { settings?: Settings };
    return settings;
  }

  async get(): Promise<PublicSettings> {
    const s = await this.read();
    return {
      targetLang: s?.targetLang ?? DEFAULT_TARGET,
      promptTemplate: s?.promptTemplate ?? DEFAULT_TEMPLATE,
      hasKey: Boolean(s?.apiKey),
    };
  }

  async set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void> {
    const base = (await this.read()) ?? defaults();
    await this.area.set({ settings: { ...base, ...patch } });
  }
}
```
Run → PASS. Commit `feat(extension-safari): storage adapters (kv + settings, S1 strip)`.

### Task C — Relay adapters (content side; **[S1]** key never crosses the wire)

**Files:** `src/adapters/message-relay-lookup-client.ts`, `src/adapters/message-relay-settings-store.ts`, + tests.

> Identical to Bundle 05 Task C. `RuntimeLike` is `{ sendMessage(message): Promise<unknown> }` — `browser.runtime.sendMessage` is natively promise-based on Safari, so it satisfies the interface directly (no callback wrapping). The settings-store's default `subscribe` uses `browser.storage.onChanged`.

- [ ] **C1: Failing test** `test/message-relay-lookup-client.test.ts` — same three cases as 05 C1 (posts `{type:'lookup',req,requestId}` + unwraps; rethrows error reply as a `LookupError`-shaped `Error`; on `signal` abort sends `{type:'lookup.cancel',requestId}`). Copy verbatim from 05 C1.

- [ ] **C2: Implement** `src/adapters/message-relay-lookup-client.ts` (verbatim from 05 C2)

```ts
import type { LookupClient, LookupRequest, LookupResult, WireReply, LookupError } from '@ai-dict/core';
import { mapError } from '@ai-dict/core';

export interface RuntimeLike { sendMessage(message: unknown): Promise<unknown>; }

function rejectWith(e: LookupError): never { throw Object.assign(new Error(e.message), e); }

export class MessageRelayLookupClient implements LookupClient {
  constructor(
    private readonly runtime: RuntimeLike,
    private readonly genId: () => string = () => crypto.randomUUID(),
  ) {}

  async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
    const requestId = this.genId();
    if (opts?.signal) {
      opts.signal.addEventListener(
        'abort',
        () => { void this.runtime.sendMessage({ type: 'lookup.cancel', requestId }); },
        { once: true },
      );
    }
    const reply = (await this.runtime.sendMessage({ type: 'lookup', req, requestId })) as WireReply;
    if (reply.ok && reply.type === 'lookup') return reply.result;
    if (!reply.ok) rejectWith(reply.error);
    rejectWith(mapError({ kind: 'parse' })); // unexpected reply shape
  }
}
```
Run → PASS.

- [ ] **C3: Failing test** `test/message-relay-settings-store.test.ts` — same three cases as 05 C3 (caches `PublicSettings`; invalidates on storage change; `set()` rejects). Copy verbatim from 05 C3.

- [ ] **C4: Implement** `src/adapters/message-relay-settings-store.ts` (the **only** delta from 05: the default `subscribe` uses `browser.storage.onChanged`)

```ts
import type { SettingsStore, PublicSettings, WireReply } from '@ai-dict/core';
import type { RuntimeLike } from './message-relay-lookup-client';

export class MessageRelaySettingsStore implements SettingsStore {
  private cache: PublicSettings | null = null;

  constructor(
    private readonly runtime: RuntimeLike,
    subscribe: (invalidate: () => void) => void = (cb) => browser.storage.onChanged.addListener(cb),
  ) {
    subscribe(() => { this.cache = null; });
  }

  async get(): Promise<PublicSettings> {
    if (this.cache) return this.cache;
    const reply = (await this.runtime.sendMessage({ type: 'settings.get' })) as WireReply;
    if (reply.ok && reply.type === 'settings') {
      this.cache = reply.settings;
      return reply.settings;
    }
    throw new Error('settings.get failed');
  }

  set(): Promise<void> {
    return Promise.reject(new Error('Settings are edited on the options page, not over the content wire.'));
  }
}
```
Run → PASS. Commit `feat(extension-safari): content relay adapters (lookup + settings)`.

### Task D — DOM adapters (`DomSelectionSource`, `SafariFloatingTrigger`)

**Files:** `src/adapters/dom-selection-source.ts`, `src/adapters/safari-floating-trigger.ts`, + tests. (No side-panel mirror — iOS has no sidePanel.)

- [ ] **D1: `src/adapters/dom-selection-source.ts` + test** — **byte-identical to Bundle 05 Task D1/D2** (`extractSentence` + `DomSelectionSource`; pure DOM, no `browser`/`chrome` reference). Copy both the test and implementation verbatim from 05.

- [ ] **D2: Failing test** `test/safari-floating-trigger.test.ts` (mounts `<lookup-trigger>`, relays `lookup-click`, reuses a single element) — same as 05 D3 with `SafariFloatingTrigger`.

```ts
import { describe, it, expect, vi } from 'vitest';
import { SafariFloatingTrigger } from '../src/adapters/safari-floating-trigger';
import '@ai-dict/shared-ui/lookup-trigger';

describe('SafariFloatingTrigger (TriggerUI via <lookup-trigger>)', () => {
  it('show() mounts the trigger and fires onClick on lookup-click; hide() removes it', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new SafariFloatingTrigger(host);
    const onClick = vi.fn();
    trigger.show({ x: 10, y: 20, w: 5, h: 5 }, onClick);
    const el = host.querySelector('lookup-trigger')!;
    expect(el).not.toBeNull();
    el.dispatchEvent(new CustomEvent('lookup-click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    trigger.hide();
    expect(host.querySelector('lookup-trigger')).toBeNull();
  });

  it('show() twice reuses a single trigger element (re-anchors, no duplicates)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = new SafariFloatingTrigger(host);
    trigger.show({ x: 0, y: 0, w: 1, h: 1 }, () => {});
    trigger.show({ x: 9, y: 9, w: 1, h: 1 }, () => {});
    expect(host.querySelectorAll('lookup-trigger').length).toBe(1);
  });
});
```

- [ ] **D3: Implement** `src/adapters/safari-floating-trigger.ts` (verbatim from 05 D4, renamed)

```ts
import type { TriggerUI, AnchorRect } from '@ai-dict/core';
import '@ai-dict/shared-ui/lookup-trigger';

export class SafariFloatingTrigger implements TriggerUI {
  private el: HTMLElement | null = null;
  private onClick: (() => void) | null = null;
  private readonly handler = (): void => this.onClick?.();

  constructor(private readonly host: HTMLElement = document.body) {}

  show(anchor: AnchorRect, onClick: () => void): void {
    this.onClick = onClick;
    if (!this.el) {
      this.el = document.createElement('lookup-trigger');
      this.el.addEventListener('lookup-click', this.handler);
      this.host.append(this.el);
    }
    this.el.style.position = 'fixed';
    this.el.style.left = `${anchor.x}px`;
    this.el.style.top = `${anchor.y + anchor.h}px`;
  }

  hide(): void {
    this.el?.removeEventListener('lookup-click', this.handler);
    this.el?.remove();
    this.el = null;
    this.onClick = null;
  }
}
```
Run → PASS. Commit `feat(extension-safari): DOM adapters (selection, trigger)`.

### Task E — Router (`WriteQueue` + `buildRouter`)

**Files:** `src/router.ts`, `test/router.test.ts`.

> **Platform-agnostic — reproduce Bundle 05 Task E byte-for-byte** (`buildRouter`/`WriteQueue`/`SUPPRESS`, imports only from `@ai-dict/core`, deps injected). The full E1 test (D1 happy/cache-hit/error, D5 cancellation suppression via the `started` deferred, D6 serialized-writes + the contrast lost-update test, toggles, `settings.get`, `history.list`/`history.clear`/`cache.clear`) and the E2 implementation are identical to 05 — copy them and change nothing. The router has **zero** `browser`/`chrome` references.

- [ ] **E1:** copy `test/router.test.ts` from 05 (no edits).
- [ ] **E2:** copy `src/router.ts` from 05 (no edits).

Run → PASS. Commit `feat(extension-safari): SW router + write queue (cancellation suppression, toggles)`.

### Task F — Inbound classifier (pure) + SW listener wiring

**Files:** `src/inbound.ts` (pure, tested), `src/sw.ts` (import-time wiring, excluded from coverage), `test/inbound.test.ts`.

> **Why two files:** the **S3 sender guard + wire-schema gate** is pure and must be unit-tested, but `sw.ts` constructs adapters over `browser.storage.local` and registers `onMessage` at module top-level — importing it under happy-dom (no `browser` global) throws. So the pure logic lives in `src/inbound.ts`; `sw.ts` imports it for the wiring. (Bundle 05 has the same split.) The listener uses the `sendResponse` + `return true` idiom (the WebExtensions `runtime.onMessage` contract Safari implements) so the **SUPPRESS** path leaves the channel open and never replies — exactly as on Chrome.

- [ ] **F1: Failing test** `test/inbound.test.ts` (pure `classifyInbound` — **[S3]** sender guard + schema gate, no `browser` global)

```ts
import { describe, it, expect } from 'vitest';
import { classifyInbound } from '../src/inbound';

const valid = { type: 'settings.get' };

describe('classifyInbound (S3 sender guard + wire-schema gate)', () => {
  it('ignores messages from a foreign sender id (S3 / D4)', () => {
    expect(classifyInbound(valid, 'evil-extension', 'my-id')).toEqual({ action: 'ignore' });
  });
  it('rejects malformed messages with a PARSE error reply', () => {
    const out = classifyInbound({ type: 'nope' }, 'my-id', 'my-id');
    expect(out).toMatchObject({ action: 'reject', reply: { ok: false, error: { code: 'PARSE' } } });
  });
  it('routes a valid same-origin message', () => {
    expect(classifyInbound(valid, 'my-id', 'my-id')).toEqual({ action: 'route', msg: valid });
  });
});
```

- [ ] **F2: Implement** `src/inbound.ts` (pure — imports only from `@ai-dict/core`)

```ts
import { WireMessageSchema, mapError, type WireMessage, type WireReply } from '@ai-dict/core';

export type Inbound =
  | { action: 'ignore' }
  | { action: 'reject'; reply: WireReply }
  | { action: 'route'; msg: WireMessage };

// Pure: testable without the browser global. S3 sender guard + schema gate at the boundary.
export function classifyInbound(msg: unknown, senderId: string | undefined, runtimeId: string): Inbound {
  if (senderId !== runtimeId) return { action: 'ignore' };
  const parsed = WireMessageSchema.safeParse(msg);
  if (!parsed.success) {
    console.warn({ kind: 'wire-schema-mismatch' });
    return { action: 'reject', reply: { ok: false, type: 'lookup', error: mapError({ kind: 'parse' }) } };
  }
  return { action: 'route', msg: parsed.data };
}
```
Run → PASS.

- [ ] **F3: Implement** `src/sw.ts` (import-time wiring; uses `classifyInbound`; excluded from the coverage gate, verified by the iOS checklist)

```ts
import { mapError, DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';
import { GeminiLookupClient } from '@ai-dict/adapters-shared';
import { buildRouter, WriteQueue, SUPPRESS } from './router';
import { classifyInbound } from './inbound';
import { SafariKvStore } from './adapters/safari-kv-store';
import { SafariStorageStore } from './adapters/safari-storage-store';

const DEFAULT_TARGET = 'vi';
async function readFullSettings(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? { targetLang: DEFAULT_TARGET, promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };
}

const router = buildRouter({
  client: new GeminiLookupClient({ fetch: (u, i) => fetch(u, i), getApiKey: async () => (await readFullSettings()).apiKey }),
  settings: new SafariStorageStore(browser.storage.local),
  kv: new SafariKvStore(browser.storage.local),
  readToggles: async () => { const s = await readFullSettings(); return { cacheEnabled: s.cacheEnabled, saveHistory: s.saveHistory }; },
  queue: new WriteQueue(),
});

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const decision = classifyInbound(msg, sender.id, browser.runtime.id);
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') { sendResponse(decision.reply); return true; }
  router(decision.msg)
    .then((reply) => { if (reply !== SUPPRESS) sendResponse(reply); })
    .catch((e: unknown) => sendResponse({ ok: false, type: decision.msg.type, error: mapError({ kind: 'thrown', error: e }) }));
  return true; // async sendResponse → keep channel open (SUPPRESS leaves it open, never replies)
});
```
> `getApiKey` reads the key directly from `browser.storage.local` (S1: key never crosses the wire). `console.warn` (in `inbound.ts`) logs only `{kind}` — never key/selection/url (§7.2). No `sidePanel` wiring (iOS has none).

Run → PASS. Commit `feat(extension-safari): inbound classifier (S3 guard) + SW listener wiring`.

### Task G — Composition roots (content / options)

**Files:** `src/content.ts`, `src/options.html`, `src/options.ts`. (Wiring-only; excluded from the coverage gate; verified by the manual iOS checklist.)

- [ ] **G1: `src/content.ts`** (composition root — §5.6; **renderer is the bare inline sheet**, no side-panel mirror)

```ts
import { runLookupWorkflow } from '@ai-dict/core';            // NOT @ai-dict/core/workflow (no such subpath)
import '@ai-dict/shared-ui/lookup-trigger';
import '@ai-dict/shared-ui/lookup-card';
import '@ai-dict/shared-ui/bottom-sheet';
import { InlineBottomSheetRenderer } from '@ai-dict/adapters-shared';
import { DomSelectionSource } from './adapters/dom-selection-source';
import { SafariFloatingTrigger } from './adapters/safari-floating-trigger';
import { MessageRelayLookupClient } from './adapters/message-relay-lookup-client';
import { MessageRelaySettingsStore } from './adapters/message-relay-settings-store';

runLookupWorkflow({
  selection: new DomSelectionSource(document),
  trigger: new SafariFloatingTrigger(),
  renderer: new InlineBottomSheetRenderer(document.body),  // the only surface on iOS
  client: new MessageRelayLookupClient(browser.runtime),
  settings: new MessageRelaySettingsStore(browser.runtime),
});
```
> `InlineBottomSheetRenderer` (Bundle 04) implements `ResultRenderer` directly, so it is passed as `renderer` with no fan-out wrapper (Chrome wrapped it only to also feed the side-panel mirror, which does not exist here).

- [ ] **G2: `src/options.html` + `src/options.ts`** (full Settings incl. key, direct `browser.storage.local` — §6.6; no SW hop)

`options.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>AI Dictionary — Settings</title></head>
  <body><settings-form></settings-form><script type="module" src="options.js"></script></body>
</html>
```

`options.ts`:
```ts
import '@ai-dict/shared-ui/settings-form';
import { DEFAULT_TEMPLATE, type Settings } from '@ai-dict/core';

const form = document.querySelector('settings-form')!;
const DEFAULTS: Settings = { targetLang: 'vi', promptTemplate: DEFAULT_TEMPLATE, hasKey: false, apiKey: '', cacheEnabled: true, saveHistory: true };

async function load(): Promise<Settings> {
  const { settings } = (await browser.storage.local.get('settings')) as { settings?: Settings };
  return settings ?? DEFAULTS;
}

void load().then((s) => { (form as unknown as { value: Settings }).value = s; });

form.addEventListener('save', (e) => {
  const next = (e as CustomEvent<Partial<Settings>>).detail;
  void load().then((cur) => browser.storage.local.set({ settings: { ...cur, ...next } }));
});
form.addEventListener('clear-cache', () => { void browser.runtime.sendMessage({ type: 'cache.clear' }); });
form.addEventListener('clear-history', () => { void browser.runtime.sendMessage({ type: 'history.clear' }); });
form.addEventListener('test-connection', () => { void browser.runtime.sendMessage({ type: 'connection.test' }); });
```
> Same `settings-form` event contract owned by Bundle 03; reconcile `SettingsFormValue` field names with 03 at execution (adapt the mapping here, not in 03).

Run typecheck. Commit `feat(extension-safari): composition roots (content, options)`.

### Task H — Build + manifest validation

**Files:** `test/manifest.test.ts` (**[S5/S8/D5]** assert CSP + permissions + `browser_specific_settings` exactly), build run.

- [ ] **H1: Failing test** `test/manifest.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import manifest from '../src/manifest.json';

describe('manifest.json (S5 CSP + S8 Safari permissions — exact)', () => {
  it('declares only storage; NO sidePanel / scripting / externally_connectable (S8)', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.host_permissions).toEqual(['<all_urls>', 'https://generativelanguage.googleapis.com/*']);
    expect((manifest.permissions as string[]).includes('sidePanel')).toBe(false);
    expect((manifest.permissions as string[]).includes('scripting')).toBe(false);
    expect('side_panel' in manifest).toBe(false);
    expect('externally_connectable' in manifest).toBe(false);
  });
  it('has browser_specific_settings.safari.strict_min_version (D5)', () => {
    expect(manifest.browser_specific_settings.safari.strict_min_version).toBe('16.4');
  });
  it('extension_pages CSP matches §7.3 S5 exactly', () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "default-src 'none'; script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com; img-src 'self' data:; style-src 'self'; base-uri 'none'; frame-ancestors 'none';",
    );
  });
  it('MV3 + statically registered content scripts (no scripting API)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0].matches).toEqual(['<all_urls>']);
  });
});
```
> Requires `resolveJsonModule` (on via the base config); if tsc complains, add `"resolveJsonModule": true` to this package's tsconfig.

- [ ] **H2: Build → loadable unpacked `dist/`**

```bash
pnpm --filter @ai-dict/extension-safari build
```
Expected: `dist/{sw,content,options}.js`, `dist/manifest.json`, `dist/options.html`. (Load-unpacked verification happens inside Safari via the Xcode host app — Task I; there is no `chrome://extensions` equivalent on iOS.) Commit `test(extension-safari): manifest CSP/permission assertions + build`.

### Task I — Xcode wrapper (iOS target only) + sync script + iOS checklist

**Files:** `xcode/**`, `xcode/sync-dist.sh`, `e2e/ios-simulator-checklist.md`. (Replaces Chrome's Playwright e2e — Apple exposes no WebDriver for iOS Safari Web Extensions, §8.1.)

- [ ] **I1: Generate the Xcode project (iOS target only).** Run Apple's converter against the built `dist/`, then commit the generated `xcode/` tree. **Verify flags with `xcrun safari-web-extension-converter --help` at execution** (flag names vary by Xcode version):

```bash
pnpm --filter @ai-dict/extension-safari build
xcrun safari-web-extension-converter packages/extension-safari/dist \
  --project-location packages/extension-safari/xcode \
  --app-name "AI Dictionary" \
  --bundle-identifier com.ai-dict.safari \
  --ios-only --no-open --no-prompt --copy-resources
```
> `--ios-only` ⇒ **no macOS target** (non-goal §2 / spec §5.5). `--copy-resources` copies `dist/` into the extension target's `Resources/` so the committed project is self-contained. The generated `MARKETING_VERSION` (iOS target) is the field Bundle 07's `release:bump` rewrites alongside the manifest `version`.

- [ ] **I2: `xcode/sync-dist.sh`** — re-copy a fresh `dist/` into the Xcode extension resources after each rebuild (so devs don't re-run the converter). Resolve the exact `Resources` path from the generated project at execution:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
# Generated by safari-web-extension-converter; confirm the leaf name in the committed project.
RES="$ROOT/xcode/AI Dictionary Extension/Resources"
[ -d "$DIST" ] || { echo "build dist/ first: pnpm --filter @ai-dict/extension-safari build"; exit 1; }
rm -rf "$RES"
mkdir -p "$RES"
cp -R "$DIST"/. "$RES"/
echo "synced dist/ → $RES"
```
> Wired as `pnpm --filter @ai-dict/extension-safari xcode:sync` (A1). Bundle 07's iOS release job runs `build` → `xcode:sync` → `xcodebuild archive` (iOS target). **No `xcodebuild` here** — D7 only requires the project structure + sync script to exist (the actual archive is exercised on the macOS runner in Bundle 07).

- [ ] **I3: `e2e/ios-simulator-checklist.md`** — the mandatory manual pass (§8.10, all **12** steps verbatim; run every release):

```markdown
# iOS Simulator manual checklist (run every release — no automated e2e on Safari)

Prereq: macOS with Xcode; a real Gemini API key.

1. [ ] Build the Xcode project (`pnpm --filter @ai-dict/extension-safari build && pnpm --filter @ai-dict/extension-safari xcode:sync`, then build in Xcode).
2. [ ] Boot iOS Simulator (iPhone 15, iOS 17+).
3. [ ] Install the host app.
4. [ ] Settings → Safari → Extensions → enable “AI Dictionary”.
5. [ ] Grant “Always Allow on Every Website”.
6. [ ] Open Safari, navigate to a test article.
7. [ ] Open extension Settings → paste a real Gemini key.
8. [ ] Select a word → verify `<lookup-trigger>` appears.
9. [ ] Tap trigger → verify the bottom sheet opens with a loading state, then a result card.
10. [ ] Verify a cache hit on a second identical selection (instant, `fromCache`).
11. [ ] Trigger error states: clear the key, turn the network off → verify error UX matches §7.1.
12. [ ] Tap “Clear all data” → verify `storage.local` is wiped (key gone, history empty).
```
Commit `feat(extension-safari): Xcode iOS wrapper + sync script + manual iOS checklist`.

### Task J — Full-suite gate

- [ ] **J1: Coverage (≥90%) + typecheck + lint + size**

```bash
pnpm --filter @ai-dict/extension-safari test --coverage   # ≥90% on adapters + router + inbound.classifyInbound
pnpm --filter @ai-dict/extension-safari typecheck
pnpm lint                                                  # hex: ext/test ⇏ src/adapters; adapters injected
pnpm --filter @ai-dict/extension-safari build && pnpm size # within §8.7 budgets (content ≤45KB, sw ≤30KB, options ≤40KB gz)
```
```bash
git add packages/extension-safari
git commit -m "test(extension-safari): coverage + size gate"
```

## Verify (correctness)
- Run: `pnpm --filter @ai-dict/extension-safari test --coverage` → pass, ≥ 90%.
- Run: `pnpm --filter @ai-dict/extension-safari build` → loadable `dist/`.
- Run: `pnpm size` (safari bundles) → within budget.
- Xcode build itself is exercised by Bundle 07 (macOS runner); here verify project files + sync script presence.

## Validate (sanity / no scope drift)
- `typecheck` + `lint` clean.
- `git diff --stat` only `packages/extension-safari/**`.
- No `sidePanel`, no Chrome-only APIs; no macOS Xcode target (non-goal §2).
- No key value logged (§7.2).

## Self-audit (run BEFORE sign-off)
- [ ] D1–D9 met with evidence?
- [ ] [S1] key isolation verified?
- [ ] [S3] sender guard tested?
- [ ] Manifest matches §7.3 S8 Safari list (no sidePanel/scripting)?
- [ ] iOS target only — no macOS target?
- [ ] 12-step iOS checklist complete?
- [ ] Only `packages/extension-safari/**` changed?

## Sign-off
Edit YAML: `status: DONE`, `done_at: <UTC>`. Commit. Update README checkbox `06`.
