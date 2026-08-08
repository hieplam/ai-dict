import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
  Storage,
  SelectionEvent,
  LookupResult,
  LookupError,
  LookupRequest,
  PublicSettings,
  AnchorRect,
} from '../../src';

export class FakeSelectionSource implements SelectionSource {
  private cb: ((e: SelectionEvent) => void) | null = null;
  onSelection(cb: (e: SelectionEvent) => void) {
    this.cb = cb;
    return () => {
      this.cb = null;
    };
  }
  emit(e: SelectionEvent) {
    this.cb?.(e);
  }
}

export class FakeTriggerUI implements TriggerUI {
  shown: { anchor: unknown; onClick: () => void } | null = null;
  hidden = 0;
  show(anchor: { x: number; y: number; w: number; h: number }, onClick: () => void) {
    this.shown = { anchor, onClick };
  }
  hide() {
    this.hidden++;
    this.shown = null;
  }
  click() {
    this.shown?.onClick();
  }
}

export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastCtx: ResultRenderContext | undefined;
  lastError: LookupError | null = null;
  loadingWord: string | undefined;
  // A6: the anchor renderLoading was called with, so tests can assert workflow.ts forwards it.
  loadingAnchor: AnchorRect | undefined;
  // A1: every renderPartial call, in order — [word, markdownSoFar, definedAs].
  partials: [string, string, { term: string; isIdiom: boolean } | undefined][] = [];
  renderLoading(word?: string, anchor?: AnchorRect) {
    this.calls.push('loading');
    this.loadingWord = word;
    this.loadingAnchor = anchor;
  }
  renderResult(r: LookupResult, ctx?: ResultRenderContext) {
    this.calls.push('result');
    this.lastResult = r;
    this.lastCtx = ctx;
  }
  renderError(e: LookupError) {
    this.calls.push('error');
    this.lastError = e;
  }
  renderPartial(
    word: string,
    markdownSoFar: string,
    definedAs?: { term: string; isIdiom: boolean },
  ) {
    this.calls.push('partial');
    this.partials.push([word, markdownSoFar, definedAs]);
  }
  close() {
    this.calls.push('close');
  }
}

export class FakeLookupClient implements LookupClient {
  constructor(
    private impl: (
      req: LookupRequest,
      opts?: {
        signal?: AbortSignal;
        onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
      },
    ) => Promise<LookupResult>,
  ) {}
  lastReq: LookupRequest | null = null;
  lookup(
    req: LookupRequest,
    opts?: {
      signal?: AbortSignal;
      onChunk?: (markdownSoFar: string, definedAs?: { term: string; isIdiom: boolean }) => void;
    },
  ) {
    this.lastReq = req;
    return this.impl(req, opts);
  }
}

export class FakeSettingsStore implements SettingsStore {
  constructor(public value: PublicSettings) {}
  get(): Promise<PublicSettings> {
    return Promise.resolve(this.value);
  }
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'outputFormat'>>): Promise<void> {
    Object.assign(this.value, patch);
    return Promise.resolve();
  }
}

export function fakeStorage(): Storage {
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
