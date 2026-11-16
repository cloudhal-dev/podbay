# Security records

This folder holds the records that rule S18 of the [engineering rules](../engineering-rules.md) asks for. The rule, in short:

- Cloudflare's `security-audit` skill is vendored unedited in `.claude/skills/security-audit/`. `pnpm static vendored` fails when a file there differs from its recorded hash.
- The [`podbay-security`](../../.claude/skills/podbay-security/SKILL.md) skill names Podbay's trust boundaries, their invariants and the proof that exists today.
- A change to a trust boundary ships a regression test.
- A full audit runs before v0.1, before every release that changes a boundary, and every quarter.
- A confirmed critical or high finding blocks the release.

To report a vulnerability, do not open an issue and do not write here. Follow [`SECURITY.md`](../../SECURITY.md).

## What lives here

| Path | Content |
|---|---|
| `audits/` | One dated record per full audit |
| `README.md` | This page: the record template and the release gate |

No full audit has run yet. The first one is due before v0.1.

## Audit records

One file per full audit, named `audits/YYYY-MM-DD-<kind>.md`, where the kind is `v0.1`, `release-<version>` or `quarterly`. A record is written once. A later change (a finding fixed, a detail published) is added as a dated line; nothing is removed.

A record is a public summary. The working files of an audit stay outside the repository.

| A record holds | A record never holds |
|---|---|
| The scope, the commit and the method | The detail of a finding whose fix is not released yet |
| Each finding by id, boundary, severity and status | A secret, a token or a key, real or test |
| What was not covered, and why | Real mail, real addresses, real account ids |
| The gate result and the sign-off | Steps to try against a deployed instance |

### Template

```markdown
# Security audit: <kind>, <YYYY-MM-DD>

## Scope

| | |
|---|---|
| Kind | Before v0.1 / Before release <version> / Quarterly |
| Commit | <full commit hash>; working tree clean: yes / no |
| In scope | The whole repository |
| Out of scope | <paths or surfaces, each with the reason; "nothing" if so> |
| Boundaries changed since the last record | <B-numbers from the podbay-security skill, or "first audit"> |

## Method

| | |
|---|---|
| Skill | security-audit at upstream commit <hash from vendored.json>, full audit mode |
| Profile | standard / deep |
| Where it ran | Locally, every binding local. No real Cloudflare account, no real mail, no model call |
| Who ran it | <name or agent> |
| Who verified | <name or agent, independent of the above> |
| Validators | validate-findings: pass / fail. validate-coverage-ledger: pass / fail |
| Coverage | <units covered, deferred, blocked; one line on the gaps> |

## Findings

Severity follows the vendored skill's anchors. Only a confirmed finding has one.

| Id | Boundary | Severity | State | Status | Fix and regression test | Advisory |
|---|---|---|---|---|---|---|
| F1 | B4 | high | confirmed | open / fixed in <commit> | <test path> | <link, once public> |
| F2 | B1 | — | rejected | closed | — | — |

## Needs validation

| Id | Boundary | Missing fact | Who resolves it |
|---|---|---|---|
| N1 | B7 | <the fact that source and local checks could not settle> | <name> |

## Release gate

Open confirmed findings at critical or high: <none / ids>.

Result: **pass** / **blocked**.

## Sign-off

<name>, project lead, <YYYY-MM-DD>

## Later changes

- <YYYY-MM-DD>: <what changed, for example "F1 fixed in <commit>, detail published in <advisory>">
```

## The release gate

| Question | Answer |
|---|---|
| What blocks a release? | An open, confirmed finding at critical or high |
| What closes a finding? | Its fix is merged with a regression test and a fresh check confirms it, or a fresh check rejects the finding with evidence |
| Is there a waiver? | No. Rule S18 has none |
| What about medium and lower? | They do not block. The record gives each an owner and a status |
| What does a release need? | A current record: a full audit whose commit includes the release's last change to a trust boundary, less than one quarter old, with the result "pass" |
| Who checks it? | The project lead, by hand, until the release workflow exists. No release workflow is built yet; when it is, it requires the record |

What Podbay treats as critical is in [`SECURITY.md`](../../SECURITY.md): reading a mailbox without a membership, sending as someone else, running script from a message, leaking a credential.

## Where audits run

Only locally, with every binding local: never against a real Cloudflare account, never against a deployed Podbay, and never sending real mail. The detail is in the [`podbay-security`](../../.claude/skills/podbay-security/SKILL.md) skill.
