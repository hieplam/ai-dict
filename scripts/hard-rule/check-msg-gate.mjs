#!/usr/bin/env bun
// Hard gate for S3 (rule-gate-runtime-messages, ref-core-dependency-rule): every
// `onMessage.addListener` registration (call form or TypeScript-cast form) must call
// `classifyInbound(` within a small fixed window of lines forward from the addListener line
// (verification-loop campaign, card V3).
//
// Ratified (spec 2026-08-03-v3-code-touching-gates, S3): this is a literal substring/window
// existence check, not semantic analysis of the guard idiom used — a hand-rolled
// `if (sender.id !== ...) return;` with no `classifyInbound(` call is still a violation.
// No alternate idiom is accepted.
//
// Usage: bun scripts/hard-rule/check-msg-gate.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

// No trailing `(` on purpose: packages/extension-safari/src/sw.ts registers its listener via a
// TypeScript cast — `(browser.runtime.onMessage.addListener as (fn: OnMsgListener) => void)(` —
// so there is no `(` immediately after `addListener`. Requiring the trailing paren made that
// real production site invisible to this scanner (it silently saw zero listener sites there
// instead of being checked). Bare `onMessage.addListener` (no paren) still only ever matches
// `chrome.runtime.onMessage.addListener` / `browser.runtime.onMessage.addListener` — confirmed
// via `grep -rn "onMessage\.addListener" packages/*/src/`: exactly 4 sites repo-wide, no stray
// comment/prose hits. Do NOT broaden further to bare `.addListener(` — that also matches
// `chrome.commands.onCommand`, `chrome.runtime.onInstalled`, and `chrome.storage.onChanged`,
// none of which are runtime-message listeners this rule governs.
const ADD_LISTENER = 'onMessage.addListener';
const GATE_CALL = 'classifyInbound(';

// The gate call must appear within this many lines AFTER the addListener line. The plan
// (docs/superpowers/plans/V3.md, Task 2) suggested 10, but the real, reviewed
// packages/extension-chrome/src/sw.ts gates its generic (non-side-panel) branch at line 151 —
// 29 lines after its `onMessage.addListener(` at line 122, because Chrome-only side-panel
// control messages are handled first and only fall through to `classifyInbound(` afterward.
// 30 is the smallest round number that still passes that real, correct file.
export const WINDOW_LINES = 30;

/**
 * Pure: find every `onMessage.addListener` registration line in `source` and check whether
 * `classifyInbound(` appears within `WINDOW_LINES` lines forward (never backward).
 * @param {string} file repo-relative posix path, e.g. 'packages/extension-chrome/src/sw.ts'
 * @param {string} source file content
 */
export function checkFile(file, source) {
  const lines = source.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(ADD_LISTENER)) continue;
    const windowEnd = Math.min(lines.length, i + 1 + WINDOW_LINES);
    const gated = lines.slice(i, windowEnd).some((l) => l.includes(GATE_CALL));
    if (!gated) {
      violations.push({ file, line: i + 1 });
    }
  }
  return violations;
}

// Scoped to production source only — dist/, node_modules/, worktrees, and test/e2e fixtures
// are excluded because the literal string `onMessage.addListener` could appear there as a
// mock/fixture string rather than real production gating code (see exclusions note below).
const SCAN_DIRS = [
  'packages/app/src',
  'packages/extension-chrome/src',
  'packages/extension-safari/src',
];

function* walk(absDir) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const path = join(absDir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) yield path;
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
      '✓ message gate OK — every onMessage.addListener site calls classifyInbound( ' +
        `within ${WINDOW_LINES} lines (rule-gate-runtime-messages)`,
    );
    return;
  }
  console.error(`✖ message-gate check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  onMessage.addListener not gated`);
    console.error(
      `    fix: call classifyInbound(msg, sender.id, runtimeId) within ${WINDOW_LINES} lines ` +
        'after this listener registration — no alternate guard idiom satisfies S3 ' +
        '(rule-gate-runtime-messages).\n',
    );
  }
  console.error('Build blocked. Fix the listeners above — do not bypass this gate.');
  process.exit(1);
}

if (import.meta.main) main();
