import type { LookupError } from './types';

export type ErrorInput =
  | { kind: 'no-key' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'parse' }
  | { kind: 'http'; status: number; geminiStatus?: string; retryAfterSec?: number }
  | { kind: 'thrown'; error: unknown };

function sanitize(msg: string): string {
  return msg
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted]') // scrub Google API-key shaped tokens
    .slice(0, 200);
}

export function mapError(input: ErrorInput): LookupError {
  switch (input.kind) {
    case 'no-key':
      return { code: 'NO_KEY', message: 'Add your Gemini API key in Settings.', retryable: false };
    case 'offline':
    case 'timeout':
      return {
        code: 'NETWORK',
        message: 'Network failed. Check connection and retry.',
        retryable: true,
      };
    case 'parse':
      return { code: 'PARSE', message: 'Gemini returned unexpected output.', retryable: false };
    case 'http': {
      const { status, geminiStatus, retryAfterSec } = input;
      if (status === 400 && geminiStatus === 'INVALID_ARGUMENT')
        return { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false };
      if (
        status === 401 ||
        status === 403 ||
        geminiStatus === 'UNAUTHENTICATED' ||
        geminiStatus === 'PERMISSION_DENIED'
      )
        return { code: 'INVALID_KEY', message: 'Google rejected the API key.', retryable: false };
      if (status === 429 || geminiStatus === 'RESOURCE_EXHAUSTED')
        return {
          code: 'RATE_LIMIT',
          message: 'Hit Gemini rate limit.',
          retryable: true,
          ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
        };
      if (status >= 500)
        return { code: 'NETWORK', message: 'Gemini server error. Retry.', retryable: true };
      return { code: 'UNKNOWN', message: sanitize(`HTTP ${status}`), retryable: false };
    }
    case 'thrown': {
      const msg = input.error instanceof Error ? input.error.message : String(input.error);
      return { code: 'UNKNOWN', message: sanitize(`Lookup failed: ${msg}`), retryable: false };
    }
  }
}
