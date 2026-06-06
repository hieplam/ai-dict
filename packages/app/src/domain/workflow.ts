import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  LookupClient,
  SettingsStore,
} from '../ports';
import type { SelectionEvent, LookupRequest, LookupError } from './types';
import { isLookupError } from './types';
import { mapError } from './error-mapper';

export interface WorkflowDeps {
  selection: SelectionSource;
  trigger: TriggerUI;
  renderer: ResultRenderer;
  client: LookupClient;
  settings: SettingsStore;
}

function toLookupError(err: unknown): LookupError {
  return isLookupError(err) ? err : mapError({ kind: 'thrown', error: err });
}

export function runLookupWorkflow(deps: WorkflowDeps): () => void {
  let inFlight: AbortController | null = null;

  async function runLookup(e: SelectionEvent): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    // try/finally ensures hide() fires even if settings.get() rejects (stuck-spinner guard);
    // the abort guard inside finally prevents double-hide when a newer click cancels this run
    const settings = await deps.settings.get().finally(() => {
      if (!controller.signal.aborted) deps.trigger.hide();
    });
    // hide bubble once settings are known — keeps spinner visible during the async gap
    if (!settings.hasKey) {
      deps.renderer.renderError(mapError({ kind: 'no-key' }));
      return;
    }
    deps.renderer.renderLoading();
    const req: LookupRequest = {
      word: e.text,
      context: e.sentence,
      url: e.url,
      title: e.title,
      target: settings.targetLang,
      promptTemplate: settings.promptTemplate,
    };
    try {
      const result = await deps.client.lookup(req, { signal: controller.signal });
      if (!controller.signal.aborted) deps.renderer.renderResult(result);
    } catch (err) {
      if (!controller.signal.aborted) deps.renderer.renderError(toLookupError(err));
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  const teardown = deps.selection.onSelection((e) => {
    deps.trigger.show(e.anchor, () => {
      // hide() is now called inside runLookup after settings.get() resolves
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
