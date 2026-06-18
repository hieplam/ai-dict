import { describe, it, expect } from 'vitest';
import { buildGa4Request, GA4_ENDPOINT } from '../../src/app/ga4-payload';
import type { ErrorRecord } from '../../src/domain/error-report';

const rec: ErrorRecord = {
  ts: 1000,
  source: 'lookup',
  code: 'RATE_LIMIT',
  provider: 'gemini',
  message: 'quota exceeded for this key very long '.repeat(10),
  retryable: true,
  retryAfterSec: 30,
  domain: 'nytimes.com',
  extVersion: '1.5.0',
  browserVersion: 'Chrome/124',
};

describe('buildGa4Request', () => {
  const req = buildGa4Request([rec], {
    clientId: 'cid-1',
    measurementId: 'G-XXX',
    apiSecret: 'sek',
  });

  it('targets the GA4 collect endpoint with measurement_id + api_secret query', () => {
    expect(req.url).toBe(`${GA4_ENDPOINT}?measurement_id=G-XXX&api_secret=sek`);
    expect(req.method).toBe('POST');
  });

  type Ga4Body = {
    client_id: string;
    events: { name: string; params: Record<string, string | number> }[];
  };

  it('emits one extension_error event per record with the signature params', () => {
    const body = JSON.parse(req.body) as Ga4Body;
    expect(body.client_id).toBe('cid-1');
    expect(body.events).toHaveLength(1);
    const e = body.events[0]!;
    expect(e.name).toBe('extension_error');
    expect(e.params).toMatchObject({
      code: 'RATE_LIMIT',
      provider: 'gemini',
      source: 'lookup',
      domain: 'nytimes.com',
      ext_version: '1.5.0',
      browser_version: 'Chrome/124',
      retry_after_sec: 30,
    });
  });

  it('truncates msg param to GA4 100-char limit', () => {
    const body = JSON.parse(req.body) as Ga4Body;
    expect(String(body.events[0]!.params.msg).length).toBeLessThanOrEqual(100);
  });
});

describe('buildGa4Request — vendor diagnostic params (adr-20260618)', () => {
  type Ga4Body = {
    client_id: string;
    events: { name: string; params: Record<string, string | number> }[];
  };
  const vrec: ErrorRecord = {
    ...rec,
    code: 'NETWORK',
    httpStatus: 503,
    vendorStatus: 'UNAVAILABLE',
    vendorMessage: 'The model is overloaded. Please try again later.',
  };

  it('emits http_status, vendor_status and vendor_msg params', () => {
    const req = buildGa4Request([vrec], { clientId: 'c', measurementId: 'G', apiSecret: 's' });
    const body = JSON.parse(req.body) as Ga4Body;
    expect(body.events[0]!.params).toMatchObject({
      http_status: 503,
      vendor_status: 'UNAVAILABLE',
      vendor_msg: 'The model is overloaded. Please try again later.',
    });
  });

  it('omits the vendor params when the record lacks them', () => {
    const req = buildGa4Request([rec], { clientId: 'c', measurementId: 'G', apiSecret: 's' });
    const params = (JSON.parse(req.body) as Ga4Body).events[0]!.params;
    expect('http_status' in params).toBe(false);
    expect('vendor_status' in params).toBe(false);
    expect('vendor_msg' in params).toBe(false);
  });

  it('truncates vendor_msg to the GA4 100-char limit', () => {
    const long: ErrorRecord = { ...vrec, vendorMessage: 'y'.repeat(300) };
    const req = buildGa4Request([long], { clientId: 'c', measurementId: 'G', apiSecret: 's' });
    const params = (JSON.parse(req.body) as Ga4Body).events[0]!.params;
    expect(String(params.vendor_msg).length).toBeLessThanOrEqual(100);
  });
});
