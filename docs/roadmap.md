# Podbay: roadmap

- Companion to the [architecture](architecture.md), the [feature scope](feature-scope.md) and the [status](status.md).
- Question answered here: where the project is going, what is done, and what comes next.

This is the one place that says what comes next. Decisions that set the direction are in [`adr/`](adr/README.md); what each rule is held by today is in [status](status.md). Update this file in the change that finishes or reorders work. Last updated: 2026-11-17.

## 1. Where Podbay is going

Self-hosted mail for a person, a family or a small organisation, running entirely in their own Cloudflare account, safe for more than one person, and installable without help. The order is fixed by the [feature scope](feature-scope.md): first the core mail experience (phase A, version 0.1), then the complete mail product in slices (phase B). Nothing is ready for real mail until version 0.1 has had a full security audit.

## 2. Milestones

| # | Milestone | State | What is left |
|---|---|---|---|
| 1 | Repository bootstrap | Done, except the checks listed | The developer rules without a check yet (D2, D3, D8, D9, D10, D13 in [status](status.md), section 2) |
| 2 | Accounts and roles | Built: sign-in with password, authenticator app and passkeys; invitations; recovery; fresh proof; memberships on every route, tool and key; member management; the audit log | A security review with a record; changing a password and ending sessions in the app; a rate limit on Podbay's own public routes; reading the audit log in the app |
| 3 | Standalone version 0.1 | Started: the content policies, attachments as downloads, browser tests | Raw messages in R2 and queues; search; exports; the health endpoint for an installer; a signed release; every phase A row of the [feature matrix](feature-scope.md#3-feature-matrix); a full security audit record |
| 4 | Installer support | Not started | The installer contract of the [architecture](architecture.md#5-the-installer-contract) |
| 5 | Complete mail (phase B) | Not started | One slice at a time, each with its tests |

## 3. What comes next, in order

1. Finish milestone 2: the first full security audit, with its record ([`podbay-audit`](../.claude/skills/podbay-audit/SKILL.md)), and password change and sessions in the app.
2. Milestone 3, storage first: raw messages in R2, inbound through a queue, opaque storage ids. These change persisted formats, so each starts with an ADR.
3. Search (full-text in the mailbox's own database), then exports and deletion that an owner can verify.
4. The release: one build, attested and signed, and the full audit that gates version 0.1.

Built on 2026-11-17, ahead of the storage work because it converted custom folders and that is cheapest before any installation exists: labels ([ADR-0007](adr/0007-places-and-labels.md)). Left: label tools for the assistant, and nested labels shown as a tree.

Work is done in rounds. A round has one subject, ends with every check green and every document true, and is reported with what was not done ([`podbay-change`](../.claude/skills/podbay-change/SKILL.md)).

## 4. What is decided about the client

The app is a single-page React app on TanStack Router, served as static assets, talking to one JSON API ([ADR-0005](adr/0005-client-stack.md)). Two alternatives, TanStack Start and Exact, were looked at on 2026-11-17 and are not adopted now; the ADR records why and the triggers that make the project look again. Exact is the first candidate when a native client is decided on. The triggers are read again at the end of each milestone, and the result is written here.

## 5. How the direction changes

By an ADR, proposed by whoever needs the change and accepted by the project lead. A milestone is not reordered, a phase B feature is not pulled forward and a non-goal of the [architecture](architecture.md#2-non-goals) is not taken up without one.
