import { describe, it, expect, vi } from 'vitest';
import { runLookupWorkflow, COOLDOWN_MS } from '../src/domain/workflow';
import {
  FakeSelectionSource,
  FakeTriggerUI,
  FakeResultRenderer,
  FakeLookupClient,
  FakeSettingsStore,
} from './fakes';
import type { SelectionEvent, LookupResult } from '../src';

const sel: SelectionEvent = {
  text: 'bank',
  sentence: 'river bank',
  anchor: { x: 0, y: 0, w: 1, h: 1 },
  url: 'u',
  title: 't',
};
const okResult: LookupResult = {
  markdown: '#',
  word: 'bank',
  target: 'vi',
  model: 'gemini-2.5-flash',
  fromCache: false,
  fetchedAt: 1,
};
const pub = (hasKey: boolean) => ({
  targetLang: 'vi',
  outputFormat: 'tpl',
  hasKey,
  theme: 'sepia' as const,
});

function harness(opts: {
  hasKey?: boolean;
  impl?: FakeLookupClient['lookup'];
  now?: () => number;
}) {
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient(opts.impl ?? (() => Promise.resolve(okResult)));
  const settings = new FakeSettingsStore(pub(opts.hasKey ?? true));
  const teardown = runLookupWorkflow({
    selection,
    trigger,
    renderer,
    client,
    settings,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { selection, trigger, renderer, client, settings, teardown };
}

describe('runLookupWorkflow', () => {
  it('happy path: select → show trigger → click → loading → result; req built from settings', async () => {
    const h = harness({});
    h.selection.emit(sel);
    expect(h.trigger.shown).not.toBeNull();
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.trigger.hidden).toBe(1);
    expect(h.renderer.calls).toEqual(['loading', 'result']);
    // the selected word is threaded into renderLoading so the card shows it immediately
    expect(h.renderer.loadingWord).toBe('bank');
    expect(h.client.lastReq).toMatchObject({
      word: 'bank',
      context: 'river bank',
      target: 'vi',
      outputFormat: 'tpl',
    });
  });

  it('NO_KEY short-circuit: no lookup sent', async () => {
    const h = harness({ hasKey: false });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('NO_KEY'));
    expect(h.renderer.calls).not.toContain('loading');
    expect(h.client.lastReq).toBeNull();
  });

  it('maps a rejected lookup (LookupError-shaped) to renderError', async () => {
    const err = Object.assign(new Error('rate'), {
      code: 'RATE_LIMIT',
      message: 'rate',
      retryable: true,
    });
    const h = harness({ impl: () => Promise.reject(err) });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('RATE_LIMIT'));
  });

  it('maps a plain Error thrown by client (not LookupError-shaped) to UNKNOWN via toLookupError fallback', async () => {
    const h = harness({ impl: () => Promise.reject(new Error('unexpected network blip')) });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('UNKNOWN'));
    expect(h.renderer.lastError?.message).toContain('unexpected network blip');
  });

  it('cancels the in-flight lookup when a newer one starts (spec §6.8)', async () => {
    const signals: AbortSignal[] = [];
    let t = 0;
    const h = harness({
      now: () => t,
      impl: (_req, opts) =>
        new Promise((resolve) => {
          if (opts?.signal) signals.push(opts.signal);
          setTimeout(() => resolve(okResult), 5);
        }),
    });
    h.selection.emit(sel);
    h.trigger.click(); // lookup A at t=0
    t = COOLDOWN_MS; // advance past the cooldown so B is a genuine new lookup, not blocked
    h.selection.emit(sel);
    h.trigger.click(); // lookup B -> aborts A
    await vi.waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it('hide() is deferred: trigger NOT hidden synchronously on click, hidden after async resolves', async () => {
    const h = harness({});
    h.selection.emit(sel);
    h.trigger.click();
    // synchronously after click: hide must NOT have been called yet
    expect(h.trigger.hidden).toBe(0);
    // after the full async chain completes, hide must have been called once
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.trigger.hidden).toBe(1);
  });

  it('teardown() aborts an in-flight lookup, closes renderer, hides trigger, and stops future events', async () => {
    let capturedSignal: AbortSignal | undefined;
    // Never resolves — simulates a pending request
    const h = harness({
      impl: (_req, opts) =>
        new Promise<LookupResult>(() => {
          capturedSignal = opts?.signal;
        }),
    });
    h.selection.emit(sel);
    h.trigger.click();
    // Wait until the in-flight lookup has registered its signal
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());

    const hiddenBefore = h.trigger.hidden;
    h.teardown();

    // (a) AbortSignal must be aborted
    expect(capturedSignal!.aborted).toBe(true);
    // (b) renderer.close() must have been called
    expect(h.renderer.calls).toContain('close');
    // (c) trigger.hide() must have been called at least once more
    expect(h.trigger.hidden).toBeGreaterThan(hiddenBefore);
    // (d) selection events after teardown must not fire the trigger again
    h.selection.emit(sel);
    expect(h.trigger.shown).toBeNull();
  });

  it('cooldown: the very first lookup always fires (gate does not block it)', async () => {
    const t = 5000;
    const h = harness({ now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.client.lastReq).not.toBeNull();
  });

  it('cooldown: a second lookup within the window is blocked (RATE_LIMIT message), does NOT fire, and does NOT abort the first', async () => {
    const signals: AbortSignal[] = [];
    let t = 0;
    const h = harness({
      now: () => t,
      impl: (_req, opts) =>
        new Promise<LookupResult>(() => {
          if (opts?.signal) signals.push(opts.signal);
        }),
    });
    h.selection.emit(sel);
    h.trigger.click(); // A fires at t=0, stays in flight
    await vi.waitFor(() => expect(signals.length).toBe(1));
    t = COOLDOWN_MS - 1; // still inside the window
    h.selection.emit(sel);
    h.trigger.click(); // B blocked
    expect(h.renderer.lastError?.code).toBe('RATE_LIMIT');
    expect(h.renderer.lastError?.message).toContain('Slow down');
    expect(signals.length).toBe(1); // B never reached the client
    expect(signals[0]!.aborted).toBe(false); // A NOT aborted
  });

  it('cooldown: a second lookup after the window elapses fires normally', async () => {
    let t = 0;
    const h = harness({ now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));
    t = COOLDOWN_MS; // boundary: 2000-0 >= 2000 -> allowed
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  });

  it('cooldown: blocked attempts do not extend the window (measured from last FIRE, not last click)', async () => {
    let t = 0;
    const h = harness({ now: () => t });
    h.selection.emit(sel);
    h.trigger.click(); // A fires at t=0
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    t = 1000;
    h.selection.emit(sel);
    h.trigger.click(); // blocked
    t = 1500;
    h.selection.emit(sel);
    h.trigger.click(); // blocked
    expect(h.renderer.lastError?.code).toBe('RATE_LIMIT');
    t = 2000;
    h.selection.emit(sel);
    h.trigger.click(); // allowed: 2000-0 >= 2000
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
  });
});
