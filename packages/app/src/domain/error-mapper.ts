import type { LookupError, Provider } from './types';
import { scrubSecrets } from './pii';

export type ErrorInput =
  | { kind: 'no-key'; provider?: Provider }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'parse'; provider?: Provider }
  | {
      kind: 'http';
      status: number;
      geminiStatus?: string;
      retryAfterSec?: number;
      provider?: Provider;
      /** Raw provider error.message; scrubbed + capped here before it can leave the device. */
      vendorMessage?: string;
    }
  | { kind: 'thrown'; error: unknown };

// User-facing vendor wording per provider; absent provider keeps the original
// Gemini wording, so pre-provider call sites and messages are unchanged.
const NAMES: Record<Provider, { product: string; vendor: string }> = {
  gemini: { product: 'Gemini', vendor: 'Google' },
  openai: { product: 'OpenAI', vendor: 'OpenAI' },
};

function sanitize(msg: string): string {
  return scrubSecrets(msg).slice(0, 200);
}

export function mapError(input: ErrorInput): LookupError {
  switch (input.kind) {
    case 'no-key': {
      const { product } = NAMES[input.provider ?? 'gemini'];
      return {
        code: 'NO_KEY',
        message: `Add your ${product} API key in Settings.`,
        retryable: false,
      };
    }
    case 'offline':
    case 'timeout':
      return {
        code: 'NETWORK',
        message: 'Network failed. Check connection and retry.',
        retryable: true,
      };
    case 'parse': {
      const { product } = NAMES[input.provider ?? 'gemini'];
      return { code: 'PARSE', message: `${product} returned unexpected output.`, retryable: false };
    }
    case 'http': {
      const { status, geminiStatus, retryAfterSec, vendorMessage } = input;
      const { product, vendor } = NAMES[input.provider ?? 'gemini'];
      // The vendor's own failure signature, attached to EVERY http-mapped error for telemetry.
      // httpStatus/vendorStatus are safe provider enums/numbers; vendorMessage is free text so it
      // is secret-scrubbed + capped HERE, before the LookupError can cross the wire (S1).
      const diag: Pick<LookupError, 'httpStatus' | 'vendorStatus' | 'vendorMessage'> = {
        httpStatus: status,
        ...(geminiStatus !== undefined ? { vendorStatus: geminiStatus } : {}),
        ...(vendorMessage ? { vendorMessage: sanitize(vendorMessage) } : {}),
      };
      const base = ((): LookupError => {
        if (status === 400 && geminiStatus === 'INVALID_ARGUMENT')
          return {
            code: 'INVALID_KEY',
            message: `${vendor} rejected the API key.`,
            retryable: false,
          };
        if (
          status === 401 ||
          status === 403 ||
          geminiStatus === 'UNAUTHENTICATED' ||
          geminiStatus === 'PERMISSION_DENIED'
        )
          return {
            code: 'INVALID_KEY',
            message: `${vendor} rejected the API key.`,
            retryable: false,
          };
        if (status === 429 || geminiStatus === 'RESOURCE_EXHAUSTED')
          return {
            code: 'RATE_LIMIT',
            message: `Hit ${product} rate limit.`,
            retryable: true,
            ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
          };
        if (status >= 500)
          return { code: 'NETWORK', message: `${product} server error. Retry.`, retryable: true };
        return { code: 'UNKNOWN', message: sanitize(`HTTP ${status}`), retryable: false };
      })();
      return { ...base, ...diag };
    }
    case 'thrown': {
      const msg = input.error instanceof Error ? input.error.message : String(input.error);
      return { code: 'UNKNOWN', message: sanitize(`Lookup failed: ${msg}`), retryable: false };
    }
  }
}
