import { describe, expect, it } from 'vitest';

import { extractSonarKeys, filterNewFindings, sonarFindingToIssue } from './sonar-issues.mjs';

const ctx = {
  host: 'https://sonarcloud.io',
  projectKey: 'hieplam_ai-dict',
  repo: 'hieplam/ai-dict',
  sha: 'abc1234',
};

const bugFinding = {
  key: 'AY-bug-1',
  rule: 'typescript:S1234',
  severity: 'MAJOR',
  type: 'BUG',
  component: 'hieplam_ai-dict:packages/app/src/domain/lookup.ts',
  line: 42,
  message: 'Remove this unreachable code',
};

describe('sonarFindingToIssue', () => {
  it('maps a Sonar issue (BUG) to title, body, and labels', () => {
    const issue = sonarFindingToIssue(bugFinding, ctx);

    expect(issue.title).toBe(
      '[Sonar][BUG] Remove this unreachable code (packages/app/src/domain/lookup.ts:42)',
    );
    expect(issue.labels).toEqual(['sonarqube', 'bug']);
    expect(issue.body).toContain('typescript:S1234');
    expect(issue.body).toContain('MAJOR');
    expect(issue.body).toContain(
      'https://github.com/hieplam/ai-dict/blob/abc1234/packages/app/src/domain/lookup.ts#L42',
    );
    expect(issue.body).toContain(
      'https://sonarcloud.io/project/issues?id=hieplam_ai-dict&open=AY-bug-1',
    );
    expect(issue.body).toContain('<!-- sonar-key: AY-bug-1 -->');
  });

  it('labels a VULNERABILITY with the vulnerability label', () => {
    const issue = sonarFindingToIssue({ ...bugFinding, type: 'VULNERABILITY' }, ctx);

    expect(issue.title).toContain('[Sonar][VULNERABILITY]');
    expect(issue.labels).toEqual(['sonarqube', 'vulnerability']);
  });

  it('maps a security hotspot (no type field, ruleKey + vulnerabilityProbability)', () => {
    const hotspot = {
      key: 'HS-1',
      ruleKey: 'typescript:S2068',
      vulnerabilityProbability: 'HIGH',
      component: 'hieplam_ai-dict:packages/app/src/adapters/gemini-client.ts',
      line: 7,
      message: 'Review this hard-coded credential',
    };

    const issue = sonarFindingToIssue(hotspot, ctx);

    expect(issue.title).toBe(
      '[Sonar][SECURITY_HOTSPOT] Review this hard-coded credential (packages/app/src/adapters/gemini-client.ts:7)',
    );
    expect(issue.labels).toEqual(['sonarqube', 'security-hotspot']);
    expect(issue.body).toContain('typescript:S2068');
    expect(issue.body).toContain('HIGH');
    expect(issue.body).toContain(
      'https://sonarcloud.io/project/security_hotspots?id=hieplam_ai-dict&hotspots=HS-1',
    );
    expect(issue.body).toContain('<!-- sonar-key: HS-1 -->');
  });

  it('omits the line suffix and anchor for file-level findings', () => {
    const fileLevel = { ...bugFinding, line: undefined };

    const issue = sonarFindingToIssue(fileLevel, ctx);

    expect(issue.title).toBe(
      '[Sonar][BUG] Remove this unreachable code (packages/app/src/domain/lookup.ts)',
    );
    expect(issue.body).toContain(
      'https://github.com/hieplam/ai-dict/blob/abc1234/packages/app/src/domain/lookup.ts',
    );
    expect(issue.body).not.toContain('#L');
  });
});

describe('filterNewFindings', () => {
  it('keeps only findings whose key has no existing issue', () => {
    const findings = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];

    expect(filterNewFindings(findings, new Set(['B']))).toEqual([{ key: 'A' }, { key: 'C' }]);
  });

  it('returns everything when no keys exist yet (first run)', () => {
    const findings = [{ key: 'A' }, { key: 'B' }];

    expect(filterNewFindings(findings, new Set())).toEqual(findings);
  });

  it('is idempotent: a second run over already-imported findings yields nothing', () => {
    const findings = [{ key: 'A' }, { key: 'B' }];

    expect(filterNewFindings(findings, new Set(['A', 'B']))).toEqual([]);
  });
});

describe('extractSonarKeys', () => {
  it('parses sonar-key markers from existing issue bodies, skipping unmarked ones', () => {
    const bodies = [
      'Rule: x\n\n<!-- sonar-key: AY-bug-1 -->',
      'a hand-written issue with no marker',
      '<!-- sonar-key: HS-1 -->\ntrailing text',
      null,
    ];

    expect(extractSonarKeys(bodies)).toEqual(new Set(['AY-bug-1', 'HS-1']));
  });
});
