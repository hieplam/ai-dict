import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  ResultRenderContext,
  LookupClient,
  SettingsStore,
} from '../ports';
import type { SelectionEvent, LookupRequest, LookupError, Provider } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';

// A human spamming Define fires a burst of sequential lookups that trip the provider's
// per-minute quota (Gemini 429 / RESOURCE_EXHAUSTED). Gate lookups to at most one per this
// window — first-come-first-served: the first fires immediately; a follow-up within the
// window is blocked with a 'slow down' message (see the cooldown gate below).
export const COOLDOWN_MS = 2000;

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

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;
  // Timestamp of the last lookup that actually fired. -Infinity = "never fired", so the
  // first click always passes. Updated ONLY on a real fire (never on a blocked attempt) so
  // continuous spamming cannot extend the lockout past one window.
  let lastFireAt = -Infinity;
  const now = deps.now ?? (() => Date.now());

  async function runLookup(e: SelectionEvent, providerOverride?: Provider): Promise<void> {
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
    deps.renderer.renderLoading(e.text);
    const req: LookupRequest = {
      word: e.text,
      context: e.sentence,
      url: e.url,
      title: e.title,
      target: settings.targetLang,
      outputFormat: settings.outputFormat,
    };
    // A manual pick re-runs THIS selection once against the chosen provider (one-shot).
    if (providerOverride) req.provider = providerOverride;
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      // Offer the one-shot picker only when there's more than one provider to choose from.
      const ctx: ResultRenderContext | undefined =
        settings.configuredProviders.length >= 2
          ? {
              providers: settings.configuredProviders,
              onSwitchProvider: (p) => {
                // Deliberate switch bypasses the Define-spam cooldown — it's not spam.
                void runLookup(e, p).catch((err) =>
                  deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
                );
              },
            }
          : undefined;
      if (!controller.signal.aborted) deps.renderer.renderResult(result, ctx);
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    deps.trigger.show(e.anchor, () => {
      // Cooldown gate, checked BEFORE runLookup. runLookup begins by aborting the in-flight
      // request, so gating here means a too-fast second click neither fires a new request NOR
      // cancels the first one already in flight — first-come-first-served.
      const t = now();
      if (t - lastFireAt < COOLDOWN_MS) {
        deps.trigger.hide();
        deps.renderer.renderError(mapError({ kind: 'cooldown' }));
        return;
      }
      lastFireAt = t;
      void runLookup(e).catch((err) =>
        deps.renderer.renderError(mapError({ kind: 'thrown', error: err })),
      );
    });
  });

  return () => {
    inFlight?.abort();
    inFlight = null;
    deps.trigger.hide();
    deps.renderer.close();
    teardown();
  };
}
