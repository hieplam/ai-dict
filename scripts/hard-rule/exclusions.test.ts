import { describe, expect, it } from 'vitest';

import { excludedPathsFor, loadExclusions, validateExclusions } from './exclusions.mjs';

describe('validateExclusions — every entry across every rule must carry a non-empty reason', () => {
  it('throws when an entry is missing the reason field entirely', () => {
    const bad = { 'rule-token-law': [{ path: 'packages/extension-chrome/src/sw.ts' }] };
    expect(() => validateExclusions(bad)).toThrow(/reason/i);
  });

  it('throws when reason is present but blank', () => {
    const bad = { 'rule-token-law': [{ path: 'a/b.ts', reason: '   ' }] };
    expect(() => validateExclusions(bad)).toThrow(/reason/i);
  });

  it('does not throw when every entry across every rule has a non-empty reason', () => {
    const good = {
      'rule-token-law': [
        {
          path: 'packages/extension-chrome/src/sw.ts',
          reason: 'badge color cannot read CSS custom properties',
        },
      ],
    };
    expect(() => validateExclusions(good)).not.toThrow();
  });

  it('does not throw on an empty exclusions object', () => {
    expect(() => validateExclusions({})).not.toThrow();
  });
});

describe('excludedPathsFor — the paths excluded for one rule id', () => {
  it('returns the excluded paths for a rule id with entries', () => {
    const exclusions = {
      'rule-token-law': [
        { path: 'a.ts', reason: 'why a' },
        { path: 'b.ts', reason: 'why b' },
      ],
    };
    expect(excludedPathsFor(exclusions, 'rule-token-law')).toEqual(['a.ts', 'b.ts']);
  });

  it('returns an empty list for a rule id with no entries — length still zero when there is nothing to load', () => {
    expect(excludedPathsFor({}, 'rule-token-law')).toEqual([]);
  });

  it('rejects the whole file (throws) if ANY other rule has a reason-less entry', () => {
    const exclusions = {
      'rule-token-law': [{ path: 'a.ts', reason: 'why' }],
      'rule-key-isolation': [{ path: 'b.ts' }],
    };
    expect(() => excludedPathsFor(exclusions, 'rule-token-law')).toThrow(/reason/i);
  });
});

describe('loadExclusions — reads scripts/hard-rule/exclusions.json from disk', () => {
  it('returns an empty list for a rule id absent from the committed exclusions file', () => {
    expect(loadExclusions('rule-that-does-not-exist-yet')).toEqual([]);
  });
});
