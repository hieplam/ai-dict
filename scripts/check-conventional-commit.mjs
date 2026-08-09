#!/usr/bin/env bun
// Enforces Conventional Commits (docs/git-conventions.md) so release-please's
// conventional-changelog parser can classify every commit for versioning/CHANGELOG.
//
// The parser requires the type token to be the very first thing on the subject line — a
// `[CardName]` (or any other) bracket prefix before it makes the commit invisible to
// release-please, which is exactly the defect this script exists to catch (see the History
// section of docs/git-conventions.md).
//
// Two entry points, matching the repo's commit + CI dual-gate pattern:
//   bun scripts/check-conventional-commit.mjs --hook <commit-msg-file>   (.githooks/commit-msg)
//   bun scripts/check-conventional-commit.mjs --range <base>..<head>    (CI, ci.yml)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const ALLOWED_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'style',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

const SUBJECT_PATTERN = new RegExp(`^(${ALLOWED_TYPES.join('|')})(\\([-a-z0-9_/]+\\))?!?: .+$`);

// Merge commits (GitHub's default merge-commit subject, or a local `git merge`) and
// `git revert`'s own auto-generated subject are exempt — neither is meant to read as a
// Conventional Commit, and conventional-changelog/release-please already ignores merges itself.
const EXEMPT_PATTERN = /^(Merge |Revert ")/;

/** True if `subject` (the commit's first line) is a Conventional Commit, or is exempt. */
export function isConventionalSubject(subject) {
  if (EXEMPT_PATTERN.test(subject)) return true;
  return SUBJECT_PATTERN.test(subject);
}

function firstLine(message) {
  return message.split('\n')[0];
}

function checkHook(msgFilePath) {
  const subject = firstLine(readFileSync(msgFilePath, 'utf8').trim());
  if (isConventionalSubject(subject)) return 0;
  reportFailure([subject]);
  return 1;
}

function checkRange(range) {
  const log = execFileSync('git', ['log', '--format=%s', range], { encoding: 'utf8' });
  const subjects = log.split('\n').filter(Boolean);
  const bad = subjects.filter((s) => !isConventionalSubject(s));
  if (bad.length === 0) {
    console.log(`✓ ${subjects.length} commit(s) in ${range} are Conventional Commits`);
    return 0;
  }
  reportFailure(bad);
  return 1;
}

function reportFailure(badSubjects) {
  console.error(`✖ ${badSubjects.length} commit message(s) are not Conventional Commits:\n`);
  for (const s of badSubjects) console.error(`  ${s}`);
  console.error(
    `\nExpected: <${ALLOWED_TYPES.join('|')}>(<scope>)?: <description> — see docs/git-conventions.md. ` +
      "No bracket prefix before the type (it breaks release-please's parser).",
  );
}

function main() {
  const [flag, value] = process.argv.slice(2);
  if (flag === '--hook' && value) process.exit(checkHook(value));
  if (flag === '--range' && value) process.exit(checkRange(value));
  console.error('Usage: check-conventional-commit.mjs --hook <msgfile> | --range <base>..<head>');
  process.exit(1);
}

if (import.meta.main) main();
