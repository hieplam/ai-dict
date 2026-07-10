import { describe, it, expect } from 'vitest';
import { parseDefinedAs } from '../src/domain/defined-as';

describe('parseDefinedAs', () => {
  it('extracts an idiom DEFINED_AS line and strips it (plus one following blank line)', () => {
    const md = 'DEFINED_AS: "kick the bucket" | idiom\n\n## kick the bucket\nTo die.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'kick the bucket', isIdiom: true });
    expect(out.body).toBe('## kick the bucket\nTo die.');
  });

  it('extracts a literal DEFINED_AS line', () => {
    const md = 'DEFINED_AS: "bucket" | literal\n\n## bucket\nA pail.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'bucket', isIdiom: false });
    expect(out.body).toBe('## bucket\nA pail.');
  });

  it('returns the ENTIRE original text unchanged when no DEFINED_AS line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nDEFINED_AS: "give up" | idiom\n## give up\nTo stop trying.';
    const out = parseDefinedAs(md);
    expect(out.definedAs).toEqual({ term: 'give up', isIdiom: true });
    expect(out.body).toBe('## give up\nTo stop trying.');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'DEFINED_AS: "x" | literal\n\n\n## x\nmeaning';
    const out = parseDefinedAs(md);
    // Only ONE following blank line is consumed; the second blank line survives in body.
    expect(out.body).toBe('\n## x\nmeaning');
  });
});
