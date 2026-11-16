# Security Policy

Podbay stores and shows other people's mail. A way to read a mailbox without a membership, to send as someone else, to run script from a message, or to leak a credential is a critical vulnerability for us, and we treat reports accordingly.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
https://github.com/cloudhal-dev/podbay/security/advisories/new

If you cannot use GitHub, email **security@cloudhal.com**.

Include: the affected version or commit, reproduction steps, impact, and whether the issue is already public.

## Our commitment

| Step | Target |
|---|---|
| Acknowledge receipt | within 2 working days |
| Initial assessment and severity | within 7 days |
| Fix or mitigation for Critical/High | within 30 days of confirmation |
| Credit | in the advisory and release notes, unless you prefer anonymity |

We follow coordinated disclosure: we ask that you give us the chance to fix before publishing details, and we will not take legal action against good-faith research that respects this policy and avoids privacy violations, data destruction and service disruption.

## Supported versions

Before 1.0, only the latest release receives security fixes.

## Scope

In scope: sign-in and sessions, per-mailbox authorisation, rendering of mail HTML and attachments, the sender check, the agent and MCP tools, the setup and operator tokens, exports, and the release pipeline. Prompt-injection findings are in scope when mail content makes the agent or an MCP tool do something the user did not confirm.

The trust boundaries and the rules that guard them are in [docs/engineering-rules.md](docs/engineering-rules.md).
