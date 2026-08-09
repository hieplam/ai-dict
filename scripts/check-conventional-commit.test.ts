import { describe, expect, it } from 'vitest';

import { isConventionalSubject, ALLOWED_TYPES } from './check-conventional-commit.mjs';

describe('isConventionalSubject — accepts well-formed Conventional Commits', () => {
  it.each(ALLOWED_TYPES)('accepts a bare "%s: <description>" subject', (type) => {
    expect(isConventionalSubject(`${type}: does a thing`)).toBe(true);
  });

  it('accepts an optional lowercase scope', () => {
    expect(isConventionalSubject('fix(sw): retry on 429')).toBe(true);
  });

  it('accepts a trailing roadmap-card reference in parentheses (free text, not a scope)', () => {
    expect(isConventionalSubject('feat: add per-site quiet mode (A13)')).toBe(true);
  });

  it('accepts the breaking-change "!" marker', () => {
    expect(isConventionalSubject('feat!: drop the legacy wire message')).toBe(true);
  });

  it('exempts a GitHub merge-commit subject', () => {
    expect(isConventionalSubject('Merge pull request #193 from hieplam/feat/x')).toBe(true);
  });

  it('exempts a git-revert subject', () => {
    expect(isConventionalSubject('Revert "feat: add per-site quiet mode"')).toBe(true);
  });
});

describe('isConventionalSubject — rejects the leaked Prospa-shaped convention', () => {
  it('rejects a [CardName] bracket prefix before the type', () => {
    expect(isConventionalSubject('[A14DoubleClickTrigger] feat: add the trigger (A14)')).toBe(
      false,
    );
  });

  it('rejects an unknown type', () => {
    expect(isConventionalSubject('feature: add the trigger')).toBe(false);
  });

  it('rejects an uppercase type', () => {
    expect(isConventionalSubject('Feat: add the trigger')).toBe(false);
  });

  it('rejects a missing colon', () => {
    expect(isConventionalSubject('feat add the trigger')).toBe(false);
  });

  it('rejects an empty description', () => {
    expect(isConventionalSubject('feat: ')).toBe(false);
  });
});
