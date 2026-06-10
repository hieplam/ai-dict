import type { LookupClient, LookupRequest, LookupResult, Provider } from '../index';

export interface LookupClientSelectorDeps {
  /** One concrete client per provider, built once by the composition root. */
  clients: Record<Provider, LookupClient>;
  /** Resolved per lookup so a settings change applies without rebuilding the router. */
  getProvider: () => Provider | Promise<Provider>;
}

/**
 * A `LookupClient` that delegates each call to the client of the currently
 * selected provider. Selection happens per lookup — mirroring how the clients
 * already resolve `getApiKey()` per call — so the MV3 service worker needs no
 * settings listener or router rebuild when the user switches providers.
 */
export function createLookupClientSelector(deps: LookupClientSelectorDeps): LookupClient {
  return {
    async lookup(req: LookupRequest, opts?: { signal?: AbortSignal }): Promise<LookupResult> {
      const provider = await deps.getProvider();
      return deps.clients[provider].lookup(req, opts);
    },
  };
}
