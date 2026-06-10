#!/usr/bin/env bun
// Hard gate for the inward-only import dependency direction
// (ref-core-dependency-rule, rule-domain-purity). Runs before every extension
// build and at the front of `bun run lint`; a violating tree cannot produce a
// bundle or pass CI.
//
// Allowlist matrix (ADR adr-20260610-dep-direction-build-gate):
//   packages/app/src/domain/**  → only ./ (domain) and ../ports
//   packages/app/src/ports.ts   → only ./domain/*
//   packages/app/src/wire.ts    → only ./domain/* and zod
//   packages/app/**             → never an extension shell, never outside the package
//   packages/extension-A/**     → never packages/extension-B
//
// Usage: bun scripts/check-dep-direction.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const IMPORT_PATTERNS = [
  // import x from 'y' | import {a} from 'y' | import type {a} from 'y' | import 'y'
  /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  // export {a} from 'y' | export * from 'y' | export type {a} from 'y'
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  // dynamic import('y')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Extract every import/export-from specifier with its 1-based line number. */
export function extractImports(source) {
  const found = new Map(); // specifier start index → statement start (dedupes overlapping hits)
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specStart = match.index + match[0].indexOf(match[1]);
      if (!found.has(specStart))
        found.set(specStart, { specifier: match[1], stmtStart: match.index });
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { specifier, stmtStart }]) => ({
      specifier,
      line: source.slice(0, stmtStart).split('\n').length,
    }));
}

/** Resolve a relative specifier against the importing file's repo-relative dir. */
function resolveRelative(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

const isRelative = (s) => s.startsWith('./') || s.startsWith('../');
const inDir = (path, dir) => path === dir || path.startsWith(`${dir}/`);
// matches 'packages/app/src/ports' with or without extension
const isModule = (path, modulePath) => path === modulePath || path === `${modulePath}.ts`;

const PORT_HINT =
  'To reach outward, declare a port interface in packages/app/src/ports.ts and inject a concrete adapter from the composition root (sw.ts / content.ts) — see ref-dependency-injection.';

const RULES = [
  {
    id: 'rule-domain-purity',
    appliesTo: (file) => inDir(file, 'packages/app/src/domain'),
    allows: (file, spec) => {
      if (!isRelative(spec)) return false;
      const resolved = resolveRelative(file, spec);
      return (
        inDir(resolved, 'packages/app/src/domain') || isModule(resolved, 'packages/app/src/ports')
      );
    },
    explain:
      'domain/** may import only sibling domain files and ../ports — no npm libraries, no app/, ui/, wire, or platform code (rule-domain-purity).',
    hint: PORT_HINT,
  },
  {
    id: 'rule-ports-boundary',
    appliesTo: (file) => isModule(file, 'packages/app/src/ports'),
    allows: (file, spec) =>
      isRelative(spec) && inDir(resolveRelative(file, spec), 'packages/app/src/domain'),
    explain:
      'ports.ts is the boundary: it may import domain types only — an adapter, ui, or library import would invert the dependency direction (ref-core-dependency-rule).',
    hint: PORT_HINT,
  },
  {
    id: 'rule-wire-edge',
    appliesTo: (file) => isModule(file, 'packages/app/src/wire'),
    allows: (file, spec) =>
      spec === 'zod' ||
      (isRelative(spec) && inDir(resolveRelative(file, spec), 'packages/app/src/domain')),
    explain:
      'wire.ts is the zod edge: it may import only zod and domain types (ref-wire-protocol-validation).',
    hint: PORT_HINT,
  },
  {
    id: 'rule-core-no-shell',
    appliesTo: (file) => inDir(file, 'packages/app'),
    allows: (file, spec) => {
      if (spec.startsWith('@ai-dict/extension')) return false;
      if (isRelative(spec) && !inDir(resolveRelative(file, spec), 'packages/app')) return false;
      return true;
    },
    explain:
      'the core (@ai-dict/app) must never import an extension shell — dependencies point inward only (ref-core-dependency-rule).',
    hint: PORT_HINT,
  },
  {
    id: 'rule-shell-isolation',
    appliesTo: (file) =>
      inDir(file, 'packages/extension-chrome') || inDir(file, 'packages/extension-safari'),
    allows: (file, spec) => {
      const sibling = inDir(file, 'packages/extension-chrome')
        ? 'extension-safari'
        : 'extension-chrome';
      if (spec === `@ai-dict/${sibling}` || spec.startsWith(`@ai-dict/${sibling}/`)) return false;
      if (isRelative(spec) && inDir(resolveRelative(file, spec), `packages/${sibling}`))
        return false;
      return true;
    },
    explain:
      'extension shells never import each other — shared behavior belongs in the core behind a port (ref-core-dependency-rule).',
    hint: 'Move the shared logic into packages/app and expose it through @ai-dict/app.',
  },
];

/**
 * Check one file's source against every applicable rule.
 * @param {string} file repo-relative posix path, e.g. 'packages/app/src/domain/types.ts'
 * @param {string} source file content
 */
export function checkFile(file, source) {
  const rules = RULES.filter((r) => r.appliesTo(file));
  if (rules.length === 0) return [];
  const violations = [];
  for (const { specifier, line } of extractImports(source)) {
    const broken = rules.find((r) => !r.allows(file, specifier));
    if (broken) {
      violations.push({
        file,
        line,
        specifier,
        rule: broken.id,
        explain: broken.explain,
        hint: broken.hint,
      });
    }
  }
  return violations;
}

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
  const repoRoot = new URL('..', import.meta.url).pathname;
  const violations = checkRepo(repoRoot);
  if (violations.length === 0) {
    console.log('✓ dependency direction OK — all imports point inward (ref-core-dependency-rule)');
    return;
  }
  console.error(`✖ dependency-direction check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  imports '${v.specifier}'`);
    console.error(`    broken rule: ${v.rule} — ${v.explain}`);
    console.error(`    fix: ${v.hint}\n`);
  }
  console.error('Build blocked. Fix the imports above — do not bypass this gate.');
  process.exit(1);
}

if (import.meta.main) main();
