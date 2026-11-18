# Podbay: roadmap

- Companion to the [architecture](architecture.md), the [feature scope](feature-scope.md) and the [status](status.md).
- Question answered here: where the project is going, what is done, and what comes next.

This is the one place that says what comes next. Decisions that set the direction are in [`adr/`](adr/README.md); what each rule is held by today is in [status](status.md). Update this file in the change that finishes or reorders work. Each piece of work that is left has an issue in the project's [issue tracker](https://github.com/cloudhal-dev/podbay/issues), filed under the milestone it belongs to; this file gives the order, the issues carry the detail. Last updated: 2026-11-18.

## 1. Where Podbay is going

Self-hosted mail for a person, a family or a small organisation, running entirely in their own Cloudflare account, safe for more than one person, and installable without help. The order is fixed by the [feature scope](feature-scope.md): first the core mail experience (phase A, version 0.1), then the complete mail product in slices (phase B). Nothing is ready for real mail until version 0.1 has had a full security audit.

## 2. Milestones

| # | Milestone | State | What is left |
|---|---|---|---|
| 1 | Repository bootstrap | Done, except the checks listed | The developer rules without a check yet (D2, D3, D9, D10, D13 in [status](status.md), section 2) |
| 2 | Accounts and roles | Built: sign-in with password, authenticator app and passkeys; invitations; recovery; fresh proof; memberships on every route, tool and key; member management; the audit log | A security review with a record; a recovery address outside Podbay; a rate limit on Podbay's own public routes; reading the audit log in the app |
| 3 | Standalone version 0.1 | Started: the content policies, attachments as downloads, browser tests, the original of a received message kept in R2 ([ADR-0015](adr/0015-the-original-message-is-kept.md)) | Queues; search; exports; the health endpoint for an installer; a signed release; every phase A row of the [feature matrix](feature-scope.md#3-feature-matrix); a full security audit record |
| 4 | Installer support | Not started | The installer contract of the [architecture](architecture.md#5-the-installer-contract) |
| 5 | Complete mail (phase B) | Not started | One slice at a time, each with its tests |

## 3. What comes next, in order

1. Finish milestone 2: the first full security audit, with its record ([`podbay-audit`](../.claude/skills/podbay-audit/SKILL.md)). Password change and sessions in the app were built on 2026-11-17.
2. Milestone 3, storage first: raw messages in R2 (built on 2026-11-17, [ADR-0015](adr/0015-the-original-message-is-kept.md)), inbound through a queue, opaque storage ids. These change persisted formats, so each starts with an ADR.
3. Search (full-text in the mailbox's own database), then exports and deletion that an owner can verify.
4. The release: one build, attested and signed, and the full audit that gates version 0.1.

Built on 2026-11-17, ahead of the storage work because it converted custom folders and that is cheapest before any installation exists: labels ([ADR-0007](adr/0007-places-and-labels.md)). The assistant got its two label tools, and the rail shows nested labels as a tree, on the same day.

Work is done in rounds. A round has one subject, ends with every check green and every document true, and is reported with what was not done ([`podbay-change`](../.claude/skills/podbay-change/SKILL.md)).

## 4. The mail experience: what is still missing

The bar is the mail people know from Gmail and Google Workspace ([feature scope](feature-scope.md)). The screens were compared with it on 2026-11-17, menu by menu and setting by setting. What Podbay has is in the [`podbay-ui`](../.claude/skills/podbay-ui/SKILL.md) skill, section 3. What it lacks, in the order it is taken up:

| # | Missing | Needs |
|---|---|---|
| 1 | ~~A menu on each message~~ **built 2026-11-17**: each message has its header, details, star, Reply and its own menu; the conversation prints, expands and collapses, and opens in a new tab. Left out because they need the server: block the sender, report phishing, download the message | Done in the app |
| 2 | ~~Settings like a mail client's~~ **built 2026-11-17**: tabs for general choices, signature, labels, the mailbox and the assistant. Fifteen choices of a person's own, among them conversation view, snippets, send and archive, notifications, since ADR-0014 the order of a list and, since ADR-0016, the undo window of a send. Since ADR-0012 was built, also on 2026-11-17, twelve of them are kept with the person's account and are the same in every browser they sign in to; density, the reading pane and notifications stay with the device, as the collapsed rail does. Not offered because nothing acts on them: forwarding, an automatic reply | Done in the app. A person's choices kept with their account: [ADR-0012](adr/0012-a-persons-choices-and-known-addresses.md), built on 2026-11-17. What it leaves open is in [status](status.md), section 3 |
| 3 | **Writing**: built on 2026-11-17: files attached to a message, recipients as chips, addresses completed from the mail the mailbox has sent (and, as a second source, from mail already loaded in the browser), an answer written under its conversation, a forward that carries the original's files, a draft saved by itself while it is written, and a formatting bar with size, colour, highlight, alignment, indent and remove formatting. Still missing: an address book (people with several addresses, groups, import and export), which is phase B, and a recipient's name beside the address | A draft that keeps its files was built on 2026-11-17 ([ADR-0011](adr/0011-drafts-keep-their-files.md)), and so were the addresses a mailbox has written to ([ADR-0012](adr/0012-a-persons-choices-and-known-addresses.md)). What they leave open is in [status](status.md), section 3 |
| 4 | **The list**: built on 2026-11-17: a menu on a line (right click), quoted text folded away, the middle of a long conversation folded, a conversation dragged onto a place or a label, the unread count in the tab. Since then, also on 2026-11-17: Trash and Spam are emptied in one step, a ticked page is one request, a whole page ticked offers everything in the place or the search, a move takes the whole conversation, every deed from a list has an Undo, and a list puts unread or starred conversations first when a person chooses that | Emptying Trash and Spam: [ADR-0009](adr/0009-emptying-trash-and-spam.md). Acting on many conversations and the order of a list: [ADR-0014](adr/0014-acting-on-many-conversations.md), built on 2026-11-17. What it leaves open is in [status](status.md), section 3 |
| 5 | **Mail that manages itself**: blocked senders, filters and an automatic reply while away are decided in [ADR-0008](adr/0008-rules-for-incoming-mail.md); snooze and mute in [ADR-0010](adr/0010-snooze-and-mute.md) | Accepted on 2026-11-17 and being built in turn |
| 6 | ~~Sending~~ **built 2026-11-18**: a message that is sent waits in the mailbox and leaves at its time. Send offers Undo for 5, 10 or 30 seconds, as the person chose, and the app says "sent" when the message has left; "Send later" takes a time up to a year ahead; what waits is in the place Scheduled, where it is given a new time, sent now or cancelled; a message the sending service refuses comes back to Drafts with the reason, and "not now" is tried again for a little over five hours. Sent means sent, and the caps count what left. Left: what cannot be known when the service gives no answer, a notice for a closed app, delivery events, a cap for the whole instance | [ADR-0016](adr/0016-outgoing-mail-waits-before-it-leaves.md), built on 2026-11-18 on ADR-0011, without a queue: the state is in the mailbox's database and the mailbox object's alarm lets mail leave. What it leaves open is in [status](status.md), section 3 |
| 7 | ~~The original message~~ **built 2026-11-17**: the bytes a message arrived as are kept; a received message's menu shows them as text ("Show original") and saves them as a file ("Download message"); a message the parser cannot read, or whose text is too large, is no longer lost: it is in the inbox with its original. Mail that arrived before has no original, and neither has sent mail. Left: what the platform recorded about SPF, DKIM and DMARC is kept but not shown until one check on a real domain is recorded | [ADR-0015](adr/0015-the-original-message-is-kept.md). What it leaves open is in [status](status.md), section 3 |
| 8 | **Live**: built on 2026-11-17. The mailbox tells the open app that something changed, over one connection for each tab that carries four counters and no mail: new mail, a move, a label and read state appear in every open tab and for every member within about a second, a notification of the device is raised when mail arrives, and the unread count in the tab follows. Where there is no connection the app asks every half minute as before. Still missing: notifications while the app is closed | [ADR-0013](adr/0013-the-mailbox-tells-the-open-app.md), built on 2026-11-17. What it leaves open is in [status](status.md), section 3. Notifications while the app is closed need a push service outside the account and their own record |
| 9 | ~~Languages~~ **built 2026-11-17**: Turkish beside English on every screen, chosen in the settings or taken from the device; every word is a message and a check holds the catalog to the code (rule D8). Left: the Worker's own words (refusals, the assistant) stay English, and the Turkish has not been read by a second person | Done in the app |
| 10 | Importance markers, categories as tabs, translation, reactions, tasks and calendar | Not planned; decided again after phase A |

Known defects that stand in the way are in [status](status.md), section 3: conversations formed before the fix of 2026-11-17 are not regrouped.

## 5. What is decided about the client

The app is a single-page React app on TanStack Router, served as static assets, talking to one JSON API ([ADR-0005](adr/0005-client-stack.md)). Two alternatives, TanStack Start and Exact, were looked at on 2026-11-17 and are not adopted now; the ADR records why and the triggers that make the project look again. Exact is the first candidate when a native client is decided on. The triggers are read again at the end of each milestone, and the result is written here.

## 6. How the direction changes

By an ADR, proposed by whoever needs the change and accepted by the project lead. A milestone is not reordered, a phase B feature is not pulled forward and a non-goal of the [architecture](architecture.md#2-non-goals) is not taken up without one.
