# Podbay: roadmap

- Companion to the [architecture](architecture.md), the [feature scope](feature-scope.md) and the [status](status.md).
- Question answered here: where the project is going, what is done, and what comes next.

This is the one place that says what comes next. Decisions that set the direction are in [`adr/`](adr/README.md); what each rule is held by today is in [status](status.md). Update this file in the change that finishes or reorders work. Last updated: 2026-11-17.

## 1. Where Podbay is going

Self-hosted mail for a person, a family or a small organisation, running entirely in their own Cloudflare account, safe for more than one person, and installable without help. The order is fixed by the [feature scope](feature-scope.md): first the core mail experience (phase A, version 0.1), then the complete mail product in slices (phase B). Nothing is ready for real mail until version 0.1 has had a full security audit.

## 2. Milestones

| # | Milestone | State | What is left |
|---|---|---|---|
| 1 | Repository bootstrap | Done, except the checks listed | The developer rules without a check yet (D2, D3, D9, D10, D13 in [status](status.md), section 2) |
| 2 | Accounts and roles | Built: sign-in with password, authenticator app and passkeys; invitations; recovery; fresh proof; memberships on every route, tool and key; member management; the audit log | Done in the app. A home on the server for a person's choices is proposed in [ADR-0012](adr/0012-a-persons-choices-and-known-addresses.md) |
| 3 | Standalone version 0.1 | Started: the content policies, attachments as downloads, browser tests | Proposed: a draft that keeps its files in [ADR-0011](adr/0011-drafts-keep-their-files.md), addresses a mailbox has written to in [ADR-0012](adr/0012-a-persons-choices-and-known-addresses.md). Waiting for the project lead |
| 4 | Installer support | Not started | Proposed: emptying Trash and Spam in [ADR-0009](adr/0009-emptying-trash-and-spam.md); acting on every conversation of a place or a search, a move that takes the whole conversation, and unread or starred first, in [ADR-0014](adr/0014-acting-on-many-conversations.md). Waiting for the project lead |
| 5 | Complete mail (phase B) | Not started | One slice at a time, each with its tests |

## 3. What comes next, in order

1. Finish milestone 2: the first full security audit, with its record ([`podbay-audit`](../.claude/skills/podbay-audit/SKILL.md)). Password change and sessions in the app were built on 2026-11-17.
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
| 3 | **Writing**: built on 2026-11-17: files attached to a message, recipients as chips, addresses completed from mail already loaded in the browser, an answer written under its conversation, a forward that carries the original's files, a draft saved by itself while it is written, and a formatting bar with size, colour, highlight, alignment, indent and remove formatting. Still missing: an address book that knows more than the loaded lists, and files kept in a draft | Drafts with files and an address book need the Worker: an ADR |
| 4 | **The list**: built on 2026-11-17: a menu on a line (right click), quoted text folded away, the middle of a long conversation folded, a conversation dragged onto a place or a label, the unread count in the tab. Still missing: empty Trash and empty Spam, select everything a search or a folder holds | Emptying Trash and Spam is proposed in [ADR-0009](adr/0009-emptying-trash-and-spam.md) and waits for the project lead; acting on a whole folder needs its own record |
| 5 | **Mail that manages itself**: blocked senders, filters and an automatic reply while away are proposed in [ADR-0008](adr/0008-rules-for-incoming-mail.md); snooze and mute in [ADR-0010](adr/0010-snooze-and-mute.md) | Waiting for the project lead; nothing of them is built |
| 6 | **Sending**: undo for a few seconds, send later | Proposed in [ADR-0016](adr/0016-outgoing-mail-waits-before-it-leaves.md): a message waits in the mailbox and leaves at its time, without a queue; it builds on ADR-0011. Waiting for the project lead |
| 7 | **The original message**: download it, show it whole | Proposed in [ADR-0015](adr/0015-the-original-message-is-kept.md): the bytes that arrived are kept, shown as text and downloaded as a file. Waiting for the project lead |
| 8 | **Live**: built on 2026-11-17 without a connection: the unread count in the tab, and a notification of the device for mail that arrives while the app is open, found by looking every half minute. Still missing: new mail the moment it arrives, and notifications while the app is closed | Proposed: a connection from the mailbox to the open app that says only that something changed, in [ADR-0013](adr/0013-the-mailbox-tells-the-open-app.md). Waiting for the project lead. Notifications while the app is closed need a push service outside the account and their own record |
| 9 | ~~Languages~~ **built 2026-11-17**: Turkish beside English on every screen, chosen in the settings or taken from the device; every word is a message and a check holds the catalog to the code (rule D8). Left: the Worker's own words (refusals, the assistant) stay English, and the Turkish has not been read by a second person | Done in the app |
| 10 | Importance markers, categories as tabs, translation, reactions, tasks and calendar | Not planned; decided again after phase A |

Known defects that stand in the way are in [status](status.md), section 3: conversations formed before the fix of 2026-11-17 are not regrouped.

## 5. What is decided about the client

The app is a single-page React app on TanStack Router, served as static assets, talking to one JSON API ([ADR-0005](adr/0005-client-stack.md)). Two alternatives, TanStack Start and Exact, were looked at on 2026-11-17 and are not adopted now; the ADR records why and the triggers that make the project look again. Exact is the first candidate when a native client is decided on. The triggers are read again at the end of each milestone, and the result is written here.

## 6. How the direction changes

By an ADR, proposed by whoever needs the change and accepted by the project lead. A milestone is not reordered, a phase B feature is not pulled forward and a non-goal of the [architecture](architecture.md#2-non-goals) is not taken up without one.
