---
name: podbay-audit
description: Runs a FULL security audit of Podbay with Cloudflare's vendored security-audit skill - all six phases, validated findings, a public record in docs/security/audits. Use it ONLY when the project lead explicitly asks for a full audit, a pen test, an end-to-end security review, a security review with a record, or the audit that gates a release. For a normal change, a question or a focused review, use podbay-security instead; it applies the same method in guidance mode.
---

# A full security audit of Podbay

The **method** is Cloudflare's [`security-audit`](../security-audit/SKILL.md) skill in its full audit mode. It is vendored unedited and is never changed here. **What must hold** in Podbay is [`podbay-security`](../podbay-security/SKILL.md). This file is the bridge: how the two are run together in this repository. Where it disagrees with the vendored skill, the vendored skill is right.

## 1. Before anything is created

1. **Is a full audit what was asked for?** It is costly, and it writes files. If the request could mean a focused review, ask one question first. The cadence that calls for one is in section 4 of `podbay-security`: before version 0.1, before every release that changes a boundary, every quarter.
2. **Agree three things with the project lead:**

   | | Choices |
   |---|---|
   | Profile | `standard` by default; `deep` before version 0.1. A `quick` or a scoped run is partial coverage and does not count as a full audit |
   | Scope | The whole repository at one commit, unless the lead names less (then it is a scoped run) |
   | Budget | A maximum number of agent invocations, or none. The vendored skill's budget gate applies either way |

3. **The vendored copy is current.** Compare `git ls-remote <source> HEAD` with the commit in [`vendored.json`](../security-audit/vendored.json). If upstream moved, update first, in a change of its own (section 7 of `podbay-security`). Then `node --test .claude/skills/security-audit/*.test.cjs` and `pnpm static vendored` pass.
4. **The tree is clean.** An audit is of a commit. Record it, and whether the worktree was dirty.

## 2. The setup values, here

| The vendored skill asks for | In Podbay |
|---|---|
| Skill directory | `<repository>/.claude/skills/security-audit` |
| Target | The repository root |
| Repo name | `podbay` |
| Output directory | `~/security-audit-skill/podbay/run-<N>`: outside the repository, and never committed. It holds the detail of findings, and this repository is public |
| Companion files | From the table in section 3 of `podbay-security`, one row per boundary |
| Parent | The session that runs this skill. It alone writes the shared run files |
| `research` agent | A subagent that only reads and searches |
| `general` agent | A general subagent, with a scratch directory of its own under the output directory |

## 3. What may run, and where

The vendored skill's execution rules and section 4 of `podbay-security` ("Where it may run") both apply in full. Together they mean:

- **Reading source is always allowed.** Most of an audit is reading.
- **Target code runs only inside the sandbox the vendored skill requires**: no outside network, an empty environment, a read-only target, hard limits. If that sandbox cannot be enforced on this machine, do not run target code. Record the question as `needs_validation` with a safe plan.
- **Never** a real Cloudflare account, a remote binding, a deploy, real mail, a real model, or anything deployed, anyone's.
- Podbay's own suites (`pnpm test:workerd`, `pnpm e2e`) keep every binding local and let nothing leave the machine. That makes them safe to rely on as **existing proof to read**; it does not make them the sandbox. A new check written for the audit follows the sandbox rule like any other target code.

## 4. Start from what Podbay already knows

Seed the reconnaissance with these; do not let them stand in for it.

| Give the audit | From |
|---|---|
| The boundaries and their invariants | `podbay-security`, sections 1 and 2 |
| Every way into the Worker, with the right it needs | `workers/auth/route-table.ts`; the MCP tools in `modules/mail/shared/mcp-tools.ts`; the handlers in `workers/app.ts` |
| The controls that are claimed, and the test said to prove each | [`docs/status.md`](../../../docs/status.md), section 1 |
| What is knowingly open | `docs/status.md`, sections 2 and 3 |
| The outcomes that are critical here | The four at the top of `podbay-security` |

A control listed in the status is a **claim to verify**, not a finding to skip. A known gap is not rediscovered as a finding: check that it is as described, record it as known, and look at what it hides.

## 5. When the run ends

1. It ends in one of the vendored skill's two terminal states: complete with both validators passing (`validate-findings.cjs`, `validate-coverage-ledger.cjs`), or `incomplete` with its exact reason.
2. Write the **record** in `docs/security/audits/YYYY-MM-DD-<kind>.md` from the template in [`docs/security/README.md`](../../../docs/security/README.md): scope, commit, method, each finding by id, boundary, severity and status, what was not covered, the gate result. A record is a public summary and never holds the detail of an unfixed finding, a secret, or steps to try against a deployed instance.
3. Each confirmed finding becomes a **private advisory** ([`SECURITY.md`](../../../SECURITY.md)).
4. **The audit describes; it does not fix.** Each fix is a change of its own, with a regression test ([`podbay-change`](../podbay-change/SKILL.md)).
5. Update what the audit made untrue: the state line in section 2 of `podbay-security`, rule S18 in `docs/status.md`, and `docs/roadmap.md`.
6. **The gate** (section 5 of `podbay-security`): an open confirmed critical or high finding blocks the release. There is no waiver.

## 6. The report to the project lead

In this order: the run status (complete or incomplete, and why); findings counted by severity and state, with no detail that does not belong in a public place; what was **not** covered; what needs validation and who can supply the missing fact; the cost in agent invocations; the gate result.

## 7. Never

- Run a full audit without the lead asking, or call a quick or scoped run a full audit.
- Commit the run directory, or write the detail of an unfixed finding anywhere in the repository.
- Edit the vendored skill, or weaken its evidence bar to finish.
- Change target source during the audit.
