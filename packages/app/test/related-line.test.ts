import { describe, it, expect } from 'vitest';
import { parseRelated } from '../src/domain/related-line';

describe('parseRelated', () => {
  it('extracts a RELATED line and strips it (plus one following blank line)', () => {
    const md = 'RELATED: "shore, embankment, bluff"\n\n## bank\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment', 'bluff']);
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('returns the ENTIRE original text unchanged when no RELATED line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nRELATED: "shore, embankment"\n## bank\nmeaning';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
    expect(out.body).toBe('## bank\nmeaning');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'RELATED: "x"\n\n\n## x\nmeaning';
    const out = parseRelated(md);
    expect(out.body).toBe('\n## x\nmeaning');
  });

  it('finds the RELATED line even when it is not the first line (real pipeline order: DEFINED_AS, then TRANSLATION, then RELATED)', () => {
    const md = '## bank\nRELATED: "shore, embankment"\n\nA financial institution.';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('comma-splits and trims each entry', () => {
    const md = 'RELATED: " shore ,embankment,  bluff "\n\nbody';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment', 'bluff']);
  });

  it('drops empty entries from stray double-commas', () => {
    const md = 'RELATED: "shore,,embankment"\n\nbody';
    const out = parseRelated(md);
    expect(out.related).toEqual(['shore', 'embankment']);
  });

  it('caps at 8 entries even when the model lists more', () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${i}`).join(', ');
    const md = `RELATED: "${words}"\n\nbody`;
    const out = parseRelated(md);
    expect(out.related).toHaveLength(8);
    expect(out.related).toEqual([
      'word0',
      'word1',
      'word2',
      'word3',
      'word4',
      'word5',
      'word6',
      'word7',
    ]);
  });
});
