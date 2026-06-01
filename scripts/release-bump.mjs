#!/usr/bin/env node
// release:bump <major.minor.patch> [--dry-run]
// Single source of truth = root package.json version; fans out to both manifests
// and the iOS Xcode MARKETING_VERSION (no macOS target exists — Bundle 06 §5.5).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: pnpm release:bump <major.minor.patch> [--dry-run]');
  process.exit(1);
}

/** @type {{ file: string, from: string, next: string }[]} */
const edits = [];

// 1) root package.json (spread preserves key order; version stays in place)
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
edits.push({ file: pkgPath, from: pkg.version, next: JSON.stringify({ ...pkg, version }, null, 2) + '\n' });

// 2) both extension manifests
for (const rel of [
  'packages/extension-chrome/src/manifest.json',
  'packages/extension-safari/src/manifest.json',
]) {
  const p = resolve(root, rel);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  edits.push({ file: p, from: j.version, next: JSON.stringify({ ...j, version }, null, 2) + '\n' });
}

// 3) Xcode MARKETING_VERSION (iOS target only)
const pbx = findFirst(resolve(root, 'packages/extension-safari/xcode'), /\.pbxproj$/);
if (pbx) {
  const text = readFileSync(pbx, 'utf8');
  const from = (text.match(/MARKETING_VERSION = ([^;]+);/) ?? [undefined, '(none)'])[1];
  const next = text.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  edits.push({ file: pbx, from, next });
} else {
  console.warn('warning: no .pbxproj under packages/extension-safari/xcode — skipping MARKETING_VERSION');
}

for (const e of edits) {
  console.log(`${dryRun ? '[dry-run] ' : ''}${e.from} -> ${version}   ${e.file}`);
  if (!dryRun) writeFileSync(e.file, e.next);
}
console.log(dryRun ? '\ndry-run: no files written.' : `\nbumped all targets to ${version}.`);

function findFirst(dir, re) {
  let hit = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!hit && re.test(name)) hit = full;
    }
  };
  try { walk(dir); } catch { /* xcode/ may not exist in early bundles */ }
  return hit;
}
