export const meta = {
  name: 'aidict-bundle',
  description: 'Execute one ai-dict plan bundle: implement (TDD) -> spec review -> fix -> parallel quality review -> adversarial verify -> fix',
  phases: [
    { title: 'Implement' },
    { title: 'Spec review' },
    { title: 'Spec fix' },
    { title: 'Quality review' },
    { title: 'Verify findings' },
    { title: 'Quality fix' },
  ],
};

// ---- args (per-bundle) ----
// args may arrive as an object or as a JSON-encoded string depending on the
// invocation layer — handle both defensively.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {});
const REPO = '/Users/home/repos/ai-dict';
const BUNDLE = A.bundle; // e.g. "01"
const PLAN = A.planFile; // absolute path to the NN-*.md sub-plan
const SCENE = A.scene || '';
const BASE = A.baseSha; // HEAD before this bundle started
const DIMS = A.qualityDimensions || [];
const MAX_SPEC_ITERS = 3;
const MAX_QA_ITERS = 2;

const TOOLCHAIN = [
  'TOOLCHAIN (MANDATORY — read carefully):',
  "This repo targets Node 20 LTS. The machine's DEFAULT `node` is v26, which the project's engine-strict pnpm REJECTS. Node v26 is unusable here.",
  'Before ANY node / pnpm / npx / vitest / tsc / eslint command, activate Node 20 IN THE SAME shell command. Two equivalent ways:',
  '  - single command:   fnm exec --using=20 -- <command>',
  '  - compound command: eval "$(fnm env)" && fnm use 20 && <your && chained && commands>',
  'ALWAYS confirm `node --version` prints v20.20.2 (NOT v26) before pnpm. pnpm is 9.15.4 under Node 20.',
  'Shell state does NOT persist between separate Bash calls — re-activate Node 20 in EVERY Bash call that touches node/pnpm.',
  "If you ever see v26.x or an 'Unsupported engine' / 'engine' error, you forgot to activate Node 20.",
].join('\n');

const RESOURCE_SAFETY = [
  'RESOURCE SAFETY: single machine. Only run THIS package\'s tests plus the root-level typecheck/lint/test that your sub-plan\'s gate specifies. Do NOT run other packages\' heavy builds or full e2e beyond what your sub-plan requires.',
].join('\n');

const FROZEN = [
  'FROZEN CONTRACTS: Identifiers in the plan\'s cross-bundle contracts table (package names, port/type names, wire types, web-component tags+events, script names, tsconfig flags, eslint zones) are FROZEN. Do NOT rename or restructure them.',
  'If a frozen contract from an already-DONE upstream bundle does NOT match what your sub-plan assumes, STOP and report BLOCKED with specifics. Do NOT silently adapt — that causes cross-bundle drift.',
].join('\n');

// ---------- schemas ----------
const IMPL_SCHEMA = {
  type: 'object',
  required: ['status', 'headSha', 'summary'],
  additionalProperties: false,
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    baseSha: { type: 'string' },
    headSha: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testResults: { type: 'string' },
    gatesSummary: { type: 'string' },
    summary: { type: 'string' },
    concerns: { type: 'string' },
  },
};

const SPEC_SCHEMA = {
  type: 'object',
  required: ['compliant', 'issues'],
  additionalProperties: false,
  properties: {
    compliant: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'location', 'problem', 'fix'],
        additionalProperties: false,
        properties: {
          kind: { enum: ['missing', 'extra', 'misunderstanding', 'gate-failure'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
};

const QUALITY_SCHEMA = {
  type: 'object',
  required: ['dimension', 'findings'],
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'location', 'problem', 'fix'],
        additionalProperties: false,
        properties: {
          severity: { enum: ['Critical', 'Important', 'Minor'] },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['real', 'reason'],
  additionalProperties: false,
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

const FIX_SCHEMA = {
  type: 'object',
  required: ['status', 'headSha', 'summary'],
  additionalProperties: false,
  properties: {
    status: { enum: ['DONE', 'BLOCKED'] },
    headSha: { type: 'string' },
    summary: { type: 'string' },
    gatesSummary: { type: 'string' },
  },
};

// ---------- prompts ----------
function implementPrompt() {
  return [
    'You are the IMPLEMENTER for Bundle ' + BUNDLE + ' of the ai-dict monorepo build.',
    'Working directory: ' + REPO + ' (git branch: brainstorm-superpower; do NOT switch branches, do NOT push).',
    '',
    '## Your sub-plan (read it in full and execute it exactly)',
    'Read this file and follow its Implementation steps, in order, using TDD: ' + PLAN,
    'It is self-contained (YAML frontmatter, Inputs/Outputs, Definition of Done, step-by-step TDD tasks, and a Verify/Validate/Self-audit gate). The full spec, if you need it, is at ' + REPO + '/docs/superpowers/specs/2026-05-24-ai-dict-design.md',
    '',
    '## Context (where this fits)',
    SCENE,
    '',
    '## ' + TOOLCHAIN,
    '',
    '## ' + RESOURCE_SAFETY,
    '',
    '## ' + FROZEN,
    '',
    '## Execution rules',
    '1. Work through the sub-plan task by task (TDD: write the test, watch it fail, implement, watch it pass). Commit after each logical task with a clear conventional-commit message.',
    '2. Run the sub-plan\'s Verify + Validate + Self-audit gate at the end. EVERY gate command must pass (exit 0) using Node 20. Paste real command output into your report — do not claim success without running it.',
    '3. SKIP the lock-protocol git race dance (flip-to-LOCKED, pull --rebase, abort-on-race). We run strictly sequentially under a controller; there is no racing agent. Do NOT do the lock dance.',
    '4. At the very end, after all gates pass, edit ONLY your own sub-plan file (' + PLAN + ') YAML frontmatter: set status: DONE and done_at to the current UTC ISO8601 (get it with: date -u +%Y-%m-%dT%H:%M:%SZ). Also tick the per-step checkboxes you completed inside that file if you wish. Do NOT edit the README orchestrator file — the controller owns the status board.',
    '5. End every git commit message body with this trailing line:',
    '   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>',
    '6. Commit locally only. Never push.',
    '',
    '## When to stop and escalate (do NOT guess)',
    'Report BLOCKED or NEEDS_CONTEXT (rather than improvising) if: a frozen upstream contract mismatches your sub-plan; a gate fails repeatedly and you cannot fix it cleanly; the task needs an architectural decision the plan did not anticipate; or a dependency/tool is missing. Describe exactly what is stuck and what you tried.',
    '',
    '## Self-review before reporting',
    'Re-read your sub-plan\'s Definition of Done items D1..Dn and tick each against real evidence. Confirm: no leftover probe/scratch files; git diff touches only files in your owns_files; tests verify behavior (not mocks); no TODO/placeholder left; security invariants named in your sub-plan are honored.',
    '',
    '## Report (structured)',
    'Return: status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), baseSha (git HEAD before you started, from `git rev-parse HEAD`), headSha (final commit SHA), filesChanged (paths), testResults (counts + pass/fail), gatesSummary (which gate commands you ran and their exit results), summary (what you built), concerns (anything doubtful, or empty).',
  ].join('\n');
}

function specPrompt(impl) {
  return [
    'You are the SPEC-COMPLIANCE REVIEWER for Bundle ' + BUNDLE + ' of the ai-dict monorepo. You do NOT trust the implementer\'s report — verify everything by reading the actual committed code.',
    'Working directory: ' + REPO,
    '',
    '## What was requested',
    'The full requirements are in the sub-plan: ' + PLAN + ' — focus on its "Definition of Done" (D1..Dn), "Outputs", and "owns_files".',
    '',
    '## What the implementer claims',
    'Status: ' + impl.status,
    'Summary: ' + (impl.summary || '') ,
    'Gates: ' + (impl.gatesSummary || ''),
    'Files: ' + ((impl.filesChanged || []).join(', ')),
    '',
    '## ' + TOOLCHAIN,
    '',
    '## Your job — verify INDEPENDENTLY',
    'Inspect the diff for this bundle: run `git --no-pager diff ' + BASE + '..HEAD --stat` and read the changed files (Read tool). Then:',
    '1. MISSING: is every Definition-of-Done item actually implemented? Re-run the sub-plan\'s gate commands yourself (with Node 20) and confirm they pass — do not trust the report. If a gate fails, that is a gate-failure issue.',
    '2. EXTRA: did they build anything NOT requested (files outside owns_files, speculative features, unrequested deps)?',
    '3. MISUNDERSTANDING: did they implement a requirement the wrong way, or rename/alter a FROZEN contract identifier?',
    'Be specific with file:line references. Do NOT modify code; you only review.',
    '',
    '## Report (structured)',
    'Return: compliant (true only if DoD fully met, gates pass, nothing extra, contracts intact) and issues[] each as {kind: missing|extra|misunderstanding|gate-failure, location, problem, fix}.',
  ].join('\n');
}

function specFixPrompt(spec, impl) {
  const lines = spec.issues.map(function (i, n) {
    return (n + 1) + '. [' + i.kind + '] ' + i.location + ' — ' + i.problem + ' -> FIX: ' + i.fix;
  });
  return [
    'You are fixing SPEC-COMPLIANCE issues found in Bundle ' + BUNDLE + ' of the ai-dict monorepo.',
    'Working directory: ' + REPO + '. Sub-plan: ' + PLAN,
    '',
    '## ' + TOOLCHAIN,
    '## ' + RESOURCE_SAFETY,
    '## ' + FROZEN,
    '',
    '## Issues to fix (from an independent spec reviewer)',
    lines.join('\n'),
    '',
    '## Your job',
    'Fix every issue above WITHOUT introducing scope creep. Keep TDD discipline (add/adjust tests for the corrected behavior). Re-run the sub-plan\'s gate commands (Node 20) until they pass. Commit with a clear message ending in the trailing line:',
    'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>',
    'If an issue is actually a false positive (the reviewer was wrong), do NOT change code to satisfy it — instead explain why in summary. If you cannot fix cleanly, report BLOCKED.',
    '',
    '## Report (structured)',
    'Return: status (DONE | BLOCKED), headSha (new final commit), summary (what you changed and any false-positives you rejected), gatesSummary.',
  ].join('\n');
}

function qualityPrompt(dim, impl) {
  return [
    'You are a CODE-QUALITY REVIEWER for Bundle ' + BUNDLE + ' of the ai-dict monorepo. Your single review lens is: ' + dim.key.toUpperCase() + '.',
    'Working directory: ' + REPO + '. Sub-plan (requirements + DoD): ' + PLAN,
    '',
    '## Your lens',
    dim.prompt,
    '',
    '## ' + TOOLCHAIN,
    '',
    '## How to review',
    'Read the bundle diff: `git --no-pager diff ' + BASE + '..HEAD` and the changed files. Judge ONLY through your lens above. Report concrete, actionable findings with file:line. Do NOT modify code. Focus on what THIS change introduced (do not flag pre-existing code outside the diff). Prefer a few high-confidence findings over many speculative ones.',
    '',
    '## Report (structured)',
    'Return: dimension (set it to "' + dim.key + '") and findings[] each as {severity: Critical|Important|Minor, location, problem, fix}. Empty findings is a valid, good result.',
  ].join('\n');
}

function verifyPrompt(f, impl) {
  return [
    'You are an ADVERSARIAL VERIFIER for a code-quality finding in Bundle ' + BUNDLE + ' of the ai-dict monorepo. Default to REFUTED unless the evidence is clear.',
    'Working directory: ' + REPO + '. Sub-plan: ' + PLAN,
    '',
    '## ' + TOOLCHAIN,
    '',
    '## The finding to verify (dimension: ' + f.dimension + ', claimed severity: ' + f.severity + ')',
    'Location: ' + f.location,
    'Problem: ' + f.problem,
    'Proposed fix: ' + f.fix,
    '',
    '## Your job',
    'Read the actual code at that location (`git --no-pager diff ' + BASE + '..HEAD` + Read tool). Decide: is this a REAL problem worth fixing in THIS bundle, given the sub-plan\'s requirements and the project\'s conventions? Reject it if it is a false positive, a pre-existing issue outside the diff, a stylistic nit dressed up as Important, or contradicts the plan. Confirm it (real=true) only if you can point to the concrete defect.',
    '',
    '## Report (structured)',
    'Return: real (boolean) and reason (one or two sentences with evidence).',
  ].join('\n');
}

function qualityFixPrompt(confirmed, impl) {
  const lines = confirmed.map(function (f, n) {
    return (n + 1) + '. [' + f.severity + '/' + f.dimension + '] ' + f.location + ' — ' + f.problem + ' -> FIX: ' + f.fix + ' (verifier: ' + (f.verdict ? f.verdict.reason : '') + ')';
  });
  return [
    'You are fixing CONFIRMED code-quality findings in Bundle ' + BUNDLE + ' of the ai-dict monorepo. Each was independently verified as real.',
    'Working directory: ' + REPO + '. Sub-plan: ' + PLAN,
    '',
    '## ' + TOOLCHAIN,
    '## ' + RESOURCE_SAFETY,
    '## ' + FROZEN,
    '',
    '## Confirmed findings to fix',
    lines.join('\n'),
    '',
    '## Your job',
    'Fix every confirmed finding with minimal, surgical changes — no scope creep, keep tests green and the sub-plan\'s gate passing (Node 20). Add/adjust tests where the fix changes behavior. Commit with a message ending in:',
    'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>',
    'If a fix is risky or needs an architectural call, report BLOCKED with details instead of guessing.',
    '',
    '## Report (structured)',
    'Return: status (DONE | BLOCKED), headSha (new final commit), summary, gatesSummary.',
  ].join('\n');
}

// ---------- run ----------
let impl;
if (A.mode === 'review') {
  // Review-only mode: the bundle is already built + committed (e.g. its implement run crashed
  // before review). Skip implement; reviewers read the committed BASE..HEAD diff directly.
  log('Bundle ' + BUNDLE + ': REVIEW-ONLY over ' + BASE + '..HEAD');
  impl = {
    status: 'DONE',
    baseSha: BASE,
    headSha: A.headSha || 'HEAD',
    filesChanged: [],
    gatesSummary: A.gatesSummary || '(pre-verified by controller)',
    summary: A.reviewSummary || '(pre-built bundle; review-only mode)',
    concerns: '',
  };
} else {
  phase('Implement');
  log('Bundle ' + BUNDLE + ': implementing from ' + PLAN);
  impl = await agent(implementPrompt(), {
    label: 'impl:' + BUNDLE,
    phase: 'Implement',
    schema: IMPL_SCHEMA,
    agentType: 'general-purpose',
  });
  if (!impl) return { bundle: BUNDLE, status: 'SKIPPED', note: 'implementer skipped by user' };
  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    return { bundle: BUNDLE, status: impl.status, impl };
  }
}

// Spec-compliance review + fix loop
phase('Spec review');
let spec = await agent(specPrompt(impl), { label: 'spec:' + BUNDLE, phase: 'Spec review', schema: SPEC_SCHEMA, agentType: 'general-purpose' });
let specIters = 0;
const specHistory = [];
while (spec && !spec.compliant && specIters < MAX_SPEC_ITERS) {
  specIters++;
  specHistory.push(spec.issues);
  log('Bundle ' + BUNDLE + ': spec issues (' + spec.issues.length + ') -> fix pass ' + specIters);
  phase('Spec fix');
  const fix = await agent(specFixPrompt(spec, impl), {
    label: 'spec-fix:' + BUNDLE + ':' + specIters,
    phase: 'Spec fix',
    schema: FIX_SCHEMA,
    agentType: 'general-purpose',
  });
  if (fix && fix.headSha) impl.headSha = fix.headSha;
  if (fix && fix.status === 'BLOCKED') {
    return { bundle: BUNDLE, status: 'BLOCKED', stage: 'spec-fix', detail: fix.summary, spec };
  }
  phase('Spec review');
  spec = await agent(specPrompt(impl), { label: 'spec:' + BUNDLE + ':re' + specIters, phase: 'Spec review', schema: SPEC_SCHEMA, agentType: 'general-purpose' });
}
const specCompliant = !!(spec && spec.compliant);

// Multi-dimension quality review (parallel fan-out)
phase('Quality review');
const reviews = (await parallel(DIMS.map(function (d) {
  return function () {
    return agent(qualityPrompt(d, impl), { label: 'qa:' + BUNDLE + ':' + d.key, phase: 'Quality review', schema: QUALITY_SCHEMA, agentType: 'general-purpose' });
  };
}))).filter(Boolean);
const allFindings = reviews.flatMap(function (r) {
  return (r.findings || []).map(function (f) { return Object.assign({}, f, { dimension: r.dimension }); });
});
const serious = allFindings.filter(function (f) { return f.severity === 'Critical' || f.severity === 'Important'; });
const minor = allFindings.filter(function (f) { return f.severity === 'Minor'; });

// Adversarially verify serious findings
phase('Verify findings');
const verified = (await parallel(serious.map(function (f, i) {
  return function () {
    return agent(verifyPrompt(f, impl), { label: 'verify:' + BUNDLE + ':' + i, phase: 'Verify findings', schema: VERDICT_SCHEMA, agentType: 'general-purpose' })
      .then(function (v) { return Object.assign({}, f, { verdict: v }); });
  };
}))).filter(Boolean);
let confirmed = verified.filter(function (f) { return f.verdict && f.verdict.real; });

// Quality fix loop (only confirmed Critical/Important)
let qaIters = 0;
while (confirmed.length && qaIters < MAX_QA_ITERS) {
  qaIters++;
  log('Bundle ' + BUNDLE + ': ' + confirmed.length + ' confirmed quality findings -> fix pass ' + qaIters);
  phase('Quality fix');
  const qfix = await agent(qualityFixPrompt(confirmed, impl), {
    label: 'qa-fix:' + BUNDLE + ':' + qaIters,
    phase: 'Quality fix',
    schema: FIX_SCHEMA,
    agentType: 'general-purpose',
  });
  if (qfix && qfix.headSha) impl.headSha = qfix.headSha;
  if (qfix && qfix.status === 'BLOCKED') {
    return { bundle: BUNDLE, status: 'BLOCKED', stage: 'quality-fix', detail: qfix.summary, confirmed };
  }
  // re-review only the dimensions that had confirmed findings
  const dimKeys = Array.from(new Set(confirmed.map(function (f) { return f.dimension; })));
  phase('Quality review');
  const rereviews = (await parallel(dimKeys.map(function (dk) {
    const d = DIMS.find(function (x) { return x.key === dk; }) || { key: dk, prompt: 'Re-review this dimension after fixes.' };
    return function () { return agent(qualityPrompt(d, impl), { label: 'qa:' + BUNDLE + ':' + dk + ':re' + qaIters, phase: 'Quality review', schema: QUALITY_SCHEMA, agentType: 'general-purpose' }); };
  }))).filter(Boolean);
  const reFindings = rereviews.flatMap(function (r) {
    return (r.findings || []).map(function (f) { return Object.assign({}, f, { dimension: r.dimension }); });
  }).filter(function (f) { return f.severity === 'Critical' || f.severity === 'Important'; });
  // re-verify
  phase('Verify findings');
  const reVerified = (await parallel(reFindings.map(function (f, i) {
    return function () {
      return agent(verifyPrompt(f, impl), { label: 'verify:' + BUNDLE + ':re' + qaIters + ':' + i, phase: 'Verify findings', schema: VERDICT_SCHEMA, agentType: 'general-purpose' })
        .then(function (v) { return Object.assign({}, f, { verdict: v }); });
    };
  }))).filter(Boolean);
  confirmed = reVerified.filter(function (f) { return f.verdict && f.verdict.real; });
}

return {
  bundle: BUNDLE,
  status: confirmed.length ? 'DONE_WITH_OPEN_FINDINGS' : 'DONE',
  headSha: impl.headSha,
  implStatus: impl.status,
  implConcerns: impl.concerns || '',
  specCompliant: specCompliant,
  specItersUsed: specIters,
  qualityFindingsTotal: allFindings.length,
  confirmedSerious: confirmed,
  minorFindings: minor,
  summary: impl.summary,
};
