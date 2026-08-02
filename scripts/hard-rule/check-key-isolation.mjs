#!/usr/bin/env bun
// Hard gate for S1 (rule-api-key-isolation): only the service worker and options page may
// touch *.storage.local (it holds the Gemini apiKey) — every other extension-source file is
// content-side and must relay through settings.get() -> PublicSettings instead of reading
// storage directly.
//
// Mirrors the EXACT scope of the eslint.config.mjs no-restricted-syntax selector for
// MemberExpression[object.property.name='storage'][property.name='local'] (that block now
// carries a one-line comment marking this scanner as authoritative — eslint stays for
// IDE-time feedback only, the dep-direction pattern): the same two extension src roots, the
// same four allowlisted entry files, the same *.test.ts exemption. These four files ARE the
// rule's own definition of a trusted context — hardcoded here directly (same pattern as
// check-token-law.mjs's TOKEN_SOURCE_OF_TRUTH and check-dep-direction.mjs's per-rule
// `appliesTo`), not a case-by-case exclusions.json carve-out.
//
// Runs a line-scan for the literal `X.storage.local` substring (any object X — chrome or
// browser) after stripping comments (strip-comments.mjs) so prose/JSDoc mentioning
// `.storage.local` as documentation never false-positives.
//
// Usage: bun scripts/hard-rule/check-key-isolation.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripComments } from './strip-comments.mjs';

export const RULE_ID = 'rule-key-isolation';

// The two content-side roots this rule governs — matches eslint.config.mjs's S1 block
// `files: [...]` exactly. Storage access outside these roots (e.g. packages/app/src/**) is
// out of THIS rule's scope entirely (a different concern from check-core-agnostic.mjs).
const SCANNED_ROOTS = ['packages/extension-chrome/src', 'packages/extension-safari/src'];

// The rule's own definition of a trusted context — the ONLY files permitted to touch
// *.storage.local. Matches eslint.config.mjs's S1 block `ignores: [...]` exactly; keep the
// two in sync if the trusted set ever changes.
export const ALLOWLISTED_FILES = new Set([
  'packages/extension-chrome/src/sw.ts',
  'packages/extension-chrome/src/options.ts',
  'packages/extension-safari/src/sw.ts',
  'packages/extension-safari/src/options.ts',
]);

const STORAGE_LOCAL_PATTERN = /\.storage\.local\b/g;
const IS_TEST_FILE = /\.test\.ts$/;

function inScannedRoot(file) {
  return SCANNED_ROOTS.some((root) => file === root || file.startsWith(`${root}/`));
}

/** Check one already-read file's source for a *.storage.local access outside the trusted set. */
export function checkFile(file, source) {
  if (!inScannedRoot(file)) return [];
  if (ALLOWLISTED_FILES.has(file)) return [];
  if (IS_TEST_FILE.test(file)) return [];

  const stripped = stripComments(source);
  const violations = [];
  for (const match of stripped.matchAll(STORAGE_LOCAL_PATTERN)) {
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
    else if (/\.ts$/.test(entry.name)) yield path;
  }
}

/** Scan both extension src roots under repoRoot and return every key-isolation violation. */
export function checkRepo(repoRoot) {
  const violations = [];
  for (const dir of SCANNED_ROOTS) {
    for (const absPath of walk(join(repoRoot, dir))) {
      const file = posix.join(dir, posix.relative(join(repoRoot, dir), absPath));
      violations.push(...checkFile(file, readFileSync(absPath, 'utf8')));
    }
  }
  return violations;
}

function main() {
  const repoRoot = new URL('../..', import.meta.url).pathname;
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log(
      '✓ key isolation OK — only the service worker and options page touch *.storage.local',
    );
    return;
  }
  console.error(`✖ key-isolation check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  found '${v.match}'`);
  }
  console.error(
    'Build blocked. S1 (rule-api-key-isolation): only the service worker and options page may ' +
      'read *.storage.local (it holds the Gemini apiKey). Content-side code must relay through ' +
      'settings.get() -> PublicSettings.',
  );
  process.exit(1);
}

if (import.meta.main) main();
