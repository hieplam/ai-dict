#!/usr/bin/env bun
// Hard gate for the Paperlight token law (documented in CLAUDE.md / design-system/README.md —
// this scanner mechanizes an existing rule, it does not define a new one): components must
// read only --ad-*/--adp-* CSS custom properties — never a hard-coded hex color literal,
// never `oklch(`, never branch on `prefers-color-scheme` per component. The ONE place allowed
// to define these literals is packages/app/src/ui/styles/tokens.ts (the token source of truth).
//
// Runs repo-wide (whole repo including docs/index.html — NOT scoped to packages/*/src like
// check-dep-direction.mjs) over .ts/.tsx/.mts/.mjs/.js/.html/.css files, after stripping
// comments (see strip-comments.mjs) so prose/JSDoc examples never produce a false positive.
//
// Usage: bun scripts/hard-rule/check-token-law.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripComments } from './strip-comments.mjs';
import { loadExclusions } from './exclusions.mjs';

export const RULE_ID = 'rule-token-law';

// The token source of truth: this is where hex/oklch/prefers-color-scheme literals are
// DEFINED, not consumed. Exempted here (hardcoded, structural to the rule's own definition)
// rather than via exclusions.json, mirroring how check-dep-direction.mjs hardcodes each
// rule's own `appliesTo` scope directly in the scanner instead of an external config —
// this exemption is part of what the rule MEANS, not a case-by-case carve-out.
export const TOKEN_SOURCE_OF_TRUTH = 'packages/app/src/ui/styles/tokens.ts';

const PATTERNS = [
  {
    id: 'hex-color-literal',
    // #rgb / #rgba / #rrggbb / #rrggbbaa, word-bounded so a longer run (e.g. a 7+ char
    // hash-like identifier) is never partially matched as a shorter hex color.
    regex: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g,
    explain:
      'hard-coded hex color literal — read a --ad-*/--adp-* CSS custom property instead (token law).',
  },
  {
    id: 'oklch-literal',
    regex: /oklch\(/g,
    explain:
      'raw oklch(...) color literal — colors are defined once in tokens.ts and consumed via --ad-*/--adp-* (token law).',
  },
  {
    id: 'prefers-color-scheme-branch',
    regex: /prefers-color-scheme/g,
    explain:
      'branching on prefers-color-scheme per component — theme switching is centralized via the data-ad-theme attribute (token law).',
  },
];

/** Check one already-read file's source against the token-law patterns. */
export function checkFile(file, source) {
  if (file === TOKEN_SOURCE_OF_TRUTH) return [];
  if (loadExclusions(RULE_ID).includes(file)) return [];

  const stripped = stripComments(source);
  const violations = [];
  for (const pattern of PATTERNS) {
    for (const match of stripped.matchAll(pattern.regex)) {
      violations.push({
        file,
        line: stripped.slice(0, match.index).split('\n').length,
        match: match[0],
        rule: pattern.id,
        explain: pattern.explain,
      });
    }
  }
  return violations;
}

const SCANNED_EXTENSIONS = /\.(ts|tsx|mts|mjs|js|html|css)$/;
const IS_TEST_FILE = /\.test\.ts$/;

// Structural walk exclusions — walker plumbing, not a reason-carrying exclusions.json entry
// (same spirit as eslint.config.mjs's own `ignores` block).
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.claude',
  '.c3',
  'e2e',
]);

function* walk(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      yield* walk(join(absDir, entry.name));
    } else if (SCANNED_EXTENSIONS.test(entry.name) && !IS_TEST_FILE.test(entry.name)) {
      yield join(absDir, entry.name);
    }
  }
}

/** Scan the whole repo (repoRoot) and return every token-law violation. */
export function checkRepo(repoRoot) {
  const violations = [];
  for (const absPath of walk(repoRoot)) {
    const file = posix.relative(repoRoot, absPath);
    violations.push(...checkFile(file, readFileSync(absPath, 'utf8')));
  }
  return violations;
}

function main() {
  const repoRoot = new URL('../..', import.meta.url).pathname;
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log(
      '✓ token law OK — no hard-coded hex/oklch literals or prefers-color-scheme branches',
    );
    return;
  }
  console.error(`✖ token-law check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  found '${v.match}'`);
    console.error(`    broken rule: ${v.rule} — ${v.explain}\n`);
  }
  console.error(
    'Build blocked. Read a --ad-*/--adp-* custom property instead, or add a reasoned ' +
      'exclusions.json entry under "rule-token-law" if this is a genuine definition file.',
  );
  process.exit(1);
}

if (import.meta.main) main();
