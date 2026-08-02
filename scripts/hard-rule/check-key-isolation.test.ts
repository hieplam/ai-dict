import { describe, expect, it } from 'vitest';

import { checkFile, checkRepo, RULE_ID, ALLOWLISTED_FILES } from './check-key-isolation.mjs';

const NON_ALLOWLISTED_CHROME_FILE = 'packages/extension-chrome/src/adapters/some-adapter.ts';
const CHROME_STORAGE_SRC = 'const settings = await chrome.storage.local.get("settings");\n';

describe('checkFile — a .storage.local access outside the trusted set is banned', () => {
  it('reports a violation for chrome.storage.local in a non-allowlisted chrome file', () => {
    const violations = checkFile(NON_ALLOWLISTED_CHROME_FILE, CHROME_STORAGE_SRC);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: NON_ALLOWLISTED_CHROME_FILE });
  });

  it('reports a violation for browser.storage.local in a non-allowlisted safari file', () => {
    const file = 'packages/extension-safari/src/adapters/some-adapter.ts';
    const violations = checkFile(file, 'const s = await browser.storage.local.get("settings");\n');
    expect(violations).toHaveLength(1);
  });

  it('reports the 1-based line number of the violation', () => {
    const src = 'const a = 1;\nconst b = 2;\nchrome.storage.local.get("x");\n';
    const violations = checkFile(NON_ALLOWLISTED_CHROME_FILE, src);
    expect(violations[0].line).toBe(3);
  });
});

describe('checkFile — the four trusted entry files are exempt (mirrors the eslint no-restricted-syntax ignores)', () => {
  it('lists exactly the four files the eslint.config.mjs selector allowlists', () => {
    expect([...ALLOWLISTED_FILES].sort()).toEqual(
      [
        'packages/extension-chrome/src/options.ts',
        'packages/extension-chrome/src/sw.ts',
        'packages/extension-safari/src/options.ts',
        'packages/extension-safari/src/sw.ts',
      ].sort(),
    );
  });

  for (const file of [
    'packages/extension-chrome/src/sw.ts',
    'packages/extension-chrome/src/options.ts',
    'packages/extension-safari/src/sw.ts',
    'packages/extension-safari/src/options.ts',
  ]) {
    it(`is clean for ${file}`, () => {
      expect(checkFile(file, CHROME_STORAGE_SRC)).toEqual([]);
    });
  }
});

describe('checkFile — a *.test.ts file is exempt', () => {
  it('is clean for a non-allowlisted adapter test file', () => {
    const file = 'packages/extension-chrome/src/adapters/some-adapter.test.ts';
    expect(checkFile(file, CHROME_STORAGE_SRC)).toEqual([]);
  });
});

describe('checkFile — comments are stripped before matching (no false positives from prose)', () => {
  it('does not flag .storage.local mentioned only inside a whole-line // comment', () => {
    const src = [
      '// (rule-api-key-isolation) forbids this file from writing chrome.storage.local, so',
      '// relay through settings.get() instead.',
      'const a = 1;',
    ].join('\n');
    expect(checkFile(NON_ALLOWLISTED_CHROME_FILE, src)).toEqual([]);
  });
});

describe('checkFile — out of this rule scope entirely outside the two extension src roots', () => {
  it('does not flag .storage.local in a packages/app/src file (S1 only governs the extension shells)', () => {
    const file = 'packages/app/src/domain/settings.ts';
    expect(checkFile(file, CHROME_STORAGE_SRC)).toEqual([]);
  });
});

describe('checkFile — RULE_ID matches the exclusions.json rule id this scanner would read', () => {
  it('is "rule-key-isolation"', () => {
    expect(RULE_ID).toBe('rule-key-isolation');
  });
});

describe('checkRepo — integration on this repository', () => {
  it('finds zero violations on the current tree', () => {
    const violations = checkRepo(new URL('../..', import.meta.url).pathname);
    expect(violations).toEqual([]);
  });
});
