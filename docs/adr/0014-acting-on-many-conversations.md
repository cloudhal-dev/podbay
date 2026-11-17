# ADR-0014: One request acts on many conversations, and a list has an order a person chooses

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each finding was read in the standard's or the platform's own text on that day and is retold here in Podbay's words; names in `code` are the source's own.

## Context

The toolbar of a list acts on the lines that are ticked on one page, at most a hundred. Each deed (a move, a mark, a label) is then one request for each line: a hundred ticked lines are a hundred requests, and the page must stay open until the last one. There is no way to say "all 3,200 conversations in this place" or "everything this search finds". In the mail people know from Gmail and Google Workspace, ticking a page offers to select every conversation of the place or of the search, and what is then done to them is one deed.

Two smaller gaps belong to the same screens. A move from the list moves one message, the newest of the line, and not the conversation ([status](../status.md), section 3: "a conversation is filed as one message"). And the order of a list is fixed: newest first, with no way to put unread or starred conversations on top.

The [roadmap](../roadmap.md) (section 4, row 4) says acting on a whole place needs its own record. [ADR-0009](0009-emptying-trash-and-spam.md) leaves it out by name. [ADR-0007](0007-places-and-labels.md) set 50 conversations for one labelling request, a number that bounds nothing today because the route labels one conversation.

It is a decision because it adds routes other programs can call, a persisted format in the mailbox's database, and a change to what a deed on a line means.

What the answer has to respect, whatever it is:

1. **Deny by default in one table** (S1). Every new route has its right, and a person without a membership is told nothing.
2. **Nothing is deleted that the person did not ask to delete** (S13). Deleting for good stays where it is: one message after a question, and emptying a place by ADR-0009.
3. **The mailbox's limits are the limits.** One Durable Object per mailbox, with a bound on parameters, on statement length and on CPU time for each call.
4. **Agents and MCP hold less, not more** (S9). A hostile message can already talk a client into moving mail ([status](../status.md), section 3). A deed on thousands must not become its tool.
5. **JMAP in phase B** (ADR-0001, decision 10). What is built now should read as JMAP later without a second remodelling.
6. **A person must know how much they are about to change** before it changes.

Two things in what exists were found while reading for this record, and both bear on it:

- The route that moves one message (`POST …/emails/:id/move`) takes any place as its target, Sent and Drafts included. The MCP and assistant tools refuse those two; the route does not, and the app's Undo relies on it to put a sent message back.
- The list of a place and the count beside it do not group alike. A message without a thread id and with an empty subject is joined to others like it in the list and counted by itself in the total. New mail always has a thread id, so this touches only mail stored by the earliest schema; but a count a person is shown before a deed has to be the count of what the deed takes.

## Findings

### What exists (the repository)

- **Lists.** A place is listed by conversation: a line is the newest message of a conversation in that place, with counts for the whole conversation. A search, and so the Starred list and a label's list, is listed by message. A page holds at most 100 lines; a person chooses 10, 25, 50 or 100. Both are newest first, written into the query. The list without conversations takes `sortColumn` and `sortDirection` (seven columns); nothing in the app or the tools sends them.
- **Deeds.** Moving, marking read and starring each act on one message by its id. `POST …/threads/:threadId/read` marks a conversation read. Labelling acts on the conversation of the message it names, outside Spam and Trash (ADR-0007, decision 4).
- **Undo** is the app's own memory: it keeps where each ticked line's message was and moves it back, for about eight seconds. It covers moves only.
- **Tools.** The assistant and MCP move, mark and label one message or one conversation for each call.
- **The audit log** in D1 records administrative deeds (members, keys, a mailbox made or deleted). No deed on mail is recorded there.
- **The time a message was stored** is its `date`: incoming mail gets the time it arrived, not the time its header claims.

### The standard Podbay will speak (JMAP, RFC 8620 and RFC 8621)

- **A change names its objects.** `/set` takes a map from an id to a patch (RFC 8620, section 5.3). `Email/set` is that method for mail: keywords for read and starred, `mailboxIds` for the place and the labels; moving to Trash is a change of `mailboxIds`, and destroying is deleting for good (RFC 8621, section 4.6).
- **There is no change by query.** A reference to an earlier result can hand the ids of a `/query` to a `/get` (RFC 8620, section 3.7); nothing in either RFC turns a filter into a `/set`. A JMAP client that wants "everything in this mailbox" asks for the ids and sends them back in pieces. What this record adds for the filter is therefore Podbay's own.
- **A server states how much it takes at once.** `maxObjectsInSet` and `maxObjectsInGet` are capabilities, each with 500 as the least the RFC suggests; a call above the limit is answered `requestTooLarge` (RFC 8620, sections 2, 5.1 and 5.3).
- **A change may succeed in part.** Each object is changed whole or not at all, and the server may change some objects and refuse others; a refused one is listed with its reason and the call goes on (section 5.3).
- **Nothing holds the data still between calls.** Calls of different requests may be interleaved (section 3.10). The guard JMAP offers is `ifInState`, a state the caller last saw.
- **A list has a filter, an order and a window.** `Email/query` filters by `inMailbox`, `hasKeyword`, `text`, `from`, `to`, `subject`, `before`, `after`, `hasAttachment` and more; `collapseThreads` lists one message for each thread; a total is given only when asked for, because it can be dear (RFC 8620, section 5.5; RFC 8621, section 4.4).
- **Unread first and starred first are in the standard.** A server must sort by `receivedAt` and should sort by `hasKeyword`, `allInThreadHaveKeyword` and `someInThreadHaveKeyword`; the RFC's own example puts flagged threads first. A server lists what it sorts by in `emailQuerySortOptions` (RFC 8621, sections 1.3.1 and 4.4.2).

### The platform

Read in Cloudflare's documentation on 2026-11-17. "In the ledger" means the [ledger](../cloudflare/ledger.json) already holds the fact with its quote.

| Fact | Value | In the ledger |
|---|---|---|
| Bound parameters in one query | 100 | Yes |
| Length of one SQL statement | 100 KB | Named in the same entry, without its own quote |
| Bytes in a `LIKE` pattern | 50 | Yes |
| CPU time for one request to a Durable Object | 30 seconds by default, can be set up to 5 minutes | No |
| CPU time for one HTTP request to a Worker | 10 ms on Workers Free; on Workers Paid 30 seconds by default, up to 5 minutes | No |
| A Durable Object runs one thing at a time | Each object is single-threaded | No |
| `transactionSync` | The statements in it are one transaction, undone if the callback throws | Yes |
| One alarm for each object | Proposed for snooze by [ADR-0010](0010-snooze-and-mute.md) | Yes |

The two CPU figures come from two pages. The Durable Objects page does not split its 30 seconds by plan; the Workers page gives 10 ms on the Free plan. This record builds for small steps and does not rely on either figure being generous.

## Options

For the deed on many:

| | Option | For | Against |
|---|---|---|---|
| A | **The app loops**, as today | Nothing to build | A request for each line. No "everything". It stops when the tab closes and does not say where |
| B | **A list of ids only.** For "everything" the app reads every page and sends the ids | The smallest route. It is what JMAP has | For 3,200 conversations: thirty-two lists and thirty-two deeds, from the page. The list shifts while the deed empties it, so pages skip lines. The server never knows the person meant "all" and cannot bound or record it as one deed |
| C | **A filter only** | One shape | A page with two lines unticked cannot be said |
| D | **Both, in one route**: ids for what is ticked; a filter, resolved by the mailbox and walked in bounded steps, for "everything" | One right and one rule for which messages a deed takes. The mailbox counts, bounds and records the deed | More contract. The filter half has no JMAP counterpart |
| E | **A job the mailbox runs by its alarm** until it is done | It finishes with the tab closed | A job table and its states. It shares the one alarm ADR-0010 proposes. A deed nobody is watching cannot be stopped by leaving the page, and nothing in Podbay runs unattended yet |

For taking it back:

| | Option | For | Against |
|---|---|---|---|
| F | **The app remembers**, as today | Nothing stored | It cannot remember thousands, forgets on reload, and once a deed takes a whole line it no longer knows which messages moved |
| G | **No undo above one page**, and the app says so first | Nothing stored | The largest deeds are the ones a person most needs to take back |
| H | **The mailbox keeps a short record** of what each deed changed | Exact for any size. Undo no longer needs a request that moves mail into Sent. It can cover marks and labels | A persisted format. A row for each changed message while the record lives |

## Decision

Options D and H.

**What a deed is and what it takes**

1. **One route acts on many**: `POST …/bulk`. Its request has a scope and a change. The scope is either up to 100 message ids (the ticked lines) or a filter ("everything in this place", "everything with this label", "everything this search finds").
2. **The change is a closed set**: move to Inbox, Archive, Spam or Trash; read or unread; star or no star; give or take labels. Several may go together, so "Move to" a label (ADR-0007, decision 9) is one deed. Nothing else is taken.
3. **It never deletes for good and never sends.** Deleting for good stays one message after a question, and a whole place by ADR-0009. Sent and Drafts are never a target. Sending is never a batch.
4. **A line is a conversation in a place.** A conversation is what labelling already takes it to be: the messages that share a thread id. A message that is named, or that a filter finds, stands for its line: the messages of its conversation that are in the same place as it.
5. **A move takes the whole line.** Every message of the line goes to the new place. This closes "filed as one message": archiving a line empties the inbox of that conversation. Messages of the conversation in other places stay; a sent answer stays in Sent. A line in Sent can go only to Trash. A line in Drafts is not moved by this route.
6. **A mark is the conversation's.** Read, taking a star and labels act on every message of the conversation outside Spam and Trash, as ADR-0007 decided for labels. Unread and a star are given to one message, the newest of the line, as a line does today; otherwise a starred conversation would fill the Starred list with every message of it. A line in Spam or Trash is marked by itself and takes no label.
7. **A filter is the search route's filter**, built by the same code, so "everything this search finds" cannot differ from what the search lists. It must name something: an empty filter is refused, so there is no deed on a whole mailbox. A filter that names no place leaves out what is in Spam and Trash. A label that is asked for and is not one finds nothing.
8. **The routes for one message stay.** A message's own menu still acts on that message. A line in a list, even one line, goes through the new route, so a line always means the same. With conversation view off a line is one message: the request then says so (`unit` is `message`), and a move or a mark takes the named or found message alone. Labels stay the conversation's, as ADR-0007 has them.

**Asking first**

9. **No single request changes what a filter finds.** A request with a filter changes nothing: the mailbox counts, keeps the filter, the change and the time of asking, and answers with the number of conversations and messages and an id for the deed. The app shows that number in its own dialog and asks. Acting is a second call that names the deed, so what was counted is what is acted on.
10. **A deed takes only mail that was there when it was asked.** Mail stored after that time is never changed by it, in any step. The first step counts again and refuses if the scope now holds more conversations than the person was shown. A deed that is not started within ten minutes of asking is refused; the app asks again.
11. **A request with ids acts at once**, as a ticked page does today. The person sees every line they ticked.

**Bounds and steps**

12. **Limits, chosen and to be revised from use:** 100 message ids in one request, the largest page; 500 found messages read in one step of a filter deed, the number JMAP suggests as the least for one `/set`; 10 labels in one change; 200 characters in each text of a filter. This record changes one number that ADR-0007, decision 11, left open to revision: conversations in one request, from 50 to 100, so that a full page is one request.
13. **A step is one call and one transaction**: `POST …/bulk/:deedId/run`. It reads the next 500 found messages, acts on their lines, moves the deed's position, and writes all of it or none. The mailbox keeps the position, not the caller. Statements name at most 90 conversations each, under the 100 bound parameters, and stay far below the statement length. Conversations are named by thread id, which has an index.
14. **The answer says what was done and whether more remains**: the conversations and messages changed in this step, how many lines were left out and why (not found, a place it cannot go to, a label too many), and `more`. The app calls again while `more` is true and shows how far it is. Leaving the page stops the deed where it is; what was done stays done and can be taken back.
15. **Repeating is safe.** Every change sets a state: this place, read, this label. A step that is sent twice continues from the kept position and does nothing twice. A request with ids that is sent twice finds everything as asked the second time and changes nothing.
16. **While a long deed runs, the mailbox is not held.** Each step sees the mailbox as it is then. Mail that arrived is left alone (decision 10). A message someone moved out of the scope is not touched; one moved into it behind the deed's position is missed. The answer is the truth about what was changed, not a promise about what matched at the start. JMAP makes the same choice between calls.
17. **What a step costs is measured, not assumed.** A budget test (rule D13) runs one step on the largest mailbox the tests build. A search by text reads every message it has not passed yet, as the search route does for every page today; the full-text index of milestone 3 changes both.

**Taking it back**

18. **The mailbox keeps a record of each deed for one hour**: for every message it changed, the place and the marks it had and the labels it gained or lost. It holds no content. The filter of a deed is kept with it and goes with it. The record is removed when the next deed begins after the hour, with the mailbox, and row by row with any message that is deleted for good (S13).
19. **Undo is a call**: `POST …/bulk/:deedId/undo`, in steps like the deed. It puts back each message that is still as the deed left it. A message that was moved, read or labelled again since then is left alone. Undo restores a sent message to Sent from the record, so no request ever names Sent as a target.
20. **There is no size above which a deed cannot be taken back** within the hour. The app offers Undo on the note of every deed, as it does for moves today, and after a filter deed when the last step is done.

**Rights and what stands against misuse**

21. **`mailbox.write`** for all three calls, as moving and labelling need today. No fresh proof: nothing leaves the mailbox, nothing is deleted for good, and all of it can be taken back. A reader is refused; a person without a membership is told the mailbox does not exist. An id or a label of another mailbox does not exist here, because the guard has already picked the mailbox.
22. **No tool gets the batch.** The assistant and MCP keep one message or one conversation for each call. If they are given more later, it is by ids only, at most 25 for each call, never a filter, and not before calls are limited and recorded for each key ([status](../status.md), section 3). Their tool lists do not change.
23. **A filter deed is recorded in the audit log**, once when it starts and once if it is undone: who, which mailbox, which change, how many. Never the words of the search. A deed on a ticked page is not recorded, as one move is not today. Logs carry the deed's id and counts only (S7).
24. **Each of these is a test** before any screen is built: a reader, a non-member, ids and labels of another mailbox, a request over each limit, a filter deed run without asking or too late or after the scope grew, Spam and Trash left alone, Sent and Drafts refused as targets, mail that arrived during a deed, undo that does not undo a later change, and a deleted message that leaves no row in the record.

**The order of a list**

25. **A list takes `order`**: `newest` (as now, and the default), `unread` or `starred`. It is a parameter of `GET …/emails` and `GET …/search`. Unread first puts conversations with an unread message on top, starred first those with a starred message; inside each group the order is newest first. The choice is a person's own and is kept where their page size is kept: in the browser today, with their account if [ADR-0012](0012-a-persons-choices-and-known-addresses.md) is accepted. The Worker acts on the parameter of the request and never on a stored choice.
26. **`sortColumn` and `sortDirection` are removed.** Nothing sends them, five of the seven columns have no index, and one column cannot say "unread first, then newest".
27. **What it costs.** The query of a place already reads every message of the mailbox for each page and already counts the unread messages of each conversation; starred first adds one sum. A search sorts what it found either way. No new index is needed today. If the list of a place is later rewritten to read one page from the index on place and date, the two other orders will need indexes of their own. Pages are counted from the top, so a line that is read on page one can move to page two; the app loads the list again after a deed, as it does now.
28. **A deed does not depend on the order.** A filter deed walks the mailbox in its own fixed order.

**Names and how it reads later**

29. **Sticky names, fixed by this record:** the routes `POST …/bulk`, `POST …/bulk/:deedId/run` and `POST …/bulk/:deedId/undo`; the tables `deeds` and `deed_changes` in the mailbox's database; the audit actions `mailbox.bulk` and `mailbox.bulk_undone`; the query parameter `order` with its three values.
30. **The request of `POST …/bulk`**, checked by a schema the Worker and the app share (D2): `ids` (1 to 100 strings of at most 128 characters) or `filter` (the search route's fields: `folder`, `label`, `query`, `from`, `to`, `subject`, `date_start`, `date_end`, `is_read`, `is_starred`, `has_attachment`), never both; `unit`, `conversation` unless it says `message`; and `change` with at least one of `move` (`inbox`, `archive`, `spam`, `trash`), `read`, `starred`, `labels` (`add` and `remove`, 10 ids together).
31. **The answers.** For ids, and for each step: `deed`, `conversations`, `messages`, `skipped`, `more`. For a filter that was only counted: `deed`, `conversations`, `messages`, and nothing changed. For undo: `messages`, `more`. A refused request changes nothing and says why in the `code` of its error, as the label routes do.
32. **How it will read over JMAP** (phase B, not built here): a request with ids is `Email/set` with a patch of keywords and `mailboxIds`; Podbay's limit of 100 lines becomes the server's `maxObjectsInSet`, which that record sets in messages. The filter deed has no JMAP form and stays Podbay's own route. `order` is the `sort` of `Email/query`: `receivedAt`, and `someInThreadHaveKeyword` or `allInThreadHaveKeyword` with `$flagged` or `$seen`, listed in `emailQuerySortOptions`; a place's list is `collapseThreads`.

## What is not decided here

- Deleting a ticked page for good in one request. It deletes objects in R2 and belongs with the work of ADR-0009.
- Emptying a label, and deleting everything a search finds for good.
- Snoozing or muting many conversations (ADR-0010). A snooze takes a time, and that record is not accepted.
- A deed that finishes with the page closed (option E).
- Applying a rule to mail that is already stored (ADR-0008 leaves it out). It would be a filter deed.
- A guard like JMAP's `ifInState`, and what Podbay's `maxObjectsInSet` will be.
- Other orders: by sender, by subject, by size, oldest first.
- Where a person's choice of order is kept. That is the subject of ADR-0012.
- The words of the dialog and of the line that offers "select all". They are design, settled with the screens.
- Repairing the count of a place for old mail without a thread id (see Context).

## Consequences

- The toolbar of a list sends one request for a ticked page. After ticking a whole page, a line above the list offers every conversation of the place or the search; choosing a deed then asks with the mailbox's own count.
- "A conversation is filed as one message" and "the limit of 50 bounds nothing" leave the known gaps in [status](../status.md) when this is built, and not before. Undo then also covers read, star and labels from a list.
- The mailbox's database gets two tables by a numbered migration, tested from the previous release (D3). They hold ids, places and marks for an hour.
- The move route for one message keeps taking Sent and Drafts as a target until the app's Undo no longer needs it. Closing that is a change of its own, with its test.
- `date` must go on meaning the time a message was stored. An import (phase B) that keeps a message's own date needs a column for the time of storing first.
- The work comes in the usual order: the mailbox object's methods and their tests in the Workers runtime; the routes with their rights; the app; the browser tests; the documents. Nothing is built before acceptance.
- If ADR-0009 is accepted too, its answer and this one continue in the same way: a count and whether more remains.
- If [ADR-0013](0013-the-mailbox-tells-the-open-app.md) is accepted too, each step is a write like any other and raises its signal once; a long deed shows in other tabs as it goes.

## Triggers

Look again when one of these is true:

- People leave the page during a long deed and find a place half done.
- A step comes near its CPU budget on a real mailbox.
- A deed or an Undo is found to have changed mail the person did not mean.
- The record of deeds is asked for as a history, or an hour is too short or too long.
- Calls of the assistant and MCP are limited and recorded for each key: decision 22 can be read again.
- The JMAP record sets `maxObjectsInSet`, or finds a mail app that needs a change by query.

## Sources

- RFC 8620, "The JSON Meta Application Protocol (JMAP)", sections 2, 3.7, 3.10, 5.1, 5.3 and 5.5: `https://www.rfc-editor.org/rfc/rfc8620.txt`, read 2026-11-17.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", sections 1.3.1, 4.4, 4.4.1, 4.4.2, 4.4.3 and 4.6: `https://www.rfc-editor.org/rfc/rfc8621.txt`, read 2026-11-17.
- Cloudflare, Durable Objects limits (page dated 2026-11-13): `https://developers.cloudflare.com/durable-objects/platform/limits/`, read 2026-11-17. Parameters, statement length, `LIKE` pattern, CPU time for a request, one thread for each object.
- Cloudflare, Workers limits (page dated 2026-11-13): `https://developers.cloudflare.com/workers/platform/limits/`, read 2026-11-17. CPU time for an HTTP request on each plan.
- Cloudflare, Durable Objects SQLite storage API (page dated 2026-09-21): `https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/`, read 2026-11-17. `transactionSync`.
- The repository: `app/hooks/useConversationActions.ts` (the loops and `offerUndo`), `workers/index.ts` (the list, search and move routes), `workers/lib/list-options.ts`, `workers/durableObject/index.ts` (`getThreadedEmails`, `countThreadedEmails`, `searchEmails`, `moveEmail`), `workers/durableObject/labels.ts` (`labelConversation`), `workers/auth/route-table.ts`, `workers/lib/tools.ts`, `shared/mcp-tools.ts`, `workers/auth/store.ts` (the audit log).
