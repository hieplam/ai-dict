import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAll, summarize } from './run-all.mjs';

describe('summarize — pure pass/fail decision over already-collected results', () => {
  it('passes when every result exited 0 and at least one ran', () => {
    expect(summarize([{ exitCode: 0 }, { exitCode: 0 }])).toBe(true);
  });

  it('fails when any result exited non-zero', () => {
    expect(summarize([{ exitCode: 0 }, { exitCode: 1 }])).toBe(false);
  });

  it('fails on zero results — an empty scanner folder is a runner bug, never a valid green state', () => {
    expect(summarize([])).toBe(false);
  });
});

describe('runAll — discovers and executes every check-*.mjs scanner in a folder', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('discovers and runs a single check-*.mjs scanner and reports it', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));
    writeFileSync(join(dir, 'check-fixture-pass.mjs'), 'process.exit(0);\n');

    const { passed, results } = runAll(dir);

    expect(passed).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].path).toContain('check-fixture-pass.mjs');
    expect(results[0].exitCode).toBe(0);
  });

  it('ignores files in the folder that do not match the check-*.mjs pattern', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));
    writeFileSync(join(dir, 'check-fixture-pass.mjs'), 'process.exit(0);\n');
    writeFileSync(join(dir, 'helper.mjs'), 'process.exit(1);\n');
    writeFileSync(join(dir, 'README.md'), 'not a scanner\n');

    const { passed, results } = runAll(dir);

    expect(passed).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('a scanner that exits 1 makes the overall run fail', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));
    writeFileSync(join(dir, 'check-fixture-fail.mjs'), 'process.exit(1);\n');

    const { passed, results } = runAll(dir);

    expect(passed).toBe(false);
    expect(results[0].exitCode).toBe(1);
  });

  it('one failing scanner among passing ones still fails the whole run', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));
    writeFileSync(join(dir, 'check-fixture-pass.mjs'), 'process.exit(0);\n');
    writeFileSync(join(dir, 'check-fixture-fail.mjs'), 'process.exit(1);\n');

    const { passed, results } = runAll(dir);

    expect(passed).toBe(false);
    expect(results.map((r) => r.exitCode).sort()).toEqual([0, 1]);
  });

  it('keeps the run green when every discovered scanner exits 0', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));
    writeFileSync(join(dir, 'check-fixture-a.mjs'), 'process.exit(0);\n');
    writeFileSync(join(dir, 'check-fixture-b.mjs'), 'process.exit(0);\n');

    const { passed } = runAll(dir);

    expect(passed).toBe(true);
  });

  it('fails loudly on a folder with zero check-*.mjs scanners (bug in the runner/folder, not a no-op green)', () => {
    dir = mkdtempSync(join(tmpdir(), 'hard-rule-test-'));

    const { passed, results } = runAll(dir);

    expect(passed).toBe(false);
    expect(results).toHaveLength(0);
  });
});
