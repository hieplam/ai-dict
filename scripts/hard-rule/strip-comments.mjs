#!/usr/bin/env bun
// Shared comment-stripping helper for scripts/hard-rule/ scanners (verification-loop
// campaign, card V2 / check-token-law.mjs). Strips comments BEFORE pattern-matching a
// file's source so prose/JSDoc mentioning a banned string as an example (e.g. "the old
// tokens used oklch(...)") never trips a scanner — only real code can.
//
// Deliberately NOT an AST-based parser (same "regex-based, no AST" style as
// check-dep-direction.mjs): it strips block comments (/* ... */, including /** JSDoc */),
// HTML comments (<!-- ... -->), and whole-line `//` comments (a line whose TRIMMED content
// starts with `//`). It deliberately does NOT strip a trailing inline `// comment` fragment
// that follows real code on the same line — trimming that safely would need to understand
// string/URL literals (e.g. not truncating `https://...` mid-string), which this simple
// tool does not attempt. If that limitation ever produces a real false positive, the fix is
// a reason-carrying entry in exclusions.json, not a smarter comment parser.
//
// Every replacement keeps the exact same length and the exact same number of newlines as
// the original so 1-based line numbers computed on the stripped source still point at the
// right line in the original file.

/** Replace every non-newline character in `text` with a space, preserving newlines. */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/** Strip every /* ... *\/ block comment (including JSDoc), replacing it with equal-length blanks. */
function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, blank);
}

/** Strip every <!-- ... --> HTML comment block, replacing it with equal-length blanks. */
function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, blank);
}

/** Blank out any line whose TRIMMED content starts with `//` (a whole-line comment). */
function stripWholeLineSlashComments(source) {
  return source
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? blank(line) : line))
    .join('\n');
}

/**
 * Pure: strip block comments (/* *\/, JSDoc), HTML comments (<!-- -->), and whole-line `//`
 * comments from `source`, returning a string of the same length and line count so downstream
 * violation reporting can still cite accurate line numbers.
 */
export function stripComments(source) {
  const withoutBlocks = stripBlockComments(source);
  const withoutHtml = stripHtmlComments(withoutBlocks);
  return stripWholeLineSlashComments(withoutHtml);
}
