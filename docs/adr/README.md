# Architecture decision records

Decisions are immutable once accepted. A later ADR supersedes an earlier one; the earlier file gets a "Superseded by" line and nothing else changes.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-founding-decisions.md) | Founding decisions | Accepted, 2026-11-17 |
| [0002](0002-project-home.md) | Project home is podbay.cloudhal.com | Superseded by 0003 |
| [0003](0003-project-home-on-cloudhal-dev.md) | Project home is podbay.cloudhal.dev; nothing runs under cloudhal.com | Accepted, 2026-11-17 |
| [0004](0004-mcp-keys-first.md) | MCP clients use keys first; OAuth follows | Accepted, 2026-11-17 |
| [0005](0005-client-stack.md) | The client stays a single-page app on one JSON API; TanStack Start and Exact are not adopted now | Accepted, 2026-11-17 |
| [0006](0006-guidance-for-engineers-and-agents.md) | How engineers and coding agents are guided | Accepted, 2026-11-17 |
| [0007](0007-places-and-labels.md) | A message is in one place and carries any number of labels | Accepted, 2026-11-17 |
| [0008](0008-rules-for-incoming-mail.md) | A mailbox has rules for its incoming mail: blocked senders, filters, an automatic reply | Accepted, 2026-11-17 |
| [0009](0009-emptying-trash-and-spam.md) | Trash and Spam can be emptied in one step | Accepted, 2026-11-17 |
| [0010](0010-snooze-and-mute.md) | A conversation can be snoozed, and a conversation can be muted | Accepted, 2026-11-17 |
| [0011](0011-drafts-keep-their-files.md) | A draft keeps its files | Accepted, 2026-11-17 |
| [0012](0012-a-persons-choices-and-known-addresses.md) | A person's choices are kept with their account, and a mailbox remembers the addresses it has written to | Accepted, 2026-11-17 |
| [0013](0013-the-mailbox-tells-the-open-app.md) | The mailbox tells the open app that something changed, and nothing more | Accepted, 2026-11-17 |
| [0014](0014-acting-on-many-conversations.md) | One request acts on many conversations, and a list has an order a person chooses | Accepted, 2026-11-17 |
| [0015](0015-the-original-message-is-kept.md) | The original message is kept | Accepted, 2026-11-17 |
| [0016](0016-outgoing-mail-waits-before-it-leaves.md) | Outgoing mail waits before it leaves | Accepted, 2026-11-17 |
| [0017](0017-the-repository-opens-before-the-name-is-reviewed.md) | The repository opens before the name is reviewed (amends 0001, decision 8, and 0003) | Accepted, 2026-11-18 |
| [0018](0018-one-workspace-one-worker-many-modules.md) | One workspace, one Worker, many modules: the shape that leaves room for a suite | Accepted, 2026-11-19 |
| [0019](0019-figures-in-the-administration-area.md) | Figures in the administration area: an instance's counts, a mailbox's own figures, and charts by echarts | Proposed, 2026-11-20 |
