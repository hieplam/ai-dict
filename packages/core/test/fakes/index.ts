import type {
  SelectionSource, TriggerUI, ResultRenderer, LookupClient, SettingsStore, Storage,
  SelectionEvent, LookupResult, LookupError, LookupRequest, PublicSettings,
} from '../../src';

export class FakeSelectionSource implements SelectionSource {
  private cb: ((e: SelectionEvent) => void) | null = null;
  onSelection(cb: (e: SelectionEvent) => void) { this.cb = cb; return () => { this.cb = null; }; }
  emit(e: SelectionEvent) { this.cb?.(e); }
}

export class FakeTriggerUI implements TriggerUI {
  shown: { anchor: unknown; onClick: () => void } | null = null;
  hidden = 0;
  show(anchor: { x: number; y: number; w: number; h: number }, onClick: () => void) { this.shown = { anchor, onClick }; }
  hide() { this.hidden++; this.shown = null; }
  click() { this.shown?.onClick(); }
}

export class FakeResultRenderer implements ResultRenderer {
  calls: string[] = [];
  lastResult: LookupResult | null = null;
  lastError: LookupError | null = null;
  renderLoading() { this.calls.push('loading'); }
  renderResult(r: LookupResult) { this.calls.push('result'); this.lastResult = r; }
  renderError(e: LookupError) { this.calls.push('error'); this.lastError = e; }
  close() { this.calls.push('close'); }
}

export class FakeLookupClient implements LookupClient {
  constructor(private impl: (req: LookupRequest, opts?: { signal?: AbortSignal }) => Promise<LookupResult>) {}
  lastReq: LookupRequest | null = null;
  lookup(req: LookupRequest, opts?: { signal?: AbortSignal }) { this.lastReq = req; return this.impl(req, opts); }
}

export class FakeSettingsStore implements SettingsStore {
  constructor(public value: PublicSettings) {}
  get(): Promise<PublicSettings> { return Promise.resolve(this.value); }
  set(patch: Partial<Pick<PublicSettings, 'targetLang' | 'promptTemplate'>>): Promise<void> {
    Object.assign(this.value, patch);
    return Promise.resolve();
  }
}

export function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => Promise.resolve(m.get(k) ?? null),
    setItem: (k, v) => { m.set(k, v); return Promise.resolve(); },
    removeItem: (k) => { m.delete(k); return Promise.resolve(); },
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => !p || k.startsWith(p))),
  };
}
