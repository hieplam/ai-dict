#!/usr/bin/env bun
// The hard-rule scanner runner (verification-loop campaign, card V2).
//
// Discovers every scripts/hard-rule/check-*.mjs scanner (no hardcoded scanner
// list, so newly-added scanners are picked up automatically), runs each with
// `bun`, and aggregates pass/fail. A folder with zero scanners is treated as
// a bug in the runner/folder — never a silent green no-op — so a future
// refactor that empties this folder can't accidentally disable the gate.
//
// Wiring into `bun run lint`, both extension builds, and the pre-commit hook
// happens in later cards of this campaign (see docs/superpowers/plans/V2.md).
//
// Usage: bun scripts/hard-rule/run-all.mjs

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCANNER_PATTERN = /^check-.*\.mjs$/;

/** List every check-*.mjs scanner file in `dir`, sorted for a deterministic run order. */
export function discoverScanners(dir) {
  return readdirSync(dir)
    .filter((name) => SCANNER_PATTERN.test(name))
    .sort()
    .map((name) => join(dir, name));
}

/** Run one scanner with `bun`, capturing its stdout/stderr/exit code. */
export function runScanner(scannerPath) {
  const result = spawnSync('bun', [scannerPath], { encoding: 'utf8' });
  return {
    path: scannerPath,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Pure: decide overall pass/fail from already-collected scanner results.
 * Passes only if at least one scanner ran AND every one of them exited 0 —
 * zero results is never a pass, it means the folder/runner is broken.
 */
export function summarize(results) {
  return results.length > 0 && results.every((r) => r.exitCode === 0);
}

/** Discover and run every scanner in `dir`, returning the aggregated outcome. */
export function runAll(dir) {
  const results = discoverScanners(dir).map(runScanner);
  return { passed: summarize(results), results };
}

function printVerdicts(results) {
  for (const r of results) {
    const verdict = r.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`[${verdict}] ${r.path}`);
    if (r.exitCode !== 0) {
      if (r.stdout) console.log(r.stdout.trimEnd());
      if (r.stderr) console.error(r.stderr.trimEnd());
    }
  }
}

function main() {
  const dir = new URL('.', import.meta.url).pathname;
  const { passed, results } = runAll(dir);
  printVerdicts(results);

  if (results.length === 0) {
    console.error(
      '✖ hard-rule runner found zero check-*.mjs scanners in scripts/hard-rule/ — an empty ' +
        'folder is a bug in the runner/folder itself, not a valid green state.',
    );
    process.exit(1);
  }

  const failed = results.filter((r) => r.exitCode !== 0).length;
  console.log(
    passed
      ? `✓ all ${results.length} hard-rule scanner(s) passed`
      : `✖ ${failed} of ${results.length} hard-rule scanner(s) failed`,
  );
  process.exit(passed ? 0 : 1);
}

if (import.meta.main) main();
