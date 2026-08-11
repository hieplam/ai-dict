import { describe, it, expect } from 'vitest';
import { classifyCardText, classifyPoll, classifyTimeout } from '../../src/domain/live-outcome';

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

describe('classifyPoll', () => {
  it('keeps polling on a short, message-free card (still loading)', () => {
    expect(classifyPoll('bank', false)).toBe('poll');
  });

  it('settles immediately on a matched error message, regardless of the streaming flag', () => {
    expect(classifyPoll('Lookup failed\nHit Gemini rate limit.', true)).toBe('settled');
  });

  it('settles immediately on the contract (PARSE) message, regardless of the streaming flag', () => {
    expect(classifyPoll('Lookup failed\nGemini returned unexpected output.', true)).toBe('settled');
  });

  it('keeps polling on an ok-length card while data-streaming is still true (mid-stream repaint)', () => {
    expect(
      classifyPoll('bank\nThe sloping land alongside a river, lake, or other body of water.', true),
    ).toBe('poll');
  });

  it('settles on an ok-length card once data-streaming is false', () => {
    expect(
      classifyPoll(
        'bank\nThe sloping land alongside a river, lake, or other body of water.',
        false,
      ),
    ).toBe('settled');
  });
});

describe('classifyTimeout', () => {
  it('reports contract drift when streaming was observed but never reached a terminal state', () => {
    const out = classifyTimeout(true, 60_000);
    expect(out.kind).toBe('contract');
    expect((out as { detail: string }).detail).toContain('60000ms');
  });

  it('reports transport when streaming was never observed at all', () => {
    const out = classifyTimeout(false, 60_000);
    expect(out.kind).toBe('transport');
    expect((out as { detail: string }).detail).toContain('60000ms');
  });
});
