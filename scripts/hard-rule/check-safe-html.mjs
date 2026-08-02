#!/usr/bin/env bun
// Hard gate for S4 (rule-sanitize-model-output, ref-core-dependency-rule): every raw-HTML sink
// line (`.innerHTML =`, `.outerHTML =`, `insertAdjacentHTML(`) must either (a) carry an
// `// s4: static-template — <reason>` annotation (added by the one-time audit, verification-loop
// campaign card V3 Task 3), or (b) reference the sanctioned sanitize path (`safeHtml`/`SafeHtml`/
// `sanitizeMarkdown`) — otherwise it is flagged as an unreviewed raw-HTML sink.
//
// Ratified (spec 2026-08-03-v3-code-touching-gates, S4): "Accepted limit: a false annotation is
// a deliberate diff-visible act — the scanner defends against accidents, not lies." This is a
// literal substring/window existence check, same design as check-msg-gate.mjs's S3 scanner.
//
// Usage: bun scripts/hard-rule/check-safe-html.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const SINK_PATTERNS = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\(/];

// Case-insensitive: the real compliant site (packages/app/src/ui/lookup-card.ts:286,
// `body.innerHTML = state.safeHtml;`) carries the lowercase-first `safeHtml` CardState property
// name, not the capitalized `SafeHtml` branded type name — matching case-insensitively accepts
// both spellings plus a direct `sanitizeMarkdown(...)` call on the sink line itself.
const SANCTIONED_RE = /safehtml|sanitizemarkdown/i;

// The `// s4: static-template` annotation prefix — the `— <reason>` suffix isn't required by
// this scanner (only the marker itself), matching every real annotation Task 3 added.
const ANNOTATION_RE = /\/\/\s*s4:\s*static-template/;

// How many lines ABOVE a sink line this scanner will also inspect for a compliant marker
// (annotation or sanctioned-path reference), in addition to the sink line itself. Ratified
// choice: backward-only, never forward. Real site: packages/app/src/ui/side-panel-view.ts —
// the annotation sits on line 99, one line above the multi-line `wrap.innerHTML =` assignment
// that starts on line 100. 1 line is the smallest window that covers every real annotated site
// in the repo (verified: every other one of the 14 annotated sites is a same-line trailing
// comment, i.e. window 0). A forward-looking window is deliberately NOT supported: a later,
// unrelated annotation must never appear to justify an earlier, unannotated sink.
export const ANNOTATION_WINDOW_ABOVE = 1;

/**
 * Pure: find every raw-HTML sink line in `source` and check whether a compliant marker
 * (the `// s4: static-template` annotation, or a sanctioned-sanitize-path reference) appears on
 * the sink line itself or up to `ANNOTATION_WINDOW_ABOVE` lines above it.
 * @param {string} file repo-relative posix path, e.g. 'packages/app/src/ui/lookup-card.ts'
 * @param {string} source file content
 */
export function checkFile(file, source) {
  const lines = source.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SINK_PATTERNS.some((re) => re.test(lines[i]))) continue;
    const windowStart = Math.max(0, i - ANNOTATION_WINDOW_ABOVE);
    const window = lines.slice(windowStart, i + 1);
    const compliant = window.some((l) => ANNOTATION_RE.test(l) || SANCTIONED_RE.test(l));
    if (!compliant) {
      violations.push({ file, line: i + 1 });
    }
  }
  return violations;
}

// Scoped to production UI/source code only. dist/, node_modules/, .claude/worktrees/, test/,
// docs/, design-system/, coverage dirs, and e2e specs are excluded because a raw-HTML sink
// string could appear there as a mock/fixture literal (e.g. in a colocated `*.test.ts`) rather
// than real production sink code — mirrors check-msg-gate.mjs's scoping rationale.
const SCAN_DIRS = [
  'packages/app/src',
  'packages/extension-chrome/src',
  'packages/extension-safari/src',
];
const EXCLUDED_DIR_NAMES = new Set([
  'dist',
  'node_modules',
  'worktrees',
  'test',
  'docs',
  'design-system',
  'coverage',
  'e2e',
]);
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

function* walk(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      yield* walk(join(absDir, entry.name));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
      yield join(absDir, entry.name);
    }
  }
}

/** Scan every source dir under repoRoot and return all violations. */
export function checkRepo(repoRoot) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
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
      '✓ safe-HTML sink check OK — every raw-HTML sink is annotated or references the ' +
        'sanctioned sanitize path (rule-sanitize-model-output)',
    );
    return;
  }
  console.error(`✖ safe-HTML sink check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  unreviewed raw-HTML sink`);
    console.error(
      '    fix: either route this through sanitizeMarkdown()/SafeHtml, or, if the content is ' +
        'demonstrably static/own-template, annotate the line ' +
        '`// s4: static-template — <reason>` (rule-sanitize-model-output).\n',
    );
  }
  console.error('Build blocked. Fix the sinks above — do not bypass this gate.');
  process.exit(1);
}

if (import.meta.main) main();
