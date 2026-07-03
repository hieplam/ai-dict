import type { LookupClient, LookupRequest, LookupResult, Provider } from '../index';
import { isLookupError } from '../index';

// Canonical provider order for the fallback tail: when a provider fails, the pool
// tries remaining configured providers in this order. The primary (user-selected
// or one-shot picked) provider is always tried first regardless of where it falls here.
const PROVIDER_ORDER: readonly Provider[] = ['gemini', 'openai', 'anthropic'];

function isKnownProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDER_ORDER as readonly string[]).includes(v);
}

export interface ProviderPoolDeps {
  /** One concrete client per provider, built once by the composition root. */
  clients: Record<Provider, LookupClient>;
  /**
   * Returns the user's currently selected provider — resolved per lookup so
   * a settings change applies without rebuilding the router.
   */
  getProvider: () => Provider | Promise<Provider>;
  /**
   * Returns the list of providers that have a key configured. Used to build the
   * fallback candidate list: only providers with keys are tried. Resolved per lookup.
   */
  getConfiguredProviders: () => Provider[] | Promise<Provider[]>;
}

/**
 * A `LookupClient` that tries the primary provider first, then silently falls
 * back to other configured providers if the primary fails for a recoverable
 * reason. Sets `result.fallbackFrom` when a non-primary provider answers.
 *
 * Stops trying early when:
 * - The caller's signal is aborted (user cancel).
 * - The device is offline (`navigator.onLine === false`) — no provider can succeed.
 */
export function createProviderPool(deps: ProviderPoolDeps): LookupClient {
  return {
    async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
      // A one-shot manual pick from the card (req.provider) overrides the stored default
      // for THIS call only — it becomes the primary and runs first, even if keyless (its
      // NO_KEY error then falls through to the next configured provider: any-failure semantics).
      const primary = isKnownProvider(req.provider) ? req.provider : await deps.getProvider();
      const configured = await deps.getConfiguredProviders();

      // Build the ordered candidate list: primary first, then remaining configured
      // providers in PROVIDER_ORDER, excluding the primary to avoid duplication.
      const candidates: Provider[] = [
        primary,
        ...PROVIDER_ORDER.filter((p) => p !== primary && configured.includes(p)),
      ];

      let firstError: unknown;
      for (let i = 0; i < candidates.length; i++) {
        // Caller cancelled — stop immediately; propagate so the router suppresses the reply.
        if (opts?.signal?.aborted)
          throw opts.signal.reason ?? new DOMException('cancelled', 'AbortError');

        // Device offline — no point trying further providers.
        if (navigator.onLine === false && i > 0) throw firstError;

        const provider = candidates[i]!;
        try {
          const result = await deps.clients[provider].lookup(req, opts);
          // If we answered from a fallback provider, annotate the result.
          if (i > 0) result.fallbackFrom = primary;
          return result;
        } catch (err) {
          if (i === 0) firstError = err;
          // Caller-cancel: abort signal fired during the client call → stop immediately.
          if (opts?.signal?.aborted) throw err;
          // Device went offline during this attempt — further providers won't help.
          if (isLookupError(err) && err.code === 'NETWORK' && navigator.onLine === false) throw err;
          // For any other failure, continue to the next candidate.
        }
      }

      // All candidates exhausted — throw the primary provider's error for correct failure attribution.
      throw firstError;
    },
  };
}
