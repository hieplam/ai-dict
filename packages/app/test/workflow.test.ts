import { describe, it, expect, vi } from 'vitest';
import { runLookupWorkflow, COOLDOWN_MS, RECURSIVE_LOOKUP_DEPTH_CAP } from '../src/domain/workflow';
import {
  FakeSelectionSource,
  FakeTriggerUI,
  FakeResultRenderer,
  FakeLookupClient,
  FakeSettingsStore,
} from './fakes';
import type { SelectionEvent, LookupResult, Provider } from '../src';

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
const pub = (hasKey: boolean, configuredProviders?: Provider[], doubleClickLookup?: boolean) => {
  const fallback: Provider[] = hasKey ? ['gemini'] : [];
  return {
    targetLang: 'vi',
    outputFormat: 'tpl',
    promptEnvelope: 'ENV-MARKER',
    hasKey,
    theme: 'sepia' as const,
    configuredProviders: configuredProviders ?? fallback,
    highlightSavedWords: true,
    ...(doubleClickLookup ? { doubleClickLookup: true } : {}),
  };
};

function harness(opts: {
  hasKey?: boolean;
  configuredProviders?: Provider[];
  impl?: FakeLookupClient['lookup'];
  now?: () => number;
  doubleClickLookup?: boolean;
}) {
  const selection = new FakeSelectionSource();
  const trigger = new FakeTriggerUI();
  const renderer = new FakeResultRenderer();
  const client = new FakeLookupClient(opts.impl ?? (() => Promise.resolve(okResult)));
  const settings = new FakeSettingsStore(
    pub(opts.hasKey ?? true, opts.configuredProviders, opts.doubleClickLookup),
  );
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
    // A6: the selection's anchor rect is threaded into renderLoading too, so the card can
    // position itself near the selection from its very first paint.
    expect(h.renderer.loadingAnchor).toEqual(sel.anchor);
    expect(h.client.lastReq).toMatchObject({
      word: 'bank',
      context: 'river bank',
      target: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: 'ENV-MARKER', // envelope override rides settings → request
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

  it('gates on configuredProviders, not hasKey: fires when a non-default provider is configured', async () => {
    // hasKey is false (the SELECTED provider has no key) but another provider is configured.
    const h = harness({ hasKey: false, configuredProviders: ['openai'] });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.client.lastReq).not.toBeNull();
  });

  it('passes picker context (providers + onSwitchProvider) when ≥2 providers configured', async () => {
    const h = harness({ configuredProviders: ['gemini', 'openai'] });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx?.providers).toEqual(['gemini', 'openai']);
    expect(typeof h.renderer.lastCtx?.onSwitchProvider).toBe('function');
  });

  it('ctx always carries sentence/url/title, even with only one provider configured (no picker)', async () => {
    const h = harness({ configuredProviders: ['gemini'] });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx).toBeDefined();
    expect(h.renderer.lastCtx?.sentence).toBe('river bank');
    expect(h.renderer.lastCtx?.url).toBe('u');
    expect(h.renderer.lastCtx?.title).toBe('t');
    expect(h.renderer.lastCtx?.providers).toBeUndefined();
    expect(h.renderer.lastCtx?.onSwitchProvider).toBeUndefined();
  });

  it('ctx.onRefine is always present on a completed result (A3)', async () => {
    const h = harness({ configuredProviders: ['gemini'] });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(typeof h.renderer.lastCtx?.onRefine).toBe('function');
    expect(h.renderer.lastCtx?.refine).toBeUndefined(); // original result, not a refine re-run
  });

  it('onSwitchProvider re-runs the SAME selection with req.provider override, bypassing cooldown', async () => {
    let t = 5000;
    const h = harness({ configuredProviders: ['gemini', 'openai'], now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    const switchTo = h.renderer.lastCtx!.onSwitchProvider!;
    // Still inside the cooldown window — a manual switch must NOT be blocked.
    t = 5001;
    switchTo('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq).toMatchObject({
      word: 'bank',
      context: 'river bank',
      provider: 'openai',
    });
    // Never blocked → no cooldown RATE_LIMIT error.
    expect(h.renderer.lastError).toBeNull();
  });

  it('onRefine re-runs the SAME selection with req.refine set, resetting provider/forceLiteral, bypassing cooldown (A3)', async () => {
    let t = 5000;
    const h = harness({ configuredProviders: ['gemini'], now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    const refine = h.renderer.lastCtx!.onRefine!;
    // Still inside the cooldown window — a deliberate refine tap must NOT be blocked.
    t = 5001;
    refine('etymology');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq).toMatchObject({
      word: 'bank',
      context: 'river bank',
      refine: 'etymology',
    });
    expect(h.client.lastReq?.provider).toBeUndefined();
    expect(h.client.lastReq?.forceLiteral).toBeUndefined();
    expect(h.renderer.lastError).toBeNull();
    // The ctx built from the refine result marks which refine produced it.
    expect(h.renderer.lastCtx?.refine).toBe('etymology');
  });

  it('a result with definedAs.isIdiom=true yields ctx.onForceLiteral even with only 1 provider configured', async () => {
    const idiomResult: LookupResult = {
      ...okResult,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const h = harness({
      configuredProviders: ['gemini'],
      impl: () => Promise.resolve(idiomResult),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx).toBeDefined();
    expect(typeof h.renderer.lastCtx?.onForceLiteral).toBe('function');
    expect(h.renderer.lastCtx?.providers).toBeUndefined(); // still no picker (only 1 provider)
  });

  it('onForceLiteral re-runs the SAME selection with req.forceLiteral, bypassing cooldown', async () => {
    let t = 5000;
    const idiomResult: LookupResult = {
      ...okResult,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const literalResult: LookupResult = { ...okResult, word: 'bucket' };
    let calls = 0;
    const h = harness({
      configuredProviders: ['gemini'],
      now: () => t,
      impl: () => Promise.resolve(calls++ === 0 ? idiomResult : literalResult),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    const forceLiteral = h.renderer.lastCtx!.onForceLiteral!;
    t = 5001; // still inside the cooldown window — a deliberate override must NOT be blocked
    forceLiteral();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq).toMatchObject({
      word: 'bank',
      context: 'river bank',
      forceLiteral: true,
    });
    expect(h.renderer.lastError).toBeNull();
  });

  it('a literal result (no definedAs) with only 1 provider still yields no picker/force-literal, but ctx is defined for sentence/url/title (B1)', async () => {
    const h = harness({ configuredProviders: ['gemini'] }); // okResult has no definedAs
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx).toBeDefined();
    expect(h.renderer.lastCtx?.onForceLiteral).toBeUndefined();
    expect(h.renderer.lastCtx?.sentence).toBe('river bank');
  });

  it('[A12] a recognized e.pageLang yields req.sourceLang and ctx.sourceLang, no sourceLangOverride', async () => {
    const h = harness({});
    h.selection.emit({ ...sel, pageLang: 'fr' });
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.client.lastReq).toMatchObject({ sourceLang: 'fr' });
    expect(h.client.lastReq?.sourceLangOverride).toBeUndefined();
    expect(h.renderer.lastCtx?.sourceLang).toBe('fr');
  });

  it('[A12] an unrecognized/absent e.pageLang leaves req.sourceLang and ctx.sourceLang unset', async () => {
    const h = harness({});
    h.selection.emit(sel); // no pageLang
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.client.lastReq?.sourceLang).toBeUndefined();
    expect(h.renderer.lastCtx?.sourceLang).toBeUndefined();
  });

  it('[A12] ctx.onOverrideSourceLang always exists (unconditional, unlike the provider picker)', async () => {
    const h = harness({});
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(typeof h.renderer.lastCtx?.onOverrideSourceLang).toBe('function');
  });

  it('[A12] onOverrideSourceLang re-runs with req.sourceLang + sourceLangOverride:true, bypassing cooldown', async () => {
    let t = 5000;
    const h = harness({ now: () => t });
    h.selection.emit({ ...sel, pageLang: 'fr' });
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    const override = h.renderer.lastCtx!.onOverrideSourceLang!;
    t = 5001; // still inside the cooldown window — a deliberate override must NOT be blocked
    override('ja');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq).toMatchObject({ sourceLang: 'ja', sourceLangOverride: true });
    expect(h.renderer.lastError).toBeNull();
  });

  it('[A12] overriding with "auto" clears req.sourceLang but still sets sourceLangOverride:true', async () => {
    let t = 5000;
    const h = harness({ now: () => t });
    h.selection.emit({ ...sel, pageLang: 'fr' });
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    const override = h.renderer.lastCtx!.onOverrideSourceLang!;
    t = 5001;
    override('auto');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq?.sourceLang).toBeUndefined();
    expect(h.client.lastReq?.sourceLangOverride).toBe(true);
  });

  it('[A12] onSwitchProvider drops a current forceLiteral (sibling-drop precedent) but threads sourceLangOverride', async () => {
    let t = 5000;
    const idiomResult: LookupResult = {
      ...okResult,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const h = harness({
      configuredProviders: ['gemini', 'openai'],
      now: () => t,
      impl: () => Promise.resolve(idiomResult),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

    // Set a manual source-language override first.
    t += 1;
    h.renderer.lastCtx!.onOverrideSourceLang!('fr');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));

    // Force literal from that ctx — forceLiteral becomes true, sourceLangOverride stays threaded.
    t += 1;
    h.renderer.lastCtx!.onForceLiteral!();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
    expect(h.client.lastReq?.forceLiteral).toBe(true);

    // Now switch provider from THIS ctx (forceLiteral currently true) — it must be dropped, not
    // threaded, while the source-language override survives.
    t += 1;
    h.renderer.lastCtx!.onSwitchProvider!('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
    expect(h.client.lastReq?.provider).toBe('openai');
    expect(h.client.lastReq?.forceLiteral).toBeUndefined();
    expect(h.client.lastReq?.sourceLang).toBe('fr');
    expect(h.client.lastReq?.sourceLangOverride).toBe(true);
    expect(h.renderer.lastError).toBeNull();
  });

  it('[A12] onForceLiteral drops a current providerOverride (sibling-drop precedent) but threads sourceLangOverride', async () => {
    let t = 5000;
    const idiomResult: LookupResult = {
      ...okResult,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const h = harness({
      configuredProviders: ['gemini', 'openai'],
      now: () => t,
      impl: () => Promise.resolve(idiomResult),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

    // Set a manual source-language override first.
    t += 1;
    h.renderer.lastCtx!.onOverrideSourceLang!('fr');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));

    // Switch provider from that ctx — provider becomes 'openai', sourceLangOverride stays threaded.
    t += 1;
    h.renderer.lastCtx!.onSwitchProvider!('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
    expect(h.client.lastReq?.provider).toBe('openai');

    // Now force literal from THIS ctx (provider currently 'openai') — it must be dropped, not
    // threaded, while the source-language override survives.
    t += 1;
    h.renderer.lastCtx!.onForceLiteral!();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
    expect(h.client.lastReq?.forceLiteral).toBe(true);
    expect(h.client.lastReq?.provider).toBeUndefined();
    expect(h.client.lastReq?.sourceLang).toBe('fr');
    expect(h.client.lastReq?.sourceLangOverride).toBe(true);
    expect(h.renderer.lastError).toBeNull();
  });

  it('[A12] onOverrideSourceLang always drops BOTH providerOverride and forceLiteral, whichever is currently set', async () => {
    let t = 5000;
    const idiomResult: LookupResult = {
      ...okResult,
      definedAs: { term: 'kick the bucket', isIdiom: true },
    };
    const h = harness({
      configuredProviders: ['gemini', 'openai'],
      now: () => t,
      impl: () => Promise.resolve(idiomResult),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

    // Switch provider — provider becomes 'openai'.
    t += 1;
    h.renderer.lastCtx!.onSwitchProvider!('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.client.lastReq?.provider).toBe('openai');

    // Override source lang from THIS ctx — providerOverride must NOT carry through.
    t += 1;
    h.renderer.lastCtx!.onOverrideSourceLang!('ja');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
    expect(h.client.lastReq?.provider).toBeUndefined();
    expect(h.client.lastReq?.forceLiteral).toBeUndefined();
    expect(h.client.lastReq?.sourceLang).toBe('ja');
    expect(h.client.lastReq?.sourceLangOverride).toBe(true);

    // Force literal from THIS ctx — forceLiteral becomes true (provider stays dropped).
    t += 1;
    h.renderer.lastCtx!.onForceLiteral!();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(4));
    expect(h.client.lastReq?.forceLiteral).toBe(true);
    expect(h.client.lastReq?.provider).toBeUndefined();

    // Override source lang again from THIS ctx — forceLiteral must NOT carry through either.
    t += 1;
    h.renderer.lastCtx!.onOverrideSourceLang!('auto');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(5));
    expect(h.client.lastReq?.forceLiteral).toBeUndefined();
    expect(h.client.lastReq?.provider).toBeUndefined();
    expect(h.client.lastReq?.sourceLang).toBeUndefined();
    expect(h.client.lastReq?.sourceLangOverride).toBe(true);
    expect(h.renderer.lastError).toBeNull();
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

  it('forwards client.lookup onChunk calls to renderer.renderPartial with the selected word (A1)', async () => {
    const renderer = new FakeResultRenderer();
    const client = new FakeLookupClient((_req, opts) => {
      opts?.onChunk?.('partial def', undefined);
      return Promise.resolve({
        markdown: 'full def',
        word: 'bank',
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: 1,
      });
    });
    const selection = new FakeSelectionSource();
    const trigger = new FakeTriggerUI();
    const settings = new FakeSettingsStore({
      targetLang: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: '',
      hasKey: true,
      theme: 'sepia',
      configuredProviders: ['gemini'],
      highlightSavedWords: true,
    });
    runLookupWorkflow({ selection, trigger, renderer, client, settings });
    selection.emit({
      text: 'bank',
      sentence: 'river bank',
      url: '',
      title: '',
      anchor: { x: 0, y: 0, w: 0, h: 0 },
    });
    trigger.click();
    await vi.waitFor(() => expect(renderer.calls).toContain('result'));
    expect(renderer.partials).toEqual([['bank', 'partial def', undefined]]);
  });

  it('drops a chunk that resolves after a newer selection has aborted this run (A1)', async () => {
    const renderer = new FakeResultRenderer();
    let capturedOnChunk: ((md: string) => void) | undefined;
    let t = 0;
    const client = new FakeLookupClient((req, opts) => {
      if (req.word === 'first') {
        capturedOnChunk = opts?.onChunk;
        return new Promise(() => {}); // never resolves; superseded before it would
      }
      return Promise.resolve({
        markdown: 'second def',
        word: 'second',
        target: 'vi',
        model: 'gemini-2.5-flash',
        fromCache: false,
        fetchedAt: 1,
      });
    });
    const selection = new FakeSelectionSource();
    const trigger = new FakeTriggerUI();
    const settings = new FakeSettingsStore({
      targetLang: 'vi',
      outputFormat: 'tpl',
      promptEnvelope: '',
      hasKey: true,
      theme: 'sepia',
      configuredProviders: ['gemini'],
      highlightSavedWords: true,
    });
    runLookupWorkflow({ selection, trigger, renderer, client, settings, now: () => t });
    selection.emit({
      text: 'first',
      sentence: 's',
      url: '',
      title: '',
      anchor: { x: 0, y: 0, w: 0, h: 0 },
    });
    trigger.click(); // lookup "first" at t=0
    await Promise.resolve();
    t = COOLDOWN_MS; // advance past the cooldown so "second" is a genuine new lookup, not blocked
    selection.emit({
      text: 'second',
      sentence: 's',
      url: '',
      title: '',
      anchor: { x: 0, y: 0, w: 0, h: 0 },
    });
    trigger.click(); // lookup "second" -> aborts "first"
    await vi.waitFor(() => expect(renderer.calls).toContain('result'));
    capturedOnChunk?.('stale, should not render');
    expect(renderer.partials).toEqual([]);
  });

  describe('A14: double-click bypass', () => {
    const dblSel: SelectionEvent = { ...sel, viaDoubleClick: true };

    it('doubleClickLookup on + a viaDoubleClick selection auto-fires runLookup, trigger never shown', async () => {
      const h = harness({ doubleClickLookup: true });
      h.selection.emit(dblSel);
      await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
      expect(h.trigger.shown).toBeNull(); // never shown — bypassed entirely
      expect(h.client.lastReq).toMatchObject({ word: 'bank', context: 'river bank' });
    });

    it('setting off (default) + a viaDoubleClick selection only shows the trigger, no auto-fire', async () => {
      const h = harness({}); // doubleClickLookup absent → off
      h.selection.emit(dblSel);
      await vi.waitFor(() => expect(h.trigger.shown).not.toBeNull());
      expect(h.renderer.calls).toEqual([]);
      h.trigger.click();
      await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    });

    it('setting on + a plain (non-double-click) selection never auto-fires — only viaDoubleClick bypasses', () => {
      const h = harness({ doubleClickLookup: true });
      h.selection.emit(sel); // no viaDoubleClick
      expect(h.trigger.shown).not.toBeNull();
      expect(h.renderer.calls).toEqual([]);
    });

    it('settings-read failure on a viaDoubleClick selection falls back to showing the trigger (never a silent no-op)', async () => {
      const h = harness({ doubleClickLookup: true });
      h.settings.get = () => Promise.reject(new Error('storage unavailable'));
      h.selection.emit(dblSel);
      // Design spec §5: fail toward the existing behavior — show the button rather than
      // silently doing nothing when settings.get() rejects.
      await vi.waitFor(() => expect(h.trigger.shown).not.toBeNull());
      expect(h.renderer.calls).toEqual([]);
      // Recovering the store makes the fallback trigger fully functional — clicking it runs a
      // normal lookup, confirming the failure degraded gracefully rather than dead-ending.
      h.settings.get = () => Promise.resolve(h.settings.value);
      h.trigger.click();
      await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    });

    it('the double-click auto-fire path is still cooldown-gated (same RATE_LIMIT as a rapid double-click)', async () => {
      let t = 0;
      const h = harness({ doubleClickLookup: true, now: () => t });
      h.selection.emit(dblSel);
      await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
      t = COOLDOWN_MS - 1; // still inside the window
      h.selection.emit(dblSel);
      await vi.waitFor(() => expect(h.renderer.lastError?.code).toBe('RATE_LIMIT'));
      expect(h.renderer.lastError?.message).toContain('Slow down');
    });
  });
});

describe('runLookupWorkflow — recursive lookup (A2)', () => {
  const insideSel = (word: string, sentence: string): SelectionEvent => ({
    text: word,
    sentence,
    anchor: { x: 0, y: 0, w: 1, h: 1 },
    url: 'u',
    title: 't',
    insideResult: true,
  });

  it('a fresh (non-recursive) selection renders with ctx.onBack undefined (root of a chain)', async () => {
    const h = harness({});
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined();
  });

  it('a selection inside the result pushes the chain: ctx.onBack pops to the parent with NO new client.lookup call', async () => {
    let t = 0;
    let calls = 0;
    const results: LookupResult[] = [
      { ...okResult, word: 'bank' },
      { ...okResult, word: 'institution' },
    ];
    const h = harness({ now: () => t, impl: () => Promise.resolve(results[calls++]!) });
    h.selection.emit(sel); // outer: "bank"
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));
    const parentResult = h.renderer.lastResult;

    t = COOLDOWN_MS; // A2: recursion is still gated by the cooldown (design spec §3)
    h.selection.emit(insideSel('institution', 'A financial institution.'));
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.renderer.lastResult?.word).toBe('institution');
    expect(typeof h.renderer.lastCtx?.onBack).toBe('function');
    expect(calls).toBe(2); // exactly 2 real lookups so far

    h.renderer.lastCtx!.onBack!();
    expect(h.renderer.lastResult).toEqual(parentResult); // back to "bank", verbatim
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // back at the root — nothing further up
    expect(calls).toBe(2); // Back made ZERO additional client.lookup calls
  });

  it('a recursive push is still subject to the cooldown gate (no bypass, per design spec §3)', async () => {
    let t = 0;
    const h = harness({ now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));

    t = COOLDOWN_MS - 1; // still inside the window
    h.selection.emit(insideSel('bank', 'sentence'));
    h.trigger.click();
    expect(h.renderer.lastError?.code).toBe('RATE_LIMIT');
    expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1); // blocked, not fired
  });

  it('depth cap: after RECURSIVE_LOOKUP_DEPTH_CAP chained pushes, a further in-result selection shows NO trigger', async () => {
    let t = 0;
    let calls = 0;
    const h = harness({
      now: () => t,
      impl: () => Promise.resolve({ ...okResult, word: `w${calls++}` }),
    });
    h.selection.emit(sel); // depth 1
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));

    for (let i = 0; i < RECURSIVE_LOOKUP_DEPTH_CAP - 1; i++) {
      t += COOLDOWN_MS;
      h.selection.emit(insideSel(`w${i}`, 'sentence'));
      expect(h.trigger.shown).not.toBeNull(); // trigger offered below the cap
      h.trigger.click();
      await vi.waitFor(() =>
        expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(i + 2),
      );
    }
    // Now at depth RECURSIVE_LOOKUP_DEPTH_CAP: one more in-result selection offers nothing.
    t += COOLDOWN_MS;
    h.selection.emit(insideSel('deeper', 'sentence'));
    expect(h.trigger.shown).toBeNull();
  });

  it('an ordinary selection after a chain resets it: the next result has ctx.onBack undefined again', async () => {
    let t = 0;
    let calls = 0;
    const h = harness({
      now: () => t,
      impl: () => Promise.resolve({ ...okResult, word: `w${calls++}` }),
    });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));

    t = COOLDOWN_MS;
    h.selection.emit(insideSel('w0', 'sentence'));
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(typeof h.renderer.lastCtx?.onBack).toBe('function'); // depth 2, has a parent

    t = 2 * COOLDOWN_MS; // an ordinary (non-recursive) selection elsewhere
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(3));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // fresh chain, no parent
  });

  it('onSwitchProvider replaces the top frame in place — canGoBack unaffected at the root', async () => {
    let t = 5000;
    const h = harness({ configuredProviders: ['gemini', 'openai'], now: () => t });
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls).toContain('result'));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined();
    t = 5001;
    h.renderer.lastCtx!.onSwitchProvider!('openai');
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // still the root — a switch is not a push
  });

  it('a superseded (aborted) recursive lookup that resolves late does not corrupt the stack (A2 abort-race regression)', async () => {
    let t = 0;
    let resolveB!: (r: LookupResult) => void;
    const bPending = new Promise<LookupResult>((res) => {
      resolveB = res;
    });
    const h = harness({
      now: () => t,
      impl: (req) => {
        if (req.word === 'inner') return bPending; // recursive B — stays in flight, then aborted
        if (req.word === 'child') return Promise.resolve({ ...okResult, word: 'child' });
        return Promise.resolve({ ...okResult, word: 'bank' }); // root + the superseding selection
      },
    });

    // depth 1 root ("bank")
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(1));

    // recursive lookup B ("inner") — starts, stays in flight (bPending)
    t = COOLDOWN_MS;
    h.selection.emit(insideSel('inner', 'inner sentence'));
    h.trigger.click();

    // supersede B with an ordinary page selection ("bank") — aborts B's controller, resets chain
    t = 2 * COOLDOWN_MS;
    h.selection.emit(sel);
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.calls.filter((c) => c === 'result').length).toBe(2));
    expect(h.renderer.lastCtx?.onBack).toBeUndefined(); // fresh root of a new chain

    // B resolves LATE, after being aborted — must NOT mutate the stack
    resolveB({ ...okResult, word: 'inner' });
    await Promise.resolve();
    await Promise.resolve();

    // A fresh recursive lookup now pushes exactly one level; Back must return to the fresh root
    // ("bank"), never the phantom aborted "inner" frame.
    t = 3 * COOLDOWN_MS;
    h.selection.emit(insideSel('child', 'child sentence'));
    h.trigger.click();
    await vi.waitFor(() => expect(h.renderer.lastResult?.word).toBe('child'));
    expect(typeof h.renderer.lastCtx?.onBack).toBe('function');
    h.renderer.lastCtx!.onBack!();
    expect(h.renderer.lastResult?.word).toBe('bank'); // guarded: fresh root, not the phantom "inner"
  });
});
