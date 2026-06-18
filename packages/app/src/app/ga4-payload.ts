import type { ErrorRecord } from '../domain/error-report';

export const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GA4_PARAM_MAX = 100; // GA4 truncates string param VALUES beyond ~100 chars

export interface Ga4Config {
  clientId: string;
  measurementId: string;
  apiSecret: string;
}

export interface Ga4Request {
  url: string;
  method: 'POST';
  body: string;
}

function toEvent(rec: ErrorRecord) {
  const params: Record<string, string | number> = {
    code: rec.code,
    source: rec.source,
    msg: rec.message.slice(0, GA4_PARAM_MAX),
    ext_version: rec.extVersion,
    browser_version: rec.browserVersion.slice(0, GA4_PARAM_MAX),
  };
  if (rec.provider) params.provider = rec.provider;
  if (rec.domain) params.domain = rec.domain;
  if (rec.retryable !== undefined) params.retryable = rec.retryable ? 1 : 0;
  if (rec.retryAfterSec !== undefined) params.retry_after_sec = rec.retryAfterSec;
  // Provider failure signature, so GA4 can split e.g. 503 UNAVAILABLE from 500 INTERNAL.
  if (rec.httpStatus !== undefined) params.http_status = rec.httpStatus;
  if (rec.vendorStatus) params.vendor_status = rec.vendorStatus.slice(0, GA4_PARAM_MAX);
  if (rec.vendorMessage) params.vendor_msg = rec.vendorMessage.slice(0, GA4_PARAM_MAX);
  return { name: 'extension_error', params };
}

/** Build the GA4 Measurement Protocol POST for a batch of error records. */
export function buildGa4Request(records: ErrorRecord[], cfg: Ga4Config): Ga4Request {
  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(
    cfg.measurementId,
  )}&api_secret=${encodeURIComponent(cfg.apiSecret)}`;
  const body = JSON.stringify({ client_id: cfg.clientId, events: records.map(toEvent) });
  return { url, method: 'POST', body };
}
