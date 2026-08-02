// Shared exclusions store for scripts/hard-rule/ scanners (verification-loop
// campaign, card V2). Shape (scripts/hard-rule/exclusions.json):
//
//   { "<rule-id>": [ { "path": "<repo-relative path>", "reason": "<why>" } ] }
//
// Exclusions are scoped PER RULE — never global — because a path excluded from
// one rule (e.g. sw.ts from token-law, since the badge color cannot read CSS
// custom properties) must still be scanned by every other rule. Every entry
// MUST carry a non-empty, human-readable `reason`: a reason-less entry is a
// hard failure so an exclusion can never become an undocumented blanket bypass.

import { readFileSync } from 'node:fs';

const EXCLUSIONS_PATH = new URL('./exclusions.json', import.meta.url);

/**
 * Pure: throw if any entry, across every rule in the whole exclusions file,
 * is missing a non-empty `reason`.
 */
export function validateExclusions(exclusions) {
  for (const [ruleId, entries] of Object.entries(exclusions)) {
    for (const entry of entries) {
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        throw new Error(
          `scripts/hard-rule/exclusions.json: rule "${ruleId}" has an entry for path ` +
            `"${entry.path}" with no reason — every exclusion must carry a non-empty ` +
            'human-readable reason.',
        );
      }
    }
  }
}

/**
 * Pure: the excluded repo-relative paths for one rule id, once the whole
 * file has been validated (so a reason-less entry under an unrelated rule
 * still fails loudly rather than being silently ignored).
 */
export function excludedPathsFor(exclusions, ruleId) {
  validateExclusions(exclusions);
  return (exclusions[ruleId] ?? []).map((entry) => entry.path);
}

/** Edge: read scripts/hard-rule/exclusions.json from disk and return the excluded paths for `ruleId`. */
export function loadExclusions(ruleId) {
  const exclusions = JSON.parse(readFileSync(EXCLUSIONS_PATH, 'utf8'));
  return excludedPathsFor(exclusions, ruleId);
}
