#!/usr/bin/env bun
// Hard gate for the platform-agnostic-core principle (rule-domain-purity, mirrored by
// .claude/rules/domain-purity.md's pure-core/impure-edges angle): the portable core
// (packages/app/src/**, @ai-dict/app) must never reference `chrome.` directly. Platform
// capabilities reach the core only through ports (packages/app/src/ports.ts) that the shells'
// composition roots (sw.ts / content.ts) inject concrete adapters into.
//
// DIFFERENT from check-key-isolation.mjs (which governs *.storage.local inside the extension
// shells packages/extension-*/src) — this scanner governs a different package
// (packages/app/src) and a different pattern (chrome. in general, not just storage).
//
// Runs a line-scan for the word-bounded `\bchrome\.` pattern (so it never misfires on an
// identifier merely containing "chrome" as a substring, e.g. a hypothetical `chromePicker`
// variable) after stripping comments (strip-comments.mjs) so prose/JSDoc mentioning `chrome.`
// as documentation never false-positives. This also catches type-only references like
// `typeof chrome` — `typeof chrome.` still contains the literal substring `chrome.` — because
// any chrome typing in the core is a leak of platform-specific typing into portable code
// (packages/app/package.json does not even depend on @types/chrome).
//
// Usage: bun scripts/hard-rule/check-core-agnostic.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripComments } from './strip-comments.mjs';

export const RULE_ID = 'rule-core-agnostic';

// The one directory this rule governs — the portable core. Matches check-dep-direction.mjs's
// SCAN_DIRS idiom, but scoped to just this one directory.
const SCAN_DIR = 'packages/app/src';

const CHROME_PATTERN = /\bchrome\./g;
const IS_TEST_FILE = /\.test\.ts$/;

/** Check one already-read file's source for a `chrome.` reference. */
export function checkFile(file, source) {
  if (!(file === SCAN_DIR || file.startsWith(`${SCAN_DIR}/`))) return [];
  if (IS_TEST_FILE.test(file)) return [];

  const stripped = stripComments(source);
  const violations = [];
  for (const match of stripped.matchAll(CHROME_PATTERN)) {
    violations.push({
      file,
      line: stripped.slice(0, match.index).split('\n').length,
      match: match[0],
    });
  }
  return violations;
}

function* walk(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const path = join(absDir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) yield path;
  }
}

/** Scan packages/app/src under repoRoot and return every core-agnostic violation. */
export function checkRepo(repoRoot) {
  const violations = [];
  for (const absPath of walk(join(repoRoot, SCAN_DIR))) {
    const file = posix.join(SCAN_DIR, posix.relative(join(repoRoot, SCAN_DIR), absPath));
    violations.push(...checkFile(file, readFileSync(absPath, 'utf8')));
  }
  return violations;
}

function main() {
  const repoRoot = new URL('../..', import.meta.url).pathname;
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log(
      '✓ core-agnostic OK — packages/app/src never references chrome. directly (rule-domain-purity)',
    );
    return;
  }
  console.error(`✖ core-agnostic check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  found '${v.match}'`);
  }
  console.error(
    'Build blocked. The portable core (packages/app/src) must never reference chrome. directly ' +
      '— declare a port in packages/app/src/ports.ts and inject a concrete adapter from the ' +
      'composition root (sw.ts / content.ts) instead.',
  );
  process.exit(1);
}

if (import.meta.main) main();
