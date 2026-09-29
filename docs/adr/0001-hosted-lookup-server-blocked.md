# ADR 0001 — Hosted lookup server: blocked on credential policy

- **Status:** Blocked (cannot implement for now) — owner ruling, 2026-09-29
- **Deciders:** owner (Hiep Lam), Shaman session 2026-09-29
- **Supersedes / superseded by:** —

An ADR (Architecture Decision Record) is a short document that captures one significant
decision, the context that forced it, and its consequences, so a later reader knows why the
codebase looks the way it does without re-running the debate. This is the first one in this repo.

## Context

Today the extension has no server. A user installs it from the Chrome Web Store, creates a Google
Gemini API key, and pastes it into the options page; the service worker then calls the provider
directly (`packages/extension-chrome/src/sw.ts`, `getApiKey` → `chrome.storage.local`). The roadmap
ratifies this as a standing wall: "100% local. No backend, no accounts" (`docs/ROADMAP.md` §3),
and `PRIVACY.md` promises "We operate no server and no backend of our own."

Two problems drove this proposal:

1. **The key paste is the onboarding blocker.** Most people who install the extension never get a
   Google key, so they never see a first lookup.
2. **The Gemini free tier runs out fast.** Google no longer publishes fixed free-tier numbers;
   limits appear only in AI Studio and "are not guaranteed" (https://ai.google.dev/gemini-api/docs/rate-limits).
   Users who do paste a key hit the limit within a day of normal reading.

The OpenAI and Anthropic clients (`packages/app/src/domain/types.ts`, `Provider`) exist but were
found unusable in real tests. The D1 campaign of 2026-07-30 (`docs/ROADMAP.md` §"P0 bug fix —
billing/quota errors") traced that to accounts with no spendable balance plus an error mapper that
mislabeled the failure; whether those clients work with a funded key is unverified.

## Proposal that was evaluated

A **lookup server** owned by the maintainer: the extension sends the word plus sentence to the
server, the server holds the maintainer's model credentials, streams the answer back, and meters
usage per user. The extension gains a **hosted mode** so a store install needs no key.

Decisions the owner ratified during the brainstorm, kept here so they do not have to be re-argued
if the work resumes:

| Id  | Decision                                                                                                                                                                                    | Who    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | Hosted mode is the default for store installs; "use my own key" (BYOK) stays as an advanced option. No invite codes. `PRIVACY.md`, README and the landing page `#start` would be rewritten. | owner  |
| D3  | Access control is Google sign-in in the extension (identity = email) against an email whitelist the owner manages. Unlisted users are refused hosted lookups and fall back to BYOK.         | owner  |
| D4  | Deployment is full Kubernetes (kubeadm) on the owner's single-node VPS. Local development runs the same manifests on `kind` (Kubernetes-in-Docker) with a dev overlay.                      | owner  |
| D5  | The server is a new package in this monorepo, sharing `packages/app/src/wire.ts` types and the prompt template.                                                                             | Shaman |
| D6  | TypeScript on Bun; the provider's official SDK; handler → service → provider adapter / repository in one direction; SQLite on a persistent volume behind a repository interface.            | Shaman |

Guardrails the design would have carried: provider credentials only in a cluster Secret (never in
the image, repo, logs, or responses); the server persists no lookup text, only per-request
metadata (user id, model, tokens, latency, cost, outcome); a per-user daily quota plus one global
daily spend cap; streaming preserved end to end; the landing page never touches a key or token.

## Decision

**Blocked.** The owner wants the server to spend their **Claude subscription** quota, by using the
Claude Agent SDK to spawn a `claude` process under the owner's subscription OAuth token, and does
not want to fund a pay-as-you-go API key for now.

Anthropic's policy prohibits that shape. From the Claude Code legal page, section "Authentication
and credential use" (https://code.claude.com/docs/en/legal-and-compliance):

> Anthropic does not permit third-party developers to offer Claude.ai login into their own
> applications, or to route requests through Free, Pro, or Max plan credentials on behalf of
> their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials
> or session tokens.

and, for builders: developers "including those using the Agent SDK, should use API key
authentication". The same page confirms the permitted shape is an API key the owner provisions in a
secrets manager "for use by the customer's own authorized users", billed to the key owner.

Why the owner's daily Claude Code and plugin use is fine while this server is not: the line is
whose requests run on the credentials. Personal use inside Claude Code is the subscriber's own
"ordinary use". This server would answer other people's lookups on the same credentials, which
is the "on behalf of their users" case named above. Spawning a `claude` process inside the server
does not change which case it is. Anthropic enforces this with client-identity checks
(https://github.com/anthropics/claude-code/issues/28091), so the realistic outcome is a suspended
account, not a working product. The equivalent route through a ChatGPT subscription and the Codex
CLI is likewise not sanctioned by OpenAI's terms
(https://github.com/openai/codex/discussions/8338).

The owner's ruling, verbatim: "if we can not do this, stop this and record as blocked or can not
implement for now."

## Consequences

- The "100% local, no backend" wall in `docs/ROADMAP.md` §3 and `PRIVACY.md` stays in force. No
  server package, manifests, or hosted mode are added.
- The onboarding blocker and the Gemini free-tier limit remain open problems.
- Estimated cost of the permitted route, for reference when this is revisited (10 users × 30
  lookups/day, ~600 input / ~250 output tokens per lookup):

  | Model             | Per lookup | Per month |
  | ----------------- | ---------- | --------- |
  | Claude Haiku 4.5  | ~$0.002    | ~$18      |
  | Claude Sonnet 5.5 | ~$0.004    | ~$36      |

## Resume conditions

Reopen this ADR (as a superseding ADR) when either holds:

1. The owner accepts a pay-as-you-go key (Anthropic, Gemini paid tier, or OpenAI) held only on
   the server. Then the work is three cards in order: the server (runnable locally on `kind`),
   the VPS deployment, and the extension's hosted mode with the product-promise rewrite. Card 1
   must open with a real experiment proving the chosen client streams a lookup with a funded key.
2. Anthropic changes the credential policy quoted above.
