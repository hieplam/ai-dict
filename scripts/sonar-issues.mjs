#!/usr/bin/env bun
// One-time SonarQube Cloud → GitHub Issues backlog importer (spec:
// docs/superpowers/specs/2026-06-09-sonarqube-cloud-integration-design.md).
//
// Pulls unresolved Bugs + Vulnerabilities (severity ≥ Major) and TO_REVIEW
// security hotspots from the Sonar Web API and opens one GitHub issue per
// finding. Create-only by design: it never closes issues when Sonar resolves
// a finding — re-running is idempotent via the hidden sonar-key marker.
//
// Usage: bun scripts/sonar-issues.mjs [--dry-run]
// Env:   SONAR_TOKEN (required), SONAR_HOST_URL (default https://sonarcloud.io),
//        SONAR_PROJECT_KEY (default hieplam_ai-dict),
//        GITHUB_REPOSITORY (default hieplam/ai-dict),
//        GITHUB_TOKEN (required unless --dry-run), GITHUB_SHA (permalink ref)

const SONAR_KEY_MARKER = /<!-- sonar-key: (\S+) -->/;

const TYPE_LABELS = {
  BUG: 'bug',
  VULNERABILITY: 'vulnerability',
  SECURITY_HOTSPOT: 'security-hotspot',
};

/** Map one Sonar finding (issue or hotspot shape) to a GitHub issue payload. */
export function sonarFindingToIssue(finding, { host, projectKey, repo, sha }) {
  // Hotspots come from /api/hotspots/search and have no `type`/`severity`;
  // they carry `ruleKey` + `vulnerabilityProbability` instead.
  const isHotspot = finding.type === undefined;
  const type = isHotspot ? 'SECURITY_HOTSPOT' : finding.type;
  const rule = isHotspot ? finding.ruleKey : finding.rule;
  const severity = isHotspot ? finding.vulnerabilityProbability : finding.severity;
  const file = finding.component.replace(`${projectKey}:`, '');
  const location = finding.line === undefined ? file : `${file}:${finding.line}`;
  const anchor = finding.line === undefined ? '' : `#L${finding.line}`;
  const sonarUrl = isHotspot
    ? `${host}/project/security_hotspots?id=${projectKey}&hotspots=${finding.key}`
    : `${host}/project/issues?id=${projectKey}&open=${finding.key}`;

  return {
    title: `[Sonar][${type}] ${finding.message} (${location})`,
    body: [
      `**Rule:** ${rule}`,
      `**Severity:** ${severity}`,
      `**File:** https://github.com/${repo}/blob/${sha}/${file}${anchor}`,
      `**Sonar:** ${sonarUrl}`,
      '',
      `<!-- sonar-key: ${finding.key} -->`,
    ].join('\n'),
    labels: ['sonarqube', TYPE_LABELS[type]],
  };
}

/** Keep only findings whose key has no existing GitHub issue. */
export function filterNewFindings(findings, existingKeys) {
  return findings.filter((f) => !existingKeys.has(f.key));
}

/** Parse sonar-key dedup markers out of existing issue bodies. */
export function extractSonarKeys(bodies) {
  const keys = new Set();
  for (const body of bodies) {
    const match = body?.match(SONAR_KEY_MARKER);
    if (match) keys.add(match[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Thin I/O shell below — exercised manually via --dry-run, not unit tested.
// ---------------------------------------------------------------------------

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchAllPages(baseUrl, headers, getItems, getTotal) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = await fetchJson(`${baseUrl}&p=${page}&ps=500`, headers);
    items.push(...getItems(data));
    if (items.length >= getTotal(data) || getItems(data).length === 0) return items;
  }
}

async function fetchSonarFindings(host, projectKey, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const issues = await fetchAllPages(
    `${host}/api/issues/search?componentKeys=${projectKey}&types=BUG,VULNERABILITY&severities=MAJOR,CRITICAL,BLOCKER&resolved=false`,
    headers,
    (d) => d.issues,
    (d) => d.paging.total,
  );
  const hotspots = await fetchAllPages(
    `${host}/api/hotspots/search?projectKey=${projectKey}&status=TO_REVIEW`,
    headers,
    (d) => d.hotspots,
    (d) => d.paging.total,
  );
  return [...issues, ...hotspots];
}

async function githubRequest(repo, token, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  // 422 on label creation means "already exists" — fine for our ensure-label step
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchExistingSonarKeys(repo, token) {
  const bodies = [];
  for (let page = 1; ; page++) {
    const issues = await githubRequest(
      repo,
      token,
      `/issues?labels=sonarqube&state=all&per_page=100&page=${page}`,
    );
    // The issues endpoint also returns PRs; only real issues carry our marker
    bodies.push(...issues.filter((i) => !i.pull_request).map((i) => i.body));
    if (issues.length < 100) return extractSonarKeys(bodies);
  }
}

async function ensureLabels(repo, token, labels) {
  for (const name of labels) {
    await githubRequest(repo, token, '/labels', {
      method: 'POST',
      body: JSON.stringify({ name, color: 'fbca04', description: 'Imported from SonarQube' }),
    });
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const host = process.env.SONAR_HOST_URL ?? 'https://sonarcloud.io';
  const projectKey = process.env.SONAR_PROJECT_KEY ?? 'hieplam_ai-dict';
  const repo = process.env.GITHUB_REPOSITORY ?? 'hieplam/ai-dict';
  const sha = process.env.GITHUB_SHA ?? 'master';
  const sonarToken = process.env.SONAR_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!sonarToken) throw new Error('SONAR_TOKEN is required');
  if (!dryRun && !githubToken) throw new Error('GITHUB_TOKEN is required (or pass --dry-run)');

  const findings = await fetchSonarFindings(host, projectKey, sonarToken);
  // Dry-run must not touch the GitHub API at all — skip the dedup listing too
  const existingKeys = dryRun ? new Set() : await fetchExistingSonarKeys(repo, githubToken);
  const fresh = filterNewFindings(findings, existingKeys);
  const issues = fresh.map((f) => sonarFindingToIssue(f, { host, projectKey, repo, sha }));

  console.log(
    `${findings.length} finding(s), ${existingKeys.size} already imported, ${issues.length} to create${dryRun ? ' (dry-run)' : ''}`,
  );

  if (dryRun) {
    for (const issue of issues) console.log(`- ${issue.title} [${issue.labels.join(', ')}]`);
    return;
  }

  await ensureLabels(repo, githubToken, [...new Set(issues.flatMap((i) => i.labels))]);
  for (const issue of issues) {
    const created = await githubRequest(repo, githubToken, '/issues', {
      method: 'POST',
      body: JSON.stringify(issue),
    });
    console.log(`created #${created.number}: ${issue.title}`);
  }
}

// Only run the shell when executed directly (not when imported by tests)
if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
