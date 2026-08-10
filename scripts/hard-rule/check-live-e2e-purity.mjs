#!/usr/bin/env bun
// Hard gate against a FAKE LIVE TEST: a file named *.live.spec.ts that still talks to a mock.
//
// This is the same defect class as the 2026-08-09 outage. There, every mock hand-rolled '\n\n'
// SSE framing copied from the parser instead of the wire, so the suite could only ever confirm
// the parser agreed with itself. A live spec that quietly kept its mock recreates exactly that
// tautology while LOOKING like real coverage — greener and more misleading than no test at all.
//
// DIFFERENT from the other scanners: they govern packages/**, this one governs e2e specs by
// FILENAME suffix. Comments are stripped first (strip-comments.mjs) so prose naming a mock
// helper as documentation never false-positives.
//
// Usage: bun scripts/hard-rule/check-live-e2e-purity.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripComments } from './strip-comments.mjs';

export const RULE_ID = 'rule-live-e2e-purity';

const SCAN_DIR = 'packages/extension-chrome/e2e';
const IS_LIVE_SPEC = /\.live\.spec\.ts$/;

// Every mock entry point in helpers.ts, plus the raw interception primitives. Both
// `context.route(` and `page.route(` can fulfill a fake response for the real Gemini/OpenAI/
// Anthropic URL from inside a *.live.spec.ts file, recreating the exact tautology this scanner
// exists to block — so both receivers are banned, not just the one the mock helpers happen to use.
const FORBIDDEN = [
  'mockGemini',
  'mockGeminiStream',
  'mockOpenAI',
  'mockAnthropic',
  'sseFrame',
  'context.route(',
  'page.route(',
];

/** Check one already-read file's source. Non-live specs are always clean by definition. */
export function checkFile(file, source) {
  if (!IS_LIVE_SPEC.test(file)) return [];

  const stripped = stripComments(source);
  const violations = [];
  for (const needle of FORBIDDEN) {
    let idx = stripped.indexOf(needle);
    while (idx !== -1) {
      violations.push({ file, line: stripped.slice(0, idx).split('\n').length, match: needle });
      idx = stripped.indexOf(needle, idx + needle.length);
    }
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

/** Scan the e2e folder under repoRoot and return every live-purity violation. */
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
    console.log('✓ live-e2e purity OK — no *.live.spec.ts file imports a mock helper');
    return;
  }
  console.error(`✖ live-e2e purity check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  found '${v.match}'`);
  }
  console.error(
    'Build blocked. A *.live.spec.ts file must reach the real provider — importing a mock ' +
      'helper (or calling context.route/page.route) makes it a fake live test that proves ' +
      'nothing. Use useLiveGemini/expectLiveLookup from e2e/helpers-live.ts, or rename the ' +
      'file to drop the .live suffix.',
  );
  process.exit(1);
}

if (import.meta.main) main();
