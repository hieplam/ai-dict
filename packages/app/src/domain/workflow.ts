import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
} from '../ports';
import type {
  SelectionEvent,
  LookupRequest,
  LookupResult,
  LookupError,
  Provider,
  RefineKind,
} from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';

// A human spamming Define fires a burst of sequential lookups that trip the provider's
// per-minute quota (Gemini 429 / RESOURCE_EXHAUSTED). Gate lookups to at most one per this
// window — first-come-first-served: the first fires immediately; a follow-up within the
// window is blocked with a 'slow down' message (see the cooldown gate below).
export const COOLDOWN_MS = 2000;

// A2: the maximum number of cards ever in the recursive-lookup chain at once, counting the
// original lookup (depth 1). Selecting a word inside a definition once the chain is already at
// this depth shows no "Define" trigger at all (see the onSelection gate below) — no wasted paid
// call, no new UI state; the reader just taps Back first. See design spec §4 for why "3" means
// the whole chain, not 3 additional nested levels.
export const RECURSIVE_LOOKUP_DEPTH_CAP = 3;

export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
  /**
   * Wall clock for the cooldown gate; injectable so tests advance time deterministically.
   * Defaults to Date.now (a JS builtin — not chrome/fetch/DOM, so the domain stays pure).
   * Composition roots omit it and get the real clock.
   */
  now?: () => number;
}

function toLookupError(err: unknown): LookupError {
  return isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
}

// A2: one frame of the recursive-lookup chain — the selection that produced it, the fetched
// result, the provider list known at fetch time (cached so Back can rebuild ctx without
// re-fetching settings), and the refine (if any) that produced it (so Back reproduces the
// refine badge). Internal to this module; plain data only (rule-domain-purity).
interface StackFrame {
  event: SelectionEvent;
  result: LookupResult;
  providers: Provider[];
  refine?: RefineKind;
}

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;
  // Timestamp of the last lookup that actually fired. -Infinity = "never fired", so the
  // first click always passes. Updated ONLY on a real fire (never on a blocked attempt) so
  // continuous spamming cannot extend the lockout past one window.
  let lastFireAt = -Infinity;
  const now = deps.now ?? (() => Date.now());
  // A2: the recursive-lookup chain, oldest first, last = currently displayed. Reset to a single
  // frame by any ordinary (non-recursive) selection; extended (pushed) by an in-definition
  // selection; shrunk by Back; capped at RECURSIVE_LOOKUP_DEPTH_CAP frames. Plain data — no DOM/
  // chrome access here (rule-domain-purity).
  let stack: StackFrame[] = [];

  /**
   * Build the ResultRenderContext for a given stack frame — reused by a fresh render, a
   * provider-switch / force-literal / refine re-run, and Back (which needs to rebuild ctx for the
   * frame it pops back to, with zero new network calls). Reproduces exactly the ctx the inline
   * builder produced before A2, plus the A2 onBack key when a parent frame exists below this one.
   */
  function buildCtx(frame: StackFrame): ResultRenderContext {
    const { event: e, result, providers, refine } = frame;
    // Offer the one-shot picker only when there's more than one provider to choose from.
    const showPicker = providers.length >= 2;
    // A8: offer the "Show literal word" override only when THIS result is an idiom.
    const isIdiom = result.definedAs?.isIdiom === true;
    // A2: a Back button is offered whenever this frame has a parent below it in the chain.
    const canGoBack = stack.length > 1;
    return {
      // B1: sentence/url/title always ride along (see ResultRenderContext's doc comment) so a
      // star tap after render can still persist them.
      sentence: e.sentence,
      url: e.url,
      title: e.title,
      onRefine: (kind: RefineKind) => {
        // A3: deliberate one-shot re-run of the SAME original selection; bypasses cooldown —
        // same reasoning as onSwitchProvider/onForceLiteral below. Always resets provider
        // override and forceLiteral to defaults (design spec §2.4(c)). A2: re-answers the current
        // card in place (replace-top), not a new recursion level.
        void runLookup(e, undefined, undefined, kind, 'replace-top').catch((err) =>
          deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
        );
      },
      ...(refine !== undefined ? { refine } : {}),
      ...(showPicker
        ? {
            providers,
            onSwitchProvider: (p: Provider) => {
              // Deliberate switch bypasses the Define-spam cooldown — it's not spam. A2: it
              // replaces the current frame in place (same depth), not a new recursion level.
              void runLookup(e, p, undefined, undefined, 'replace-top').catch((err) =>
                deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
              );
            },
          }
        : {}),
      ...(isIdiom
        ? {
            onForceLiteral: () => {
              // Deliberate override bypasses the Define-spam cooldown — same reasoning as
              // onSwitchProvider above. A2: also replaces the current frame in place.
              void runLookup(e, undefined, true, undefined, 'replace-top').catch((err) =>
                deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
              );
            },
          }
        : {}),
      ...(canGoBack
        ? {
            onBack: () => {
              // A2: pop the current frame and re-render its parent — no network call, a pure
              // local re-render of an already-fetched result (design spec §5).
              stack.pop();
              const parent = stack[stack.length - 1];
              if (!parent) return; // unreachable: canGoBack guarantees a parent exists
              deps.renderer.renderResult(parent.result, buildCtx(parent));
            },
          }
        : {}),
    };
  }

  async function runLookup(
    e: SelectionEvent,
    providerOverride?: Provider,
    forceLiteral?: boolean,
    refine?: RefineKind,
    stackOp: 'push' | 'replace-top' | 'reset' = 'reset',
  ): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    // try/finally ensures hide() fires even if settings.get() rejects (stuck-spinner guard);
    // the abort guard inside finally prevents double-hide when a newer click cancels this run
    const settings = await deps.settings.get().finally(() => {
      if (!controller.signal.aborted) deps.trigger.hide();
    });
    // hide bubble once settings are known — keeps spinner visible during the async gap
    if (settings.configuredProviders.length === 0) {
      deps.renderer.renderError(mapError({ kind: 'no-key' }));
      return;
    }
    deps.renderer.renderLoading(e.text, e.anchor);
    const req: LookupRequest = {
      word: e.text,
      context: e.sentence,
      url: e.url,
      title: e.title,
      target: settings.targetLang,
      outputFormat: settings.outputFormat,
      promptEnvelope: settings.promptEnvelope,
    };
    // A manual pick re-runs THIS selection once against the chosen provider (one-shot).
    if (providerOverride) req.provider = providerOverride;
    // A8: a manual "Show literal word" pick re-runs THIS selection once, forcing the literal
    // single-word reading (one-shot).
    if (forceLiteral) req.forceLiteral = true;
    // A3: a refine chip tap re-runs THIS selection once, asking for a specific refinement
    // (one-shot).
    if (refine) req.refine = refine;
    try {
      const result = await deps.client.lookup(req, {
        signal: controller.signal,
        // A1: forward streaming previews to the renderer, guarded exactly like the terminal
        // renderResult call below — a chunk that resolves after a NEWER selection has already
        // aborted this run must never repaint a stale card.
        onChunk: (md, definedAs) => {
          if (!controller.signal.aborted) deps.renderer.renderPartial?.(e.text, md, definedAs);
        },
      });
      // A2: update the chain per the caller's requested operation BEFORE building ctx, so
      // buildCtx's canGoBack check sees the post-update depth.
      const frame: StackFrame = {
        event: e,
        result,
        providers: settings.configuredProviders,
        ...(refine !== undefined ? { refine } : {}),
      };
      // A2 abort-race guard: a superseded run (a newer selection called inFlight.abort()) whose
      // lookup still resolves successfully — the relay client only fires a `lookup.cancel` and does
      // not reject, and the SW reply can land as the cancel arrives — must touch NEITHER the render
      // NOR the nav stack. An unguarded stack mutation would leave a phantom frame that inflates
      // depth (premature depth-cap) or that Back later pops into (stale definition shown). The
      // render was already guarded; the stack mutation moves under the SAME guard so the two stay
      // atomic with respect to abort.
      if (!controller.signal.aborted) {
        if (stackOp === 'push') stack.push(frame);
        else if (stackOp === 'replace-top' && stack.length > 0) stack[stack.length - 1] = frame;
        else stack = [frame]; // 'reset', or a defensive fallback for 'replace-top' on an empty stack
        deps.renderer.renderResult(result, buildCtx(frame));
      }
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    // A2 depth cap: an in-definition selection once the chain is already at its cap gets no
    // trigger at all — same silent-no-op precedent as a collapsed selection (DomSelectionSource
    // returns null for those; see design spec §4).
    if (e.insideResult === true && stack.length >= RECURSIVE_LOOKUP_DEPTH_CAP) return;
    deps.trigger.show(e.anchor, () => {
      // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
      // request, so gating here means a too-fast second click neither fires a new request NOR
      // cancels the first one already in flight — first-come-first-served. A2: this gate is NOT
      // bypassed for recursive in-definition lookups (design spec §3) — only the deliberate
      // provider-switch/force-literal/refine re-runs bypass it.
      const t = now();
      if (t - lastFireAt < COOLDOWN_MS) {
        deps.trigger.hide();
        deps.renderer.renderError(mapError({ kind: 'cooldown' }));
        return;
      }
      lastFireAt = t;
      // A2: a selection inside the current result's definition extends the chain (push); any
      // other selection starts a fresh one (reset) — exactly today's existing "select elsewhere
      // replaces the card" behavior, now made explicit as one of three stack operations.
      const stackOp = e.insideResult === true && stack.length > 0 ? 'push' : 'reset';
      void runLookup(e, undefined, undefined, undefined, stackOp).catch((err) =>
        deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
      );
    });
  });

  return () => {
    inFlight?.abort();
    inFlight = null;
    deps.trigger.hide();
    deps.renderer.close();
    stack = [];
    teardown();
  };
}
