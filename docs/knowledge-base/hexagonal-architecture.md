# Hexagonal Architecture (Ports and Adapters)

Knowledge base note. Captured during brainstorming of the AI Dictionary browser extensions.

> **Note:** the `LookupResult`, `SelectionEvent`, and `SettingsStore` shapes in the code
> samples below are early illustrative sketches, **superseded by the final port definitions**
> in `docs/superpowers/specs/2026-05-24-ai-dict-design.md` (§5.2 / §6.1). They remain
> here only to teach the hex pattern, not as the current contract.

## What it is

**Hexagonal Architecture** (also called **Ports and Adapters**) — Alistair Cockburn, 2005.

Idea: put domain logic at the center, isolate it from the outside world. Outside world plugs in via interfaces. Drawn as a hexagon because there are many sides; each side is a _port_; no single "front" or "back". The only distinction is **inside vs outside**.

## Vocabulary

### Port

An interface **declared by the domain**, in domain terms. Says _what_ the domain needs from outside, not _how_ outside does it.

- Example port: `LookupClient.lookup(req): Promise<LookupResult>`
- Domain says: "I need a thing that takes a `LookupRequest` and gives back a `LookupResult`." Domain doesn't know whether Gemini, OpenAI, or a fake file is behind it.

A port is **owned by the inside (domain)**, not by the implementation.

### Adapter

A concrete class that implements a port using a real outside technology.

- `GeminiHttpAdapter implements LookupClient` -> calls `fetch(gemini-url)`.
- `ChromeStorageAdapter implements SettingsStore` -> calls `chrome.storage.local`.
- `DomSelectionAdapter implements SelectionSource` -> listens to `document.selectionchange`.
- `FakeLookupClient implements LookupClient` -> returns canned data (used in tests).

Adapters live at the edge. Domain only sees ports.

## Diagram

```
          [Selection DOM adapter]
                   |
                   v
+---------------------------------+
|  domain core (workflow + ports)  |    <- pure TS, no fetch / no DOM / no chrome.*
|                                  |
|  runLookupWorkflow(ports) ...    |
+---------------------------------+
   ^         ^         ^         ^
   |         |         |         |
[TriggerUI][Renderer][LookupClient][SettingsStore]   (ports)
   |         |         |         |
[shared-ui][SidePanel][Gemini   ][ChromeStorage]    (adapters)
[bubble  ][Renderer ][HTTP     ][adapter        ]
```

Domain never imports an adapter. The **composition root** (e.g. `content.ts` in this project) wires them at startup:

```ts
runLookupWorkflow({
  selection: new DomSelectionSource(),
  trigger: new ChromeFloatingTrigger(),
  renderer: new SidePanelRenderer(),
  client: new MessageRelayClient(),
  settings: new ChromeStorageStore(),
});
```

## Why it helps testing — example

The workflow accepts ports as plain function arguments. In tests, pass **Fake adapters** that store calls and return scripted data. No Document Object Model (DOM), no Service Worker (SW), no Gemini Application Programming Interface (API) key, no network.

```ts
// core/workflow.test.ts (vitest, runs in plain Node)
import { runLookupWorkflow } from './workflow';
import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  LookupClient,
  SettingsStore,
  LookupRequest,
  LookupResult,
  Settings,
  LookupError,
  SelectionEvent,
} from './ports';

class FakeSelection implements SelectionSource {
  private cb!: (e: SelectionEvent) => void;
  onSelection(cb: (e: SelectionEvent) => void) {
    this.cb = cb;
    return () => {};
  }
  emit(text: string, sentence: string) {
    this.cb({ text, sentence, url: 'https://x.test', anchor: { x: 0, y: 0, w: 0, h: 0 } });
  }
}

class FakeTrigger implements TriggerUI {
  shown = false;
  lastOnClick?: () => void;
  show(_a: any, onClick: () => void) {
    this.shown = true;
    this.lastOnClick = onClick;
  }
  hide() {
    this.shown = false;
  }
}

class FakeRenderer implements ResultRenderer {
  events: string[] = [];
  lastResult?: LookupResult;
  lastError?: LookupError;
  renderLoading() {
    this.events.push('loading');
  }
  renderResult(r: LookupResult) {
    this.events.push('result');
    this.lastResult = r;
  }
  renderError(e: LookupError) {
    this.events.push('error');
    this.lastError = e;
  }
  close() {
    this.events.push('close');
  }
}

class FakeClient implements LookupClient {
  calls: LookupRequest[] = [];
  next: LookupResult | Error = {
    definitionEn: 'sloping land beside a river',
    translationVi: 'bờ sông',
    ipa: '/bæŋk/',
    pos: 'noun',
    examples: [],
  };
  async lookup(req: LookupRequest) {
    this.calls.push(req);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

class FakeSettings implements SettingsStore {
  state: Settings = { targetLang: 'vi', promptTemplate: 'define {word} given context: {context}' };
  async get() {
    return this.state;
  }
  async set(p: Partial<Settings>) {
    this.state = { ...this.state, ...p };
  }
}

test('happy path: select -> bubble -> click -> Gemini -> result rendered', async () => {
  const selection = new FakeSelection();
  const trigger = new FakeTrigger();
  const renderer = new FakeRenderer();
  const client = new FakeClient();
  const settings = new FakeSettings();

  runLookupWorkflow({ selection, trigger, renderer, client, settings });

  selection.emit('bank', 'I walked along the bank watching the river flow.');
  expect(trigger.shown).toBe(true);

  await trigger.lastOnClick!(); // simulate user clicking bubble

  expect(trigger.shown).toBe(false);
  expect(renderer.events).toEqual(['loading', 'result']);
  expect(client.calls).toHaveLength(1);
  expect(client.calls[0].word).toBe('bank');
  expect(client.calls[0].context).toContain('river');
  expect(client.calls[0].target).toBe('vi');
  expect(renderer.lastResult?.translationVi).toBe('bờ sông');
});

test('failure path: Gemini throws -> renderError called, no result', async () => {
  const selection = new FakeSelection();
  const trigger = new FakeTrigger();
  const renderer = new FakeRenderer();
  const client = new FakeClient();
  const settings = new FakeSettings();
  client.next = Object.assign(new Error('rate-limited'), { code: 'RATE_LIMIT' });

  runLookupWorkflow({ selection, trigger, renderer, client, settings });
  selection.emit('bank', 'I walked along the bank.');
  await trigger.lastOnClick!();

  expect(renderer.events).toEqual(['loading', 'error']);
  expect(renderer.lastError?.message).toBe('rate-limited');
});
```

Runs in plain Node. Milliseconds. No browser launch.

## Why side effects are easy to test under hex

| Side effect in code                        | Without hex (direct call)                                                                     | With hex (behind port)                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `fetch(gemini)`                            | Need real Hypertext Transfer Protocol (HTTP) or `vi.mock('node-fetch')` global stub. Fragile. | Pass `FakeLookupClient`. Inspect `.calls` array.     |
| `chrome.storage.local.set`                 | Need jest-chrome mock or jsdom + chrome shim.                                                 | Pass `FakeSettingsStore`. Inspect `.state`.          |
| DOM mutation (`document.body.appendChild`) | Need jsdom. Selectors flake.                                                                  | Pass `FakeTrigger`. Check `.shown` + `.lastOnClick`. |
| `chrome.sidePanel.open`                    | Need Manifest V3 (MV3) polyfill in test env.                                                  | Pass `FakeRenderer`. Check `.events`.                |

Pattern: every side effect is reached **only** through a port. Port = seam. Seam = substitute point. Each fake = small spy that records arguments and replays scripted results.

So:

1. **Observable.** Side effect lands in the fake's memory -> assert with normal `expect()`.
2. **Inject failure.** `fakeClient.next = new Error(...)` -> instant failure path test. No network mocking.
3. **Deterministic.** No timing, no flakes, no network, no Input/Output (I/O). Reruns the same every time.
4. **Fast.** Plain Node, no browser, no jsdom needed for core logic. Whole suite runs in seconds.
5. **Decouples test from impl.** Refactor `GeminiHttpAdapter` from `fetch` to `axios` -> tests unchanged (they use `FakeLookupClient`, not the real one).

Adapter-level tests (real Gemini, real `chrome.*`) still exist, but they are small in number — most coverage sits in the fast, deterministic core/workflow tests.

## When to reach for hexagonal

- Domain logic has clear outside dependencies (HTTP, DB, DOM, OS, queue, file system).
- More than one runtime context (e.g. browser extension on Chrome AND Safari, or CLI + web).
- Side effects make tests slow, flaky, or skipped.
- You want the option to swap an implementation later (storage backend, AI provider, UI shell) without rewriting the core.

## When NOT to over-apply it

- Pure UI component with no side effects -> don't wrap fetch in a port for one call.
- Throwaway script.
- Static site generator step that runs once at build time.

Heuristic: if you would write a fake for it in a test anyway, give it a port.
