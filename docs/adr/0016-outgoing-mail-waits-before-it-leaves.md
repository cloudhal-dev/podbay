# ADR-0016: Outgoing mail waits before it leaves

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each finding was read in the standard's or the platform's own text on that day; a quote is a few words.

## Context

In the mail people know from Gmail and Google Workspace a person can take a message back for a few seconds after pressing Send, and can choose to send it later, at a time. Podbay sends at once. The three send routes store the message in Sent, answer the request, and hand the message to the sending service after the answer. So there is no undo and no "send later". A message the service refuses after the answer stands in Sent though it never left; nothing tries again, and nothing tells the person ([status](../status.md), section 3). The [roadmap](../roadmap.md) (section 4, row 6) lists both as missing.

It is a decision because it adds a persisted format to the mailbox's database, a place, routes and request fields other programs call, changes what the answer to a send means, and moves the one point where mail leaves (boundary B6). It also touches two accepted documents, and says so here and not in passing:

- The [architecture](../architecture.md) (section 4, "Outbound") says a send is "a row plus a queue message". This record proposes the row without the queue.
- The [feature matrix](../feature-scope.md#3-feature-matrix) has scheduled send, and the place Scheduled, in phase B. Undo is the same mechanism with a short time, so this record proposes both together. A phase B feature is not pulled forward without a record; whether this one does it is the lead's to say.

What the answer has to respect, whatever it is:

1. **One send path** (S8). A message leaves only if `From` belongs to the mailbox, and the caps allow it. One function, proven by a static check.
2. **The assistant and MCP never send** (S9). Choosing a time for a message is sending it.
3. **Deny by default in one table** (S1), and **deletion deletes** (S13): a deleted mailbox sends nothing afterwards.
4. **Every outside call has a fake** (D7). Tests and local development never send real mail.
5. **Bindings only, and names from the deployer** (S14, the installer contract). Every new binding is one more thing an installation must make.
6. **A mailbox is the unit** of isolation, export and deletion.
7. **JMAP in phase B** ([ADR-0001](0001-founding-decisions.md), decision 10). JMAP has an object for exactly this.
8. **The records beside this one.** [ADR-0007](0007-places-and-labels.md) fixed six places. [ADR-0010](0010-snooze-and-mute.md) proposes a seventh and wants the mailbox object's single alarm. [ADR-0011](0011-drafts-keep-their-files.md) proposes that a draft keeps its id and its files and becomes the sent message. [ADR-0013](0013-the-mailbox-tells-the-open-app.md) leaves the alarm free "for sending later".
9. **An honest screen.** The app does not say a message was sent before it was, and "Undo" is offered only while it can still work.

## Findings

### What the code does today

- **Three routes send**: `POST …/emails`, `…/emails/:id/reply` and `…/emails/:id/forward`, each with the right `mailbox.send`. Each checks the body against the sending limits (`SendEmailRequestSchema`), checks the sender (`validateSender`: `From` must be the mailbox's own address), asks the mailbox object for the caps (`checkSendRateLimit`), stores the files in the bucket and the message in Sent, answers `202 { id, status: "sent" }`, and only then calls the service inside `waitUntil`.
- **A failure after the answer is a log line** (`send.deferred_failed`) and nothing else. The platform gives work after an answer "up to 30 seconds"; what is still running then is cancelled. A slow handover of a large message can end that way, with the message in Sent.
- **The caps count rows in Sent**: 20 in the last hour, 100 in the last day. The check and the storing are two calls. A sent message that is moved out of Sent, or deleted for good, is no longer counted.
- **What `send()` answers is dropped.** The row keeps a `message_id` that Podbay made and never gave to the service, and the service sets its own.
- **A row in Sent keeps one body**, the HTML or the text. The service is given both, from the request.
- **The app** says "Message sent" when the `202` arrives, and then deletes the draft with a second request (`app/hooks/useComposeForm.ts`).
- **The tools** of the assistant and of MCP only save drafts. Their environment has a send binding that refuses (`withoutSend`).
- **The mailbox object** is called by RPC only. It has no alarm, and it uses no binding of the environment: not the bucket, not the index, not the send binding.
- **The route that moves one message** takes any place as its target and needs `mailbox.write`.

### The standards: a submission is an object with a time and a way back

- JMAP sends by making an `EmailSubmission`. It has `sendAt`, the time the submission "was/will be released for delivery", and `undoStatus`: `pending` ("may be possible to cancel"), `final` or `canceled`. A client takes a message back by setting `canceled`; when it is too late the answer is the error `cannotUnsend` (RFC 8621, sections 7 and 7.5).
- A server says how far ahead it holds mail: `maxDelayedSend`, in seconds, 0 for not at all. The time itself travels as the SMTP extension FUTURERELEASE, named in `submissionExtensions` and given as a parameter of the envelope's sender (RFC 8621, sections 1.3.2 and 7).
- FUTURERELEASE has two forms, an interval (`HOLDFOR`) and a time in UTC (`HOLDUNTIL`). A server that accepted one "MUST NOT release the message until" then. It announces the longest interval and the furthest date it takes. Its security section asks for a limit on what one person may have waiting: held mail "SHOULD be subject to a per-user quota" (RFC 4865, sections 3, 4.2 and 6).
- Destroying the message does not stop a submission: it "does not cancel a future send" (RFC 8621, section 7.5). The standard's own example sends a saved draft and moves it to the sent mailbox under the same id (section 7.5.1).
- Delivery is reported for each recipient as `queued`, `yes`, `no` or `unknown` (section 7).
- **Scheduled is a registered place.** RFC 9979 registers the mailbox name attribute `Scheduled` for messages "scheduled to be sent at a future time": the server keeps a message there until its time, then sends it and usually moves it to the sent mailbox, so that people can "review, edit, or cancel" from any app (sections 8.2 and 9.2.2). The IANA registry "IMAP Mailbox Name Attributes" holds it with that reference, in a record dated 2025-12-22. JMAP has no list of roles of its own: a role is a name from that registry in lowercase (RFC 8621, section 2), and the JMAP registries at IANA are capabilities, error codes and data types. So a mail app will look for the role `scheduled`.

### The platform

Read in Cloudflare's documentation on 2026-11-17. "In the ledger" means the [ledger](../cloudflare/ledger.json) already holds the fact with its quote; the others are entered with the build.

| Fact | What the page says | In the ledger |
|---|---|---|
| An object has one alarm | "a single alarm at a time". Many timed events are kept in storage and the alarm is set to the earliest | Yes |
| What an alarm promises | "guaranteed at-least-once execution". When the handler throws it is tried again, from a 2 second delay, "up to 6 retries". After those it does not run until it is set again | The first half; not the six retries |
| A handler can start over | After a failure of the object the handler "will run from the beginning" on another machine. Only one runs at a time for one object | No |
| How late an alarm can be | It runs "within a few milliseconds" of its time as a rule, and can be "delayed by up to a minute" during maintenance or failover. A time in the past runs "in the immediate future" | No |
| An object that was asleep | Its constructor runs before the alarm handler | No |
| An alarm can be lost | While an account's spending limit blocks its objects, alarms are held; one set "more than seven days ago is deleted" | No |
| How long a handler may run | 15 minutes by the clock; 30 seconds of CPU time unless configured higher | No |
| Deleting everything deletes the alarm | `deleteAll()` does, from compatibility date 2026-02-24 | No |
| A write is on disk before the world hears | Outgoing messages of an object are paused until its writes are confirmed; `sync()` resolves when they are | No |
| An object has the Worker's bindings | `env` "contains the environment bindings" | No |
| Work after an answer | `waitUntil` extends a request "up to 30 seconds" after the answer | No |
| A queue's longest delay | Messages "can be delayed by up to 24 hours" | No |
| A queue message's size | 128 KB | Yes |
| A queue delivers at least once | A message "may be delivered more than once" | No |
| A queue's retries | 3 by default, 100 at most; then the message is deleted or goes to a dead letter queue | No |
| A queued message cannot be taken back | The producer's interface is `send`, `sendBatch` and `metrics` | No |
| How long a queue keeps a message | Up to 14 days; 24 hours on the Workers Free plan | No |
| A Workflow | Sleeps up to 365 days; a payload of 1 MiB; a step is retried 5 times from 10 seconds by default and "might be retried multiple times", so its calls should be idempotent; an instance can be terminated | No |
| What `send()` answers | `{ messageId }`, a "Unique email ID". A failure is an error with a `code`; an argument of the wrong shape is a `TypeError` without one | Yes, without the `TypeError` |
| `send()` takes no idempotency key | Its message has recipients, sender, subject, bodies, reply address, attachments and headers. None of the pages read (Workers API, REST API, limits, headers) names such a key | No |
| `Message-ID` and `Date` are the service's | Both are "platform-controlled"; `Date` is set "at acceptance time". Putting either in `headers` fails the send. Headers that begin with `X-` are allowed | No |
| The service's refusals | 24 codes. Three read as "not now": `E_RATE_LIMIT_EXCEEDED`, `E_INTERNAL_SERVER_ERROR` ("temporarily unavailable") and `E_EMAIL_SENDING_NOT_READY` ("Retry the send later"). The page says "retry" of the third only | No |
| The account's own quota | A new account has "a conservative daily quota", for the account as a whole | No |
| What a message may carry | 25 MiB, 50 recipients, 32 files | Yes |
| Locally | The binding logs a message "but does not send" it | Yes |

## Options

Where a message waits between Send and leaving:

| | Option | For | Against |
|---|---|---|---|
| A | **In the browser**: the app waits a few seconds and then asks | Nothing changes in the Worker | It is not a send taken back but a send made late. A closed tab or a lost connection decides whether the message goes. It does nothing for "send later". The screen says one thing and the server knows another |
| B | **A queue with a delay** | It is what the architecture names. Retries and a dead letter queue come with it | A delay ends at 24 hours, so a later time is a chain of messages. A queued message cannot be taken back, so the consumer must ask the mailbox whether the send still stands: the truth is in the mailbox's database either way. Delivery is at least once, so the same rule against sending twice is needed. One or two more names an installation must make, and a consumer, a new entry point, for nothing the alarm does not do |
| C | **A Workflow for each message** | It sleeps for up to a year and its steps are kept | A new class and a new binding. The state is in two places. Deleting a mailbox must find and end its instances. A step may run again, so the rule against sending twice is still needed |
| D | **A state of the message in the mailbox's database, woken by the mailbox object's alarm** | The truth is in one place, the unit that is exported and deleted. Taking a message back is a write in the same object that would send it, so the two cannot both win. No new binding. Deleting the mailbox deletes what waits and the alarm | The mailbox object calls the sending service, the bucket and the index, each for the first time. One alarm is shared with snooze. An alarm is retried six times and can be lost, so the object must repair it |

Where a waiting message is listed:

| | Option | For | Against |
|---|---|---|---|
| E | **In Sent, with a mark**, as today without the mark | No new place | Sent holds mail that has not left. That is the defect |
| F | **In Drafts, with a mark** | No new place | A draft is what a person, a tool or an MCP client may change. Every route and tool that changes a draft would need an exception, and one that is missed changes mail on its way out |
| G | **In a place of its own, Scheduled** | The registry's place and JMAP's role. The ordinary routes refuse by place, in one rule | One place more than ADR-0007 fixed, and one more than ADR-0010 proposes |

An attempt that got no answer:

| | Option | For | Against |
|---|---|---|---|
| H | **Try again** | A message is never lost | A message may arrive twice, and nobody is told |
| I | **Never by itself**: the person is asked | Nothing is sent twice by Podbay's own doing | A message that did arrive may stand as "not sent" until the person looks |

## Decision

Options D, G and I.

1. **Sending is two steps: the mailbox takes the message, and later lets it leave.** A send route no longer calls the sending service. It checks the request, stores the message, gives it a time and answers. The message leaves when its time has come, from the mailbox's own object, with nobody at the screen.
2. **A waiting message is in the place Scheduled**, id `scheduled`, as the registry has it. ADR-0007's "exactly one place" stands, with one place more: the seventh, or the eighth if ADR-0010 is accepted. A message enters and leaves Scheduled only by this record. The routes that move, delete, save or label, the emptying of [ADR-0009](0009-emptying-trash-and-spam.md), the deeds of [ADR-0014](0014-acting-on-many-conversations.md) and every tool refuse a message that is there (409, `code: "SCHEDULED"`) and refuse Scheduled as a target. Its rail entry sits under Drafts and lists what waits by its time, soonest first.
3. **A message on its way has a state**, kept in a table of its own, `submissions`, one row for a message:

   | State | Place | It means | It ends by |
   |---|---|---|---|
   | no row | any | Never handed over, or taken back | Send |
   | `waiting` | Scheduled | It leaves at its time, or at its next try | Being taken back; a new time; its time coming (`sending`); a check at leaving that refuses (`failed`) |
   | `sending` | Scheduled | It was handed to the service and the answer is not written yet | The answer: `sent`, `waiting` again, or `failed` |
   | `sent` | Sent | The service took it | Nothing |
   | `failed` | Drafts | It did not leave, and why | Send, discard, or dismissing the mark |

   A message is in Scheduled exactly when its state is `waiting` or `sending`. A test holds the two together.
4. **One function lets mail leave, and it is the only caller of the send binding** (S8). It runs in the mailbox object, for one message at a time. It reads the message from the stored rows and its files from the bucket; nothing of a request reaches it. An automatic reply ([ADR-0008](0008-rules-for-incoming-mail.md)), if that record is accepted, leaves through the same function.
5. **Leaving at most once: the handover is a compare-and-set.** The function changes `waiting` to `sending` in the mailbox's database and waits until that write is on disk before it calls the service. A row that is `sending` is never handed over again, by anything. An alarm that fires twice, or a handler that starts over, finds `sending` or `sent` and does nothing.
6. **The service's answer decides what comes next:**

   | Answer | The message |
   |---|---|
   | `{ messageId }` | Is `sent`: it moves to Sent with the time it left, and the id is kept |
   | `E_RATE_LIMIT_EXCEEDED`, `E_INTERNAL_SERVER_ERROR`, `E_EMAIL_SENDING_NOT_READY` | Is `waiting` again, for its next try (decision 8) |
   | Any other code, or a `TypeError` | Is `failed`, with the code |
   | No answer within 60 seconds, an error without a code, or a row found `sending` 15 minutes after its attempt began | Is `failed`, with the reason `unknown` |

   `E_DELIVERY_FAILED` is final as well. The page does not say whether another recipient of the same message was reached, and the note to the person says so.
7. **What cannot be known, said plainly.** If the service took a message and its answer was lost, Podbay cannot find out. The send call has no idempotency key to ask with, and the service gives every message it takes a `Message-ID` of its own, so a second handover would be a second message that no receiving system could match with the first. Between sending twice and asking the person, this record chooses to ask: the message comes back to Drafts and says it may have been sent. "Once" therefore means three things: never twice by Podbay's own doing; exactly once whenever the service answers; and one rare case where a person decides.
8. **Tries.** Only a refusal that reads "not now" is tried again, after 1 minute, 5 minutes, 15 minutes, 1 hour and 4 hours: six attempts in a little over five hours. Then the message is `failed` with the last code. That two of the three codes mean "not now" is this record's reading of their descriptions; the page says to retry of one.
9. **A final failure brings the message back.** It is in Drafts again, with its files, marked not sent, with the reason. Drafts shows in the rail how many messages are marked so. An open app says it at once. Opening the message shows the reason in the app's own words and offers to send again, to edit and to discard. Dismissing the mark is `unsend` on a failed message: it is a plain draft again. Nothing is written into the Inbox.
10. **Undo.** After Send the app shows "Undo" for a window the person chose: 5, 10 or 30 seconds, 10 when nothing is said. The request carries it as `undo_seconds`. There is no "off": a message a person sends always waits at least five seconds. The mailbox holds the message two seconds longer than the window, so that an Undo pressed at the last moment still arrives. Undo is `POST …/emails/:id/unsend`: the message is a draft again, in Drafts, with the same id and the same files, and the compose window opens on it. When the message is already `sending` or `sent` the answer is 409, `code: "SEND_STARTED"`, and the app says the message has gone.
11. **The window is honest.** Nothing is handed to the service before the time. What decides is the state and not the clock: an alarm that is late makes the window longer, never shorter, and an Undo that arrives while the message still waits works. The app does not say "sent" at the press. It says so when the mailbox does.
12. **Send later takes a time.** The request carries `send_at`, an instant in UTC. The app offers a few times of its own and a date and time, in the person's time zone, and shows the choice back before it is made; the mailbox keeps the instant. A time in the past is refused. A time nearer than the window is an ordinary send. The furthest time is 365 days ahead; one beyond it is refused (400, `code: "SEND_AT_TOO_FAR"`). A message sent later has no window on top: it can be taken back at any moment until its time.
13. **Seeing, changing and cancelling.** Scheduled lists what waits, each line with its time. A waiting message opens read-only and offers three deeds: send now and a new time (both `POST …/emails/:id/reschedule` with `{ send_at }`, absent for now), and cancel (`unsend`, back to Drafts). Editing is cancelling and opening the draft, in one press. Nothing else changes a waiting message: what leaves is what the person saw when they pressed Send.
14. **When it has gone.** The message moves to Sent and its date is the time it left. An open app is told by the signal of ADR-0013 if that record is accepted, and by its next look otherwise, and shows a note for a message this person sent. No mail is written about it.
15. **The rules hold at the time of leaving, not of pressing.** Before the handover the function asks again, in this order:

    | Question | When the answer is no |
    |---|---|
    | Is the mailbox still in the index? | Nothing leaves; the mailbox is going or gone |
    | Does the person who sent it still hold `mailbox.send` here, by `authorize`? Was their account recovered since they pressed Send? | `failed`, reason `right` |
    | Is `From` still an address of this mailbox (`validateSender`)? | `failed`, reason `sender` |
    | Does the message fit what the service takes (`shared/sending-limits.ts`)? | `failed`, reason `limits` |
    | Do the caps allow one more? | It stays `waiting` and leaves when they do, in the order of the times |

    A message that has not left 24 hours after its time does not leave: `failed`, reason `late`. That covers a cap that stays full and an alarm that was held for days. The same questions are asked once at the press, so that what can be refused at once is refused at once; a full cap refuses an ordinary send with 429, as today, and is not asked about for a later time.
16. **The caps count what left.** They stay 20 in an hour and 100 in a day. They are counted in a table of their own, `send_log`, with the time a message left, its kind (`person`, or `auto` for an automatic reply) and nothing of the message. Deleting or moving mail does not shorten it, and it holds nothing a deleted message leaves behind. The count and the handover are in the one object that sends, one message at a time, so two messages cannot take the last place. An attempt with the outcome `unknown` is counted.
17. **One alarm, the earliest of all times.** One function reads every time the mailbox waits for: the time and the next try of each `waiting` message, the fifteenth minute of a `sending` one, and each `snoozed_until` if ADR-0010 is accepted. It sets the alarm to the earliest. Every write that changes one of these times calls it, and so does the end of every alarm run. A run wakes snoozed mail first, which is local and safe to repeat, then lets mail leave, at most 10 messages in a run; each kind is guarded so that one cannot stop the other. If only one of the two records is accepted, the function has one kind.
18. **Asleep, late, twice, lost.** Asleep: everything is in rows, nothing in memory. Late: decision 11 and the 24 hours. Twice: decision 5. Lost: the handler catches its own errors and always sets the next alarm, because the platform tries a throwing handler only six times; and whenever the object wakes for any reason it sets the alarm again when something waits and none is set.
19. **Rights.** Send, send later, `unsend` and `reschedule` need `mailbox.send`. Seeing Scheduled needs `mailbox.read`. None needs fresh proof. In a shared mailbox a waiting message is the mailbox's: any member who may send can take it back or give it a new time, and whoever gives it a new time becomes the person whose right is asked at leaving.
20. **The assistant and MCP get nothing here.** No tool sends later, sends now, takes back or changes a time: scheduling is sending (S9). They read Scheduled as they read any place and can change nothing in it. Their environment gets a handle on the mailbox without the methods of this record, as it gets a send binding that refuses. The second is no longer enough by itself, because the working binding now sits in the mailbox object that every tool can reach.
21. **A deleted mailbox sends nothing.** Deleting it deletes the rows and the alarm, and the question before deleting says how many messages are waiting.
22. **What this record needs from ADR-0011**, and why it is built after it and not without it: a draft keeps its id and its files (its decisions 1 and 2); a send names its draft and the draft's row becomes the message (decision 8), here in two steps, to Scheduled at the press and to Sent when the service took it; one function deletes a message (decision 9). Without them Undo would give back a draft that lost its files. A send that names a draft cannot be made twice: the second request finds the message in Scheduled and is refused. A message sent without a draft gets its row at the press all the same, so it can come back as one; a program that sends that way and asks twice sends twice, as today.
23. **Limits, chosen and to be revised from use:** a window of 5, 10 or 30 seconds and 2 seconds of margin; 365 days ahead; 100 messages waiting in one mailbox (one more is refused with 409, `code: "TOO_MANY_WAITING"`); six attempts; 60 seconds for an answer; 15 minutes before a `sending` row counts as unanswered; 24 hours after its time; 10 messages in an alarm run.
24. **Sticky names, fixed by this record:** the place id `scheduled`. In the mailbox's database the table `submissions` with `email_id` (primary key), `state`, `send_at`, `retry_at`, `attempts`, `started_at`, `requested_at`, `requested_by`, `error`, `sent_at` and `service_id`, and the table `send_log` with `at` and `kind`. The states `waiting`, `sending`, `sent` and `failed`. The reasons in `error`: a code of the service as it is, or `right`, `sender`, `limits`, `late`, `unknown`. The routes `POST …/emails/:id/unsend` and `POST …/emails/:id/reschedule`. The fields `send_at` and `undo_seconds` of the three send requests. The answer `202 { id, status: "waiting", send_at }` in place of `status: "sent"`. The field `submission` (`state`, `send_at`, `error`) on a message that has one. The codes `SCHEDULED`, `SEND_STARTED`, `SEND_AT_TOO_FAR` and `TOO_MANY_WAITING`. The search operator `in:scheduled`.
25. **Migration.** One migration of the mailbox's database, with the next free number at build time (today's last is `11_message_id_index`; other proposed records may take numbers first). It adds the place, the two tables and an index on `state` and `send_at`, and fills `send_log` from what is in Sent from the last day, so that the caps do not start over. It rewrites nothing: mail already in Sent has no row in `submissions` and reads as sent. No D1 migration, no new binding and no change to the Worker's configuration.
26. **How it will read over JMAP** (phase B, not built here): Scheduled is a Mailbox with the role `scheduled`. A row of `submissions` is an `EmailSubmission`. `waiting` reads as `undoStatus: "pending"`, `sent` as `"final"`, a message taken back as `"canceled"`, and a cancel that comes too late is `cannotUnsend`. `maxDelayedSend` is 31,536,000, and `submissionExtensions` names FUTURERELEASE with the same interval; a mail app gives the time as `HOLDUNTIL` or `HOLDFOR`. A draft that is sent keeps its id. Three things do not fit and belong to the JMAP record: a send that failed has no value of `undoStatus`; destroying a message there does not stop its submission, and here a waiting message cannot be destroyed; and `sendAt` of a message sent without a hold is the time it was made, which is why `requested_at` is kept beside `send_at`.

## What is not decided here

- **Incoming mail through a queue** ([roadmap](../roadmap.md), section 3). Its reasons are its own, and nothing here speaks against it.
- **A cap for the whole instance** (S8). It needs a count across mailboxes, in the index. The account's own daily quota is the service's and reaches Podbay as a refusal.
- **Recall after a message left.** Mail cannot do it, and Podbay will not pretend to.
- **Delivery, bounce and complaint events** from the service, what `service_id` is kept for, and settling an `unknown` from them.
- **The `Message-ID` a recipient sees.** The service sets it. What Podbay stores for a sent message, and how an answer finds its conversation, is a defect of its own (found while reading for this record).
- **A notice in the Inbox** when a send fails, and telling a closed app. A notice is a message a stranger could imitate; a closed app needs push, which ADR-0013 leaves open.
- "Mark as sent" for a message whose outcome is `unknown`.
- Editing a waiting message in place, a time further than a year, and messages that repeat.
- A Scheduled of a person's own in a shared mailbox, and showing who scheduled a message.
- Where the chosen window is kept. It is a person's choice like the others: in the browser today, with the account if [ADR-0012](0012-a-persons-choices-and-known-addresses.md) is accepted. The request carries it either way.
- Whether a file goes to the service as base64 or as bytes (ADR-0011 leaves it open too).

## Security: the boundaries it touches

| Boundary | Who, and what they control | What stops them | The test it needs |
|---|---|---|---|
| B6: the sender | A member who may send: the request, its time, its window, the draft it names | The checks at the press and again at leaving (decision 15); one function that reads only stored rows; the caps counted in a log that deleting mail does not shorten; 100 waiting | Each refusal at the press. A message that waits and is refused at leaving because its sender lost the right, the mailbox's address no longer matches, or it no longer fits. A full cap holds a message and lets it go later. Deleting sent mail does not free a place. The static check: one caller of the binding |
| B6: leaving once | Nobody: failures and repeats | The compare-and-set, written before the call (decision 5); no second handover (decision 7) | An alarm run twice sends once. A handler stopped between the write and the answer leaves `unknown` and no second call. A "not now" is tried by the schedule and no more. The fake binding counts every call |
| B4: the mailbox | A signed-in person: the ids in the path, the place they name as a target | The guard and the route table; Scheduled refused as a source and as a target by every other route | 404 to a non-member and 403 to a reader on the two new routes. Each route that changes mail refuses a waiting message. Nothing can be moved into Scheduled. A message of another mailbox is 404 |
| B4 (S13) | Nobody: a mailbox deleted while mail waits | Deleting everything deletes the alarm; the first question of decision 15 | After a mailbox is deleted, with the clock moved past the time, the fake binding was never called and no row is left |
| B5: the assistant and MCP | A hostile message, through a model or an MCP client | No tool; a mailbox handle without the methods (decision 20) | The tool lists have nothing that schedules, takes back or changes a time. The tools' environment cannot reach the handover. `update_draft`, `discard_draft` and the move tools refuse a waiting message |
| B3: sessions | Someone who held a session for a short while: they schedule mail up to a year ahead, and it outlives the session | Scheduled is seen by every member who can read; the right is asked at leaving; a recovered account's waiting mail does not leave | A message scheduled, then the account recovered: it does not leave. The same for a membership removed and for a role lowered to reader |
| B1 (S7): logs | The service's error text, which may hold an address | A log line carries opaque ids, the state and the code, never the text | Marked content sent through a refused handover is in no log line |

This is the second way, after the automatic reply of ADR-0008, in which mail leaves with nobody at the screen. Here it is one person's instruction for one message, seen in Scheduled by everyone who reads the mailbox until it has left. What a member who may send can spend does not grow: the caps are the same, and they count more truly than before.

## Consequences

- **Sent means sent.** The defect in [status](../status.md), section 3, closes: a refused message is in Drafts with its reason, and a person is told.
- The "Outbound" row of the architecture changes from a queue to the mailbox's alarm, and the roadmap's row with it, when this record is accepted and not before. The feature matrix moves scheduled send and Scheduled from phase B to phase A if the lead agrees.
- The mailbox object uses the send binding, the bucket and the index for the first time. Rule S8's static check, one caller of the binding, lands with this work, and so does a fake binding that can give each answer of decision 6.
- A row must hold everything the service is given. Today it keeps one body; the text form is made from the HTML again at leaving.
- A mailbox that sends pays one alarm run for a message. A mailbox that sends nothing pays nothing.
- A mailbox learns an address ([ADR-0012](0012-a-persons-choices-and-known-addresses.md), decision 14) when the message leaves, not when it is scheduled.
- The signal of ADR-0013 needs no new kind: `mail` moves when a message is taken, taken back, leaves or fails.
- The app gets "Undo" after Send, "Send later" beside Send, Scheduled in the rail and a mark on Drafts.
- The work comes in the usual order: the two tables, the states, the function and the alarm in the mailbox object, with tests in the Workers runtime that move the clock; the routes and their rights; the tools' handle; the app; the browser tests; the documents and the ledger. Nothing is built before acceptance.
- Today's instances are development instances. Changing what a send answers is cheapest now.

## Triggers

Look again when one of these is true:

- A message is found to have left twice, or not to have left without a mark.
- `unknown` is seen in ordinary use.
- The service takes an idempotency key, or lets the sender set the `Message-ID`: decision 7 can then become "try again".
- An alarm is found later than a minute, or lost.
- The queue for incoming mail is built and a cap for the whole instance is taken up.
- The JMAP record is written.
- People ask for a window that is off, a time further than a year, or editing in place.
- ADR-0010 is built: the alarm function gets its second kind.

## Sources

- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail" (August 2019), sections 1.3.2, 2, 7, 7.5 and 7.5.1: `https://www.rfc-editor.org/rfc/rfc8621.txt`, read 2026-11-17.
- RFC 4865, "SMTP Submission Service Extension for Future Message Release" (May 2007), sections 3, 4.2 and 6: `https://www.rfc-editor.org/rfc/rfc4865.txt`, read 2026-11-17.
- RFC 9979, "Registration of Further IMAP/JMAP Keywords and Mailbox Name Attributes" (May 2026), sections 8.2 and 9.2.2: `https://www.rfc-editor.org/rfc/rfc9979.txt`, read 2026-11-17.
- The IANA registry "IMAP Mailbox Name Attributes" (last updated 2026-06-01): `https://www.iana.org/assignments/imap-mailbox-name-attributes/imap-mailbox-name-attributes.xml`; the JMAP registries (last updated 2025-05-02): `https://www.iana.org/assignments/jmap/jmap.xml`; both read 2026-11-17.
- Cloudflare, Durable Objects, each under `https://developers.cloudflare.com/durable-objects/` and read 2026-11-17: alarms (page dated 2026-04-21), `api/alarms/`; the SQLite storage API, for `setAlarm`, `deleteAll` and `sync` (2026-09-21), `api/sqlite-storage-api/`; the base class (2026-06-15), `api/base/`; limits (2026-11-13), `platform/limits/`; spending limits (2026-11-13), `platform/spend-management/`.
- Cloudflare, Queues, each under `https://developers.cloudflare.com/queues/` and read 2026-11-17: limits (page dated 2026-10-30), `platform/limits/`; batching, retries and delays (2026-04-21), `configuration/batching-retries/`; delivery guarantees (2026-04-21), `reference/delivery-guarantees/`; dead letter queues (2026-10-12), `configuration/dead-letter-queues/`; the JavaScript APIs (2026-07-06), `configuration/javascript-apis/`.
- Cloudflare, Workflows, each under `https://developers.cloudflare.com/workflows/` and read 2026-11-17: limits (page dated 2026-11-10), `reference/limits/`; sleeping and retrying (2026-09-24), `build/sleeping-and-retrying/`; rules of Workflows (2026-10-15), `build/rules-of-workflows/`; the Workers API (2026-11-11), `build/workers-api/`.
- Cloudflare, Workers, the context API for `waitUntil` (page dated 2026-10-12): `https://developers.cloudflare.com/workers/runtime-apis/context/`, read 2026-11-17.
- Cloudflare, Email Service, each under `https://developers.cloudflare.com/email-service/` and read 2026-11-17: the Workers API for sending (page dated 2026-11-17), `api/send-emails/workers-api/`; the REST API (2026-11-17), `api/send-emails/rest-api/`; headers (2026-11-11), `reference/headers/`; limits (2026-10-30), `platform/limits/`; local development (2026-10-15), `observability/local-development/sending/`.
- The repository: `workers/index.ts` (the send route, the move route), `workers/routes/reply-forward.ts`, `workers/email-sender.ts`, `workers/lib/email-helpers.ts` (`validateSender`), `workers/lib/schemas.ts`, `workers/lib/tools.ts`, `workers/agent/tools.ts` (`withoutSend`), `workers/durableObject/index.ts` (`checkSendRateLimit`, `purge`) and `migrations.ts`, `workers/auth/route-table.ts`, `shared/sending-limits.ts`, `app/hooks/useComposeForm.ts`, `migrations/0006_recoveries.sql`, `wrangler.jsonc`.
