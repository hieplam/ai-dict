import { describe, expect, it } from 'vitest';

import { stripComments } from './strip-comments.mjs';

describe('stripComments — comment stripping shared by hard-rule scanners', () => {
  it('strips a /** JSDoc */ block that mentions "oklch(" so prose examples do not trigger a scanner', () => {
    const src = [
      '/**',
      ' * legacy tokens used oklch(0.5 0.1 30) before the rewrite',
      ' */',
      'const a = 1;',
    ].join('\n');
    const stripped = stripComments(src);
    expect(stripped).not.toContain('oklch(');
    expect(stripped).toContain('const a = 1;');
  });

  it('strips a whole-line // comment that mentions a banned hex literal', () => {
    const src = ['const x = 1;', '// uses #fff as a fallback', 'const y = 2;'].join('\n');
    const stripped = stripComments(src);
    expect(stripped).not.toContain('#fff');
    expect(stripped).toContain('const x = 1;');
    expect(stripped).toContain('const y = 2;');
  });

  it('leaves real code on a line untouched', () => {
    const src = 'export const color = readCssVar("--ad-ink");\n';
    expect(stripComments(src)).toBe(src);
  });

  it('does NOT strip an inline trailing comment after real code (deliberate limitation)', () => {
    const src = 'const border = 1; // fallback #fff for old browsers\n';
    const stripped = stripComments(src);
    expect(stripped).toContain('const border = 1;');
    // The deliberate limitation: an inline trailing "// ..." fragment survives stripping
    // (a smarter parser risks truncating a URL like https://... mid-string instead).
    expect(stripped).toContain('#fff for old browsers');
  });

  it('strips an HTML <!-- comment --> block', () => {
    const src = ['<div>', '<!-- example: color: #fff; -->', '<p>real</p>', '</div>'].join('\n');
    const stripped = stripComments(src);
    expect(stripped).not.toContain('#fff');
    expect(stripped).toContain('<p>real</p>');
  });

  it('preserves the total line count (newlines) so violation line numbers stay accurate', () => {
    const src = [
      'const a = 1;',
      '/**',
      ' * oklch( in a comment',
      ' */',
      'const b = 2;',
      '// #fff',
    ].join('\n');
    const stripped = stripComments(src);
    const preLines = src.split('\n').length;
    const postLines = stripped.split('\n').length;
    expect(postLines).toBe(preLines);
    // downstream code on the last line still lands at the same 1-based line number
    expect(stripped.split('\n')[4]).toContain('const b = 2;');
  });

  it('preserves overall source length exactly (char-for-char except comment bodies become spaces)', () => {
    const src = '/* oklch( */\nconst a = 1; // #fff\n';
    const stripped = stripComments(src);
    expect(stripped.length).toBe(src.length);
  });
});
