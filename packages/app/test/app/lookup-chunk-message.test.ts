import { describe, it, expect } from 'vitest';
import { isLookupChunkMessage } from '../../src/app/lookup-chunk-message';

describe('lookup chunk message guard (A1)', () => {
  it('accepts a minimal chunk message', () => {
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 'r1', markdown: 'hi' })).toBe(
      true,
    );
  });

  it('accepts a chunk message with definedAs', () => {
    expect(
      isLookupChunkMessage({
        type: 'lookup.chunk',
        requestId: 'r1',
        markdown: 'hi',
        definedAs: { term: 'kick the bucket', isIdiom: true },
      }),
    ).toBe(true);
  });

  it('rejects a missing/wrong-typed requestId or markdown', () => {
    expect(isLookupChunkMessage({ type: 'lookup.chunk', markdown: 'hi' })).toBe(false);
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 'r1' })).toBe(false);
    expect(isLookupChunkMessage({ type: 'lookup.chunk', requestId: 1, markdown: 'hi' })).toBe(
      false,
    );
  });

  it('rejects other shapes', () => {
    expect(isLookupChunkMessage({ type: 'lookup' })).toBe(false);
    expect(isLookupChunkMessage(null)).toBe(false);
    expect(isLookupChunkMessage(undefined)).toBe(false);
    expect(isLookupChunkMessage('lookup.chunk')).toBe(false);
  });
});
