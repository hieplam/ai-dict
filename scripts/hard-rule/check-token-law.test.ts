import { describe, expect, it } from 'vitest';

import { checkFile, checkRepo, RULE_ID, TOKEN_SOURCE_OF_TRUTH } from './check-token-law.mjs';

const COMPONENT_FILE = 'packages/app/src/ui/lookup-card.ts';

describe('checkFile — a hard-coded hex color literal in a component is banned', () => {
  it('reports a violation for a 3-digit hex literal', () => {
    const violations = checkFile(COMPONENT_FILE, 'el.style.color = "#fff";\n');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: COMPONENT_FILE, rule: 'hex-color-literal' });
  });

  it('reports a violation for a 6-digit hex literal', () => {
    const violations = checkFile(COMPONENT_FILE, 'el.style.color = "#b33830";\n');
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('hex-color-literal');
  });

  it('reports a violation for an 8-digit (alpha) hex literal', () => {
    const violations = checkFile(COMPONENT_FILE, 'el.style.color = "#b3383080";\n');
    expect(violations).toHaveLength(1);
  });

  it('reports a violation for a 4-digit (rgba shorthand) hex literal', () => {
    const violations = checkFile(COMPONENT_FILE, 'el.style.color = "#fff8";\n');
    expect(violations).toHaveLength(1);
  });

  it('does not falsely flag a 7-digit run (not a valid hex color length)', () => {
    expect(checkFile(COMPONENT_FILE, 'const sha = "#1234567";\n')).toEqual([]);
  });

  it('reports the 1-based line number of the violation', () => {
    const src = 'const a = 1;\nconst b = 2;\nel.style.color = "#fff";\n';
    const violations = checkFile(COMPONENT_FILE, src);
    expect(violations[0].line).toBe(3);
  });
});

describe('checkFile — oklch( literal is banned', () => {
  it('reports a violation', () => {
    const violations = checkFile(COMPONENT_FILE, 'el.style.color = "oklch(0.5 0.1 30)";\n');
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('oklch-literal');
  });
});

describe('checkFile — prefers-color-scheme branch is banned', () => {
  it('reports a violation', () => {
    const src = 'if (matchMedia("(prefers-color-scheme: dark)").matches) {}\n';
    const violations = checkFile(COMPONENT_FILE, src);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('prefers-color-scheme-branch');
  });
});

describe('checkFile — comments are stripped before matching (no false positives from prose)', () => {
  it('does not flag a hex literal mentioned only inside a JSDoc comment', () => {
    const src = ['/**', ' * legacy fallback used #fff', ' */', 'const a = 1;'].join('\n');
    expect(checkFile(COMPONENT_FILE, src)).toEqual([]);
  });
});

describe('checkFile — the token source of truth is exempt', () => {
  it('is clean even with hex/oklch/prefers-color-scheme literals, because it is where they are DEFINED', () => {
    const src = 'const c = "#fff"; // oklch(0.5 0.1 30) prefers-color-scheme\n';
    expect(checkFile(TOKEN_SOURCE_OF_TRUTH, src)).toEqual([]);
  });
});

describe('checkFile — an exclusions.json-listed path is exempt', () => {
  it('is clean for the seeded sw.ts badge-color exclusion', () => {
    const src = "const BADGE_SETUP_COLOR = '#b33830';\n";
    expect(checkFile('packages/extension-chrome/src/sw.ts', src)).toEqual([]);
  });
});

describe('checkFile — RULE_ID matches the exclusions.json rule id this scanner reads', () => {
  it('is "rule-token-law"', () => {
    expect(RULE_ID).toBe('rule-token-law');
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current tree, given the seeded exclusions', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });
});
