---
id: adr-20260610-fix-ci-push-trigger-master
c3-seal: 6752b684596321adfbdb3df963a30eba979c8eda01fb8a9ba6c230d2313768f5
title: fix-ci-push-trigger-master
type: adr
goal: Make `.github/workflows/ci.yml` run on pushes to **master** (the repo's real default branch) instead of `main`, which does not exist. Today the push trigger never fires, so merged code is only re-validated by the nightly cron, and the just-merged SonarQube Cloud job (`adr-20260610-add-sonarqube-cloud-integration`) cannot produce its master-branch baseline analysis until the nightly run.
status: implemented
date: "2026-06-10"
---

# Fix CI push trigger to the actual default branch (master)

## Goal

Make `.github/workflows/ci.yml` run on pushes to **master** (the repo's real default branch) instead of `main`, which does not exist. Today the push trigger never fires, so merged code is only re-validated by the nightly cron, and the just-merged SonarQube Cloud job (`adr-20260610-add-sonarqube-cloud-integration`) cannot produce its master-branch baseline analysis until the nightly run.

## Context

`ci.yml` declares `on.push.branches: [main]`, but `gh repo view` and every PR in history target `master`. Evidence: `gh run list --branch master --workflow CI` shows exclusively `schedule` events — no push-triggered run has ever fired. This was latent and harmless while CI only gated PRs, but the SonarQube integration merged in PR #34 needs a default-branch analysis as the new-code baseline for PR decoration, and the spec for that work explicitly intends "base scan + coverage (every push/PR)". The file is outside the C3 code map (uncharted; verified via `c3 lookup .github/workflows/ci.yml` during the Sonar ADR).

## Decision

Change `on.push.branches` from `[main]` to `[master]`. No other trigger changes: `pull_request` and the nightly `schedule` stay as-is. This makes every squash-merge to master run the full gate suite including the `sonarcloud` job, which (now that `SONAR_TOKEN` exists) publishes the master baseline analysis after each merge.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| N.A - only .github/workflows/ci.yml changes, which is outside the C3 code map (no component owns CI config) | N.A - uncharted by design | N.A - no source path touched | N.A - ownership evidence recorded here |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| N.A - no ref governs CI workflow files (zero matches from c3 lookup) | N.A | N.A |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| N.A - all five rules scope to source paths (domain/**, sanitize, routers, errors, key isolation); a trigger-branch rename touches none of them and introduces no secret | N.A - out of scope | N.A - no action |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| CI trigger | .github/workflows/ci.yml line branches: [main] → branches: [master] | one-line diff in PR |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI surface touched | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| GitHub Actions itself | After merge, a push-event CI run appears on master for the merge commit — previously impossible | gh run list --branch master shows a push event run |
| sonarcloud job on that run | Publishes the first master-branch Sonar analysis (token now present) | analysis visible via SonarCloud API api/project_analyses/search |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Leave [main] and rely on the nightly cron for master analyses | Baseline lags merges by up to 24h, so same-day PRs get no/stale new-code comparison; also keeps a dead trigger that misleads readers |
| Rename the default branch to main | Far larger blast radius (open PRs, worktrees, branch protection, docs reference master throughout) for zero functional gain |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Doubled CI cost: each merge now runs the suite that the PR already ran | Accepted: suite is ~2 min; concurrency group already cancels superseded runs; this is the standard gate pattern and is required for the Sonar baseline | observe one merge: exactly one push run, completes green |

## Verification

| Check | Result |
| --- | --- |
| PR CI fully green including a real sonarcloud scan (token now set) | required before merge |
| After squash-merge: gh run list --branch master --workflow CI shows a push-event run on the merge commit | required |
| curl https://sonarcloud.io/api/project_analyses/search?project=hieplam_ai-dict returns a master analysis | required |
