import type { LookupError, Provider } from './types';

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
    }
  | { kind: 'thrown'; error: unknown };

// User-facing vendor wording per provider; absent provider keeps the original
// Gemini wording, so pre-provider call sites and messages are unchanged.
const NAMES: Record<Provider, { product: string; vendor: string }> = {
  gemini: { product: 'Gemini', vendor: 'Google' },
  openai: { product: 'OpenAI', vendor: 'OpenAI' },
};

function sanitize(msg: string): string {
  return msg
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') // scrub Google API-key shaped tokens
    .replace(/sk-[0-9A-Za-z_-]{8,}/g, '[redacted]') // scrub OpenAI API-key shaped tokens
    .slice(0, 200);
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
      const { status, geminiStatus, retryAfterSec } = input;
      const { product, vendor } = NAMES[input.provider ?? 'gemini'];
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
    }
    case 'thrown': {
      const msg = input.error instanceof Error ? input.error.message : String(input.error);
      return { code: 'UNKNOWN', message: sanitize(`Lookup failed: ${msg}`), retryable: false };
    }
  }
}
