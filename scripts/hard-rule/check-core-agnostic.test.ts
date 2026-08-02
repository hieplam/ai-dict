import { describe, expect, it } from 'vitest';

import { checkFile, checkRepo, RULE_ID } from './check-core-agnostic.mjs';

const CORE_FILE = 'packages/app/src/adapters/some-adapter.ts';
const CHROME_SEND_MESSAGE_SRC = 'chrome.runtime.sendMessage({ type: "ping" });\n';

describe('checkFile — a chrome. reference inside the portable core is banned', () => {
  it('reports a violation for chrome.runtime.sendMessage in a core-pathed fixture', () => {
    const violations = checkFile(CORE_FILE, CHROME_SEND_MESSAGE_SRC);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: CORE_FILE });
  });

  it('reports the 1-based line number of the violation', () => {
    const src = 'const a = 1;\nconst b = 2;\nchrome.runtime.sendMessage({});\n';
    const violations = checkFile(CORE_FILE, src);
    expect(violations[0].line).toBe(3);
  });

  it('flags a type-only reference like `type X = typeof chrome` in the core', () => {
    const src = 'type CommandLike = typeof chrome.commands.Command;\n';
    const violations = checkFile(CORE_FILE, src);
    expect(violations).toHaveLength(1);
  });
});

describe('checkFile — comments are stripped before matching (no false positives from prose)', () => {
  it('does not flag chrome. mentioned only inside a whole-line // comment', () => {
    const src = [
      '// deliberately not chrome.commands.Command — the domain must stay chrome-free',
      'const a = 1;',
    ].join('\n');
    expect(checkFile(CORE_FILE, src)).toEqual([]);
  });

  it('does not flag chrome. mentioned only inside a JSDoc block comment', () => {
    const src = [
      '/**',
      ' * see chrome.runtime.sendMessage for the platform equivalent',
      ' */',
      'const a = 1;',
    ].join('\n');
    expect(checkFile(CORE_FILE, src)).toEqual([]);
  });
});

describe('checkFile — a *.test.ts file is exempt', () => {
  it('is clean for a core-pathed test file', () => {
    const file = 'packages/app/src/adapters/some-adapter.test.ts';
    expect(checkFile(file, CHROME_SEND_MESSAGE_SRC)).toEqual([]);
  });
});

describe('checkFile — out of this rule scope entirely outside packages/app/src', () => {
  it('does not flag chrome. in a packages/extension-chrome/src file (shells legitimately use chrome.*)', () => {
    const file = 'packages/extension-chrome/src/sw.ts';
    expect(checkFile(file, CHROME_SEND_MESSAGE_SRC)).toEqual([]);
  });
});

describe('checkFile — does not misfire on an identifier merely containing "chrome" as a substring', () => {
  it('is clean for a chromePicker-style identifier with no chrome. member access', () => {
    const src = 'const chromePicker = createPicker();\n';
    expect(checkFile(CORE_FILE, src)).toEqual([]);
  });
});

describe('checkFile — RULE_ID matches the exclusions.json rule id this scanner would read', () => {
  it('is "rule-core-agnostic"', () => {
    expect(RULE_ID).toBe('rule-core-agnostic');
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current tree', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });
});
