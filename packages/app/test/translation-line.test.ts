import { describe, it, expect } from 'vitest';
import { parseTranslation } from '../src/domain/translation-line';

describe('parseTranslation', () => {
  it('extracts a TRANSLATION line and strips it (plus one following blank line)', () => {
    const md = 'TRANSLATION: "ngân hàng"\n\n## bank\nA financial institution.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('ngân hàng');
    expect(out.body).toBe('## bank\nA financial institution.');
  });

  it('returns the ENTIRE original text unchanged when no TRANSLATION line is present (graceful degradation)', () => {
    const md = '## bank\nA financial institution.';
    const out = parseTranslation(md);
    expect(out.translation).toBeUndefined();
    expect(out.body).toBe(md);
  });

  it('tolerates the line appearing after leading whitespace/blank lines', () => {
    const md = '\n\nTRANSLATION: "bỏ cuộc"\n## give up\nTo stop trying.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('bỏ cuộc');
    expect(out.body).toBe('## give up\nTo stop trying.');
  });

  it('does not strip anything beyond the matched line and its one following blank line', () => {
    const md = 'TRANSLATION: "x"\n\n\n## x\nmeaning';
    const out = parseTranslation(md);
    expect(out.body).toBe('\n## x\nmeaning');
  });

  it('finds the TRANSLATION line even when it is not the first line (real pipeline order: DEFINED_AS is stripped first)', () => {
    const md = '## kick the bucket\nTRANSLATION: "chết"\n\nTo die.';
    const out = parseTranslation(md);
    expect(out.translation).toBe('chết');
    expect(out.body).toBe('## kick the bucket\nTo die.');
  });
});
