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

Built on 2026-11-17, ahead of the storage work because it converted custom folders and that is cheapest before any installation exists: labels ([ADR-0007](adr/0007-places-and-labels.md)). The assistant got its two label tools, and the rail shows nested labels as a tree, on the same day.

Work is done in rounds. A round has one subject, ends with every check green and every document true, and is reported with what was not done ([`podbay-change`](../.claude/skills/podbay-change/SKILL.md)).

## 4. The mail experience: what is still missing

The bar is the mail people know from Gmail and Google Workspace ([feature scope](feature-scope.md)). The screens were compared with it on 2026-11-17, menu by menu and setting by setting. What Podbay has is in the [`podbay-ui`](../.claude/skills/podbay-ui/SKILL.md) skill, section 3. What it lacks, in the order it is taken up:

| # | Missing | Needs |
|---|---|---|
| 1 | ~~A menu on each message~~ **built 2026-11-17**: each message has its header, details, star, Reply and its own menu; the conversation prints, expands and collapses, and opens in a new tab. Left out because they need the server: block the sender, report phishing, download the message | Done in the app |
| 2 | ~~Settings like a mail client's~~ **built 2026-11-17**: tabs for general choices, signature, labels, the mailbox and the assistant. Thirteen choices of a person's own, among them conversation view, snippets, send and archive and notifications. They stay in the browser; giving them a home on the server needs an ADR. Not offered because nothing acts on them: forwarding, an automatic reply | Done in the app |
| 3 | **Writing**: built on 2026-11-17: files attached to a message, recipients as chips, addresses completed from mail already loaded in the browser, an answer written under its conversation, a forward that carries the original's files. Still missing: an address book that knows more than the loaded lists, files kept in a draft, send and archive | Drafts with files and an address book need the Worker: an ADR |
| 4 | **The list**: built on 2026-11-17: a menu on a line (right click), quoted text folded away, the middle of a long conversation folded, a conversation dragged onto a place or a label, the unread count in the tab. Still missing: empty Trash and empty Spam, select everything a search or a folder holds | Emptying Trash and Spam is proposed in [ADR-0009](adr/0009-emptying-trash-and-spam.md) and waits for the project lead; acting on a whole folder needs its own record |
| 5 | **Mail that manages itself**: blocked senders, filters and an automatic reply while away are proposed in [ADR-0008](adr/0008-rules-for-incoming-mail.md). Snooze and mute are not proposed yet | Waiting for the project lead; nothing of it is built |
| 6 | **Sending**: undo for a few seconds, send later | A queue for outgoing mail: milestone 3 |
| 7 | **The original message**: download it, show it whole | Raw messages in R2: milestone 3 |
| 8 | **Live**: built on 2026-11-17 without a connection: the unread count in the tab, and a notification of the device for mail that arrives while the app is open, found by looking every half minute. Still missing: new mail the moment it arrives, and notifications while the app is closed | A connection from the mailbox to the page, and push: an ADR |
| 9 | **Languages**: Turkish beside English, with message keys everywhere | Its own round |
| 10 | Importance markers, categories as tabs, translation, reactions, tasks and calendar | Not planned; decided again after phase A |

Known defects that stand in the way are in [status](status.md), section 3: conversations formed before the fix of 2026-11-17 are not regrouped.

## 5. What is decided about the client

The app is a single-page React app on TanStack Router, served as static assets, talking to one JSON API ([ADR-0005](adr/0005-client-stack.md)). Two alternatives, TanStack Start and Exact, were looked at on 2026-11-17 and are not adopted now; the ADR records why and the triggers that make the project look again. Exact is the first candidate when a native client is decided on. The triggers are read again at the end of each milestone, and the result is written here.

## 6. How the direction changes

By an ADR, proposed by whoever needs the change and accepted by the project lead. A milestone is not reordered, a phase B feature is not pulled forward and a non-goal of the [architecture](architecture.md#2-non-goals) is not taken up without one.
