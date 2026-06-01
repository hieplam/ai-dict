import type {
  SelectionSource,
  TriggerUI,
  ResultRenderer,
  LookupClient,
  SettingsStore,
  SelectionEvent,
  LookupRequest,
  LookupError,
} from './index';
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

    const settings = await deps.settings.get();
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
      deps.trigger.hide();
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
