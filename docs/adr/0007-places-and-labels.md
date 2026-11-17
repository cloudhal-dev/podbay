# ADR-0007: A message is in one place and carries any number of labels

- Status: **Proposed** (awaits the project lead)
- Date: 2026-11-17
- Sources: read on 2026-11-17 and listed at the end. Each quoted finding was read in the standard's or the vendor's own text on that day.

## Context

Podbay files mail the way the seed did: every message is in exactly one folder (`emails.folder_id`). Six folders are built in (Inbox, Sent, Drafts, Archive, Spam, Trash) and a person can add their own. Read and starred are flags on the message. A message cannot be in two folders, so it cannot be filed under a project and a customer at once.

The experience bar is the mail people know from Gmail and Google Workspace ([ADR-0001](0001-founding-decisions.md), decision 11). There a conversation carries several labels, "Move to" files it out of the inbox, labels are listed in the rail and can be searched. The [feature matrix](../feature-scope.md#3-feature-matrix) has a row named "Folders and labels" that lists only custom folders; this record says what "labels" means in Podbay.

It is a decision because it changes a persisted format (the mailbox's database), adds routes and tools that other programs call, and changes one row of an accepted scope.

What the answer has to respect, whatever it is:

1. **JMAP in phase B** (ADR-0001, decision 10). Mail apps will read this model through RFC 8621, so the model must map onto it without a second remodelling.
2. **Additive, numbered, literal migrations** for the mailbox's database, tested from the previous release (rule D3).
3. **Deletion deletes** (S13), and nothing is deleted that the person did not ask to delete.
4. **Deny by default in one table** (S1): every route and tool has its right, and a key never reaches further than its owner.
5. **Mail is filed in the user's own account only**: one Durable Object per mailbox, and its limits are the limits.

One defect in what exists was found while reading for this record. A custom folder can be deleted through the API (`DELETE …/folders/:id`, right `mailbox.write`), and the schema ties a message to its folder with `ON DELETE CASCADE`. Deleting a folder therefore either deletes its messages for good, without Trash and without a question, or leaves them pointing at a folder that is gone, depending on whether the database enforces foreign keys; the Durable Objects documentation does not say, and no test tries it. No control in the app calls the route today. Either outcome is wrong, and the decision below removes the case.

## Findings

### The standard Podbay will speak (JMAP, RFC 8621)

- A message may be in several mailboxes, and that is what a label is: "the server may allow it to belong to multiple mailboxes simultaneously (often exposed in a user agent as labels rather than folders)" (section 1).
- It must be in at least one: "an Email MUST belong to one or more Mailboxes. The Email id does not change if the Email changes Mailboxes" (section 2).
- A server states its own limit: `maxMailboxesPerEmail` is "The maximum number of Mailboxes … that can be can assigned to a single Email object … an integer >= 1, or null for no limit" (section 1.3.1). A server with one folder per message and a server with free labels are both conformant.
- A mailbox may have a role, and the roles are a public list: "The value MUST be one of the Mailbox attribute names listed in the IANA 'IMAP Mailbox Name Attributes' registry … converted to lowercase" (section 2). The registry has `inbox`, `sent`, `drafts`, `archive`, `junk`, `trash`, and also `flagged`, `important`, `all` and `scheduled`.
- Read, starred, draft and answered are keywords on the message (`$seen`, `$flagged`, `$draft`, `$answered`), not mailboxes (section 4.1.1).

### The behaviour people know

- Labels are on messages, and a conversation shows what its messages carry: "Labels only exist on messages", and the labels of a thread are "a list of labels that exist on any message within the thread".
- There are two kinds: "reserved SYSTEM labels and custom USER labels". Some system labels cannot be applied by hand (Sent and Drafts are applied by sending and by writing).
- "you can apply multiple labels to a single message or thread, and apply a single label to multiple messages or threads."

### The platform

A mailbox's database is SQLite in one Durable Object. Its limits on the day of reading ([ledger](../cloudflare/ledger.json)): 10 GB per object on the paid plan and 1 GB on the free one, 100 bound parameters per query, a statement of at most 100 KB, 50 bytes in a `LIKE` pattern. Labelling many conversations at once is therefore done in batches.

## Options

| | Option | For | Against |
|---|---|---|---|
| A | **Folders only**, as today | Nothing to build | A message is filed once. Not the experience the product is measured against |
| B | **Labels beside folders**: custom folders stay, labels are added | Purely additive | Two things a person makes that do nearly the same job, two sections in the rail, two buttons to explain. The folder-deletion defect stays and needs its own fix |
| C | **Places and labels**: the six built-in folders are the only places, a message is in exactly one of them, and everything a person makes is a label | One idea a person makes. The place stays a column, so every existing query, the Trash and Spam rules and the rights keep their shape. Maps onto JMAP directly | Custom folders are converted, once, by a migration. One row of the accepted scope changes |
| D | **Everything is a label**, Inbox and Trash included | The most general model | Every query that asks "where is this message" becomes a join, the conversation query above all. Trash and Spam must stay exclusive anyway, so the generality is not used. A large rewrite of tested code for no behaviour a person can see |

## Decision (proposed)

Option C.

1. **A message is in exactly one place**: Inbox, Sent, Drafts, Archive, Spam or Trash. The places are fixed; nobody adds or removes one. `emails.folder_id` goes on holding the place.
2. **A message carries any number of labels.** A label belongs to the mailbox. It has an opaque id that never changes, a name and a colour from a fixed palette. Names are unique in a mailbox without regard to case. A `/` in a name is shown as nesting and means nothing else.
3. **Custom folders become labels.** A numbered migration makes a label for each custom folder, gives it to the folder's messages and puts those messages in Archive. It is one-way and is tested from the previous release. After it, no custom folder can be made, and the route that deletes a folder is removed with the defect described above.
4. **Labels are on messages; people act on conversations.** Applying or removing a label on a conversation does it to every message of that conversation that is not in Spam or Trash. A line in a list shows every label its messages carry. A message that arrives later in a labelled conversation does not take the label by itself; rules that label incoming mail are phase B.
5. **Labels are the mailbox's, not a person's.** Everyone with access to a shared mailbox sees the same labels, as they see the same read and starred state today.
6. **No new right.** Seeing labels needs `mailbox.read`. Applying and removing them, and making, renaming and deleting a label, need `mailbox.write`, as folders do today. An MCP key that may change a mailbox may label in it; a key that may only read sees the labels and cannot change them. No tool deletes a label.
7. **Deleting a label deletes no mail.** The label is taken off its messages and the messages stay where they are. A message deleted for good takes its label rows with it (S13).
8. **Spam and Trash keep their meaning.** A message there keeps its labels, so restoring it restores them, but a label's list does not show it.
9. **"Move to" a label** gives the label and, from Inbox, moves the conversation to Archive, as one action with one Undo. **"Label as"** gives or takes a label and leaves the conversation where it is.
10. **Search** learns `label:<name>`. `in:` goes on meaning a place.
11. **Limits, chosen and to be revised from use:** 500 labels in a mailbox, 64 characters in a name, 50 labels on a message, 50 conversations in one labelling request.
12. **Sticky names, fixed by this record:** the tables `labels` and `email_labels` in the mailbox's database; the routes `GET` and `POST …/labels`, `PUT` and `DELETE …/labels/:labelId`, and `PUT …/emails/:emailId/labels`; the MCP tools `list_labels` and `label_email`.
13. **How it will read over JMAP** (phase B, not built here): each place is a Mailbox with its role (`inbox`, `sent`, `drafts`, `archive`, `junk`, `trash`); each label is a Mailbox without a role; an Email's `mailboxIds` are its place and its labels; starred is `$flagged` and read is `$seen`. The rule "exactly one place" is Podbay's own and is enforced when a mail app changes `mailboxIds`; how a change that breaks it is answered belongs to the JMAP record.

## What is not decided here

- Private labels that only one person of a shared mailbox sees.
- Rules that label, file or forward incoming mail (phase B).
- Snooze and scheduled send. Each is a time on a message, not a label.
- Importance markers and automatic categories.
- How labels travel in an import or an export (phase B).
- How deep nesting may go, and the palette's colours. Both are design, settled with the screens.

## Consequences

- The row "Folders and labels" of the feature matrix changes from "custom folders" to "labels" when this record is accepted, and not before.
- The rail's "Folders" section becomes "Labels". A label's list is a search for it, as Starred is today.
- The work comes in the usual order: the mailbox's database and its tests; the routes with their rights in the route table; the MCP and agent tools; the app; the browser tests; the documents. Nothing is built before acceptance.
- The conversation query reads labels in a second, small query per page instead of a wider join, so its tested shape stays.
- JMAP later is a mapping of this model, not a change to it.
- Today's instances are development instances; nothing is in production before version 0.1. Converting custom folders is cheapest now and dearer with every installation.

## Triggers

Look again when one of these is true:

- People who share a mailbox ask for labels the others do not see.
- The JMAP record finds a mail app that cannot work with "exactly one place".
- A mailbox reaches a limit of decision 11 in ordinary use.

## Sources

- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", sections 1, 1.3.1, 2 and 4.1.1: `rfc-editor.org/rfc/rfc8621.txt`.
- The IANA registry "IMAP Mailbox Name Attributes": `iana.org/assignments/imap-mailbox-name-attributes/`.
- Gmail API guide "Manage labels": `developers.google.com/workspace/gmail/api/guides/labels`.
- Cloudflare, Durable Objects limits (page dated 2026-11-13): `developers.cloudflare.com/durable-objects/platform/limits/`; the SQLite storage API page, which says nothing about foreign keys: `developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`.
- The repository: `workers/durableObject/migrations.ts` (the schema), `workers/durableObject/index.ts` (`deleteFolder`), `workers/auth/route-table.ts` (the folder routes).
