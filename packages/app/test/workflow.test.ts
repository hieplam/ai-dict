import { describe, it, expect, vi } from 'vitest';
import { runLookupWorkflow } from '../src/domain/workflow';
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
  promptTemplate: 'tpl',
  hasKey,
  theme: 'light' as const,
});

function harness(opts: { hasKey?: boolean; impl?: FakeLookupClient['lookup'] }) {
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient(opts.impl ?? (() => Promise.resolve(okResult)));
  const settings = new FakeSettingsStore(pub(opts.hasKey ?? true));
  const teardown = runLookupWorkflow({ selection, trigger, renderer, client, settings });
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
      promptTemplate: 'tpl',
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
    const h = harness({
      impl: (_req, opts) =>
        new Promise((resolve) => {
          if (opts?.signal) signals.push(opts.signal);
          setTimeout(() => resolve(okResult), 5);
        }),
    });
    h.selection.emit(sel);
    h.trigger.click(); // lookup A
    h.selection.emit(sel);
    h.trigger.click(); // lookup B → aborts A
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
});
