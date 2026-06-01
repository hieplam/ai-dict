#!/usr/bin/env node
// wire:check — drift gate for packages/core/wire-schema.snapshot.json (spec §8.5).
//
// Core ships TS source with no build step (Bundle 02: exports "./src/index.ts"),
// Node 20 cannot import .ts, and this repo forbids root package.json edits — so we
// cannot import core's compiled wireJsonSchema() from plain node. Instead we re-run
// core's own snapshot test, which regenerates wireJsonSchema() and diffs it against
// the committed snapshot (failing on drift). Zero new deps, no build required.
import { spawnSync } from 'node:child_process';

const res = spawnSync(
  'pnpm',
  ['--filter', '@ai-dict/core', 'test', 'wire-schema'],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } }, // CI=true => vitest never writes snapshots
);

if (res.status !== 0) {
  console.error('\nwire:check FAILED — wire-schema.snapshot.json is out of date or invalid.');
  console.error('If the schema changed intentionally: pnpm --filter @ai-dict/core test wire-schema -u, then commit.');
  process.exit(res.status ?? 1);
}
console.log('wire:check OK — wire schema matches the committed snapshot.');
