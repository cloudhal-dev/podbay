# ADR-0001: Founding decisions

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead
- Details: [architecture](../architecture.md), [feature scope](../feature-scope.md), [sign-in and access](../auth-and-access.md), [engineering rules](../engineering-rules.md)

## Context

Podbay starts from Cloudflare's `agentic-inbox` reference app (Apache-2.0, commit `48039bb6785af34e592c2966f87cde2b255c4c80`). The seed is a working inbox with an agent and an MCP server, and no accounts, tests or releases. The decisions below turn it into a product.

## Decisions

| # | Decision |
|---|---|
| 1 | **UI library.** `@cloudflare/kumo` directly, at its latest version. |
| 2 | **Versions.** Latest stable everywhere, pinned exactly and updated automatically. The app becomes a TanStack Router single-page app served as static assets, with a Hono API. |
| 3 | **Data.** A central index in D1; mail content in one Durable Object per mailbox; raw messages and attachments in R2. |
| 4 | **Identity.** Podbay's own accounts through Better Auth on D1, with Podbay's own authorisation on top. Cloudflare Access is an optional outer layer. |
| 5 | **Agent and MCP.** Kept in v0.1, off by default. They never send without a person's confirmation. |
| 6 | **Scope.** Mail first. Calendar, booking and files (phase C) are decided after phase B; nothing in phases A and B may block them. |
| 7 | **Plan requirement.** Workers Paid is the stated requirement. A receive-only mode works on Workers Free. |
| 8 | **Repository.** Apache-2.0, in the open, with the governance files of the Cloudhal project. It becomes public after the name's domain and trademark check. |
| 9 | **Platform.** Cloudflare only: no third-party mail provider, no other database or object store, no container image. |
| 10 | **Mail apps.** JMAP in phase B. |
| 11 | **Original work.** Nothing is taken from any other mail product, and no other product is named in the repository. The experience bar is the mail people know from Gmail and Google Workspace. The only copied source is the seed, listed in `copies.json`. |
| 12 | **Engineering rules.** The [engineering rules](../engineering-rules.md) are the hard rules of the repository. A rule without an automated check is not a rule. |
| 13 | **Managing is not reading.** An owner or administrator needs an audited membership to open a mailbox. |
| 14 | **Accounts by invitation only.** No open registration. |
| 15 | **Strong sign-in from v0.1.** Passkeys and an authenticator app are in the first release. |
| 16 | **Single sign-on** and Access-as-identity come in phase B. |

## Consequences

- **Positive.** One platform and one toolchain keep the surface small. The access model makes shared mailboxes and the privacy promise possible. The rules are enforceable from the first commit.
- **Negative.** The seed's agent stack is several major versions behind, so bootstrap includes real rewrites. Latest versions break more often than aligned ones.
- **Risks.** Email Sending is documented as beta. A mail product is a large scope for a small team; the phases bound it.
