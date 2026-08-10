import { describe, it, expect } from 'vitest';
import { classifyCardText } from '../../src/domain/live-outcome';

describe('classifyCardText', () => {
  it('classifies a rendered definition as ok', () => {
    // 32 chars ('bank\nThe land alongside a river.') sits under MIN_DEFINITION_CHARS (60, per
    // the spec's rung 5) and would misclassify as 'contract' — this fixture is long enough to
    // clear that threshold so the test exercises the 'ok' branch, not the length-guard branch.
    expect(
      classifyCardText('bank\nThe sloping land alongside a river, lake, or other body of water.'),
    ).toEqual({ kind: 'ok' });
  });

  it.each([
    ['Network failed. Check connection and retry.'],
    ['Gemini server error. Retry.'],
    ['Hit Gemini rate limit.'],
  ])('classifies %s as transport', (msg) => {
    expect(classifyCardText(`Lookup failed\n${msg}`).kind).toBe('transport');
  });

  it.each([['Google rejected the API key.'], ['Add your Gemini API key in Settings.']])(
    'classifies %s as setup',
    (msg) => {
      expect(classifyCardText(`Lookup failed\n${msg}`).kind).toBe('setup');
    },
  );

  it('classifies the PARSE message as contract drift', () => {
    const out = classifyCardText('Lookup failed\nGemini returned unexpected output.');
    expect(out.kind).toBe('contract');
    expect((out as { detail: string }).detail).toContain('unexpected output');
  });

  it('classifies an empty card as contract drift, not ok', () => {
    // A 200 that parses to nothing is drift, not a network problem.
    expect(classifyCardText('   ').kind).toBe('contract');
  });

  it('prefers the transport verdict when a card somehow shows two messages', () => {
    // Ordering guard: a transport failure must never be reported as drift.
    const out = classifyCardText(
      'Network failed. Check connection and retry.\nGemini returned unexpected output.',
    );
    expect(out.kind).toBe('transport');
  });
});
