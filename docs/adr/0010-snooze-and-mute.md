# ADR-0010: A conversation can be snoozed, and a conversation can be muted

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each quoted finding was read in the document's own text on that day.

## Context

Two things a person does to a conversation in the mail people know from Gmail and Google Workspace are missing in Podbay ([roadmap](../roadmap.md), section 4): **snooze** it, so that it leaves the inbox and comes back at a time, and **mute** it, so that later messages of it no longer come to the inbox. Both are in the menus that were compared: snooze on a line and in a conversation's menu, mute in the conversation's menu.

Neither can be done in the app alone. Snooze needs something to happen at a time, with nobody at the screen. Mute acts on mail when it arrives. Both are states that are stored and that a mail app will later want to see.

[ADR-0007](0007-places-and-labels.md) says a message is in exactly one of six places and left snooze out, with the words "each is a time on a message, not a label". The [feature matrix](../feature-scope.md#3-feature-matrix) has "Snoozed and Scheduled" in phase B.

## Findings

### Both have names that mail programs agreed on in 2026

RFC 9979 "defines a number of keywords and mailbox name attributes that have been in use across different server and client implementations" and registers them, so that programs agree on them.

- **Snoozed** is a place: "The Snoozed mailbox name attribute identifies a mailbox that is used to store messages that have been temporarily removed from the user's attention and scheduled to reappear at a later time. When a user chooses to 'snooze' a message, the supporting server moves the message to a mailbox with this attribute. At the specified 'awaken' time, the server automatically moves the message back to its original location (typically the inbox) and may mark it with the $new keyword" (section 8.1). The same section says the attribute "does not itself define the snoozing mechanism or interface".
- **Muted** is a keyword on messages: "The $muted keyword provides a way for users to indicate they are not interested in future messages in a particular conversation thread … When a new message arrives that belongs to the same thread as one marked with this keyword, supporting servers MAY automatically deprioritize the message. This could include moving it to an archive or trash folder, marking it as read" (section 7.6). "When unmuting a thread, clients MUST remove this keyword from all messages in the thread that have it."
- Its registration names the risk: someone who got into an account "could mute threads to hide important communications", and calls it "only a small increase in risk since compromised accounts allow many other similar actions" (section 7.6).

Both are in the IANA registries JMAP takes its roles and keywords from, so a mail app will look for exactly these.

### The mailbox can wake itself

A mailbox is a Durable Object, and "Each Durable Object is able to schedule a single alarm at a time by calling `setAlarm()`. Alarms have guaranteed at-least-once execution and are retried automatically when the `alarm()` handler throws." For more than one event: "you can manage many scheduled and recurring events by storing your event schedule in storage and having the `alarm()` handler process due events, then reschedule itself for the next one" (Cloudflare, Durable Objects alarms; recorded in the [ledger](../cloudflare/ledger.json)).

## Decision

1. **Snoozed is a seventh place.** A snoozed conversation is in Snoozed, as the registry has it, and nowhere else; [ADR-0007](0007-places-and-labels.md)'s "exactly one place" stands, with one place more. Its rail entry sits under Starred and lists what is snoozed by the time it comes back, soonest first.
2. **Snoozing takes a time.** Each message of the conversation that is in the Inbox is moved to Snoozed, with the time it comes back and the place it came from. The app offers later today, tomorrow, next week and a date and time. A time in the past is refused.
3. **The mailbox wakes its own mail.** The mailbox object keeps one alarm set to the earliest time any message comes back. When it fires, every message whose time has come goes back to where it was, is marked unread, and counts as new mail for the tab's count and for notifications. Because an alarm may fire more than once, waking is a move that is safe to repeat.
4. **A snoozed conversation that gets an answer wakes at once.** New mail in a conversation is a reason to see it.
5. **Moving, deleting or reporting a snoozed conversation ends its snooze.** "Unsnooze" moves it back now.
6. **Muted is a mark on the conversation's messages**, stored with them. Muting also archives what is in the Inbox. When a message arrives in a muted conversation it is filed in Archive unread instead of the Inbox, unless the mailbox's address is in its To: a message sent to the person directly is not hidden. Unmuting takes the mark off every message of the conversation.
7. **A muted conversation says so** on its line and in its header, and `is:muted` finds them all, so that muting cannot hide mail without a trace.
8. **Order when mail arrives:** matching the conversation first ([the fix of 2026-11-17](../status.md)), then mute, then the rules of [ADR-0008](0008-rules-for-incoming-mail.md) if that record is accepted. A rule that sends mail to Trash or Spam still does; mute only changes Inbox to Archive.
9. **Rights.** Snoozing, muting and their opposites need `mailbox.write`, as moving does. In a shared mailbox they are the mailbox's, not a person's: everyone sees a conversation snoozed or muted. An MCP key or the assistant that may change the mailbox may snooze and mute; both are recorded as changes.
10. **Sticky names, fixed by this record:** the place id `snoozed`; the columns `snoozed_until`, `snoozed_from` and `muted` on a message in the mailbox's database; the routes `POST …/emails/:emailId/snooze` and `…/unsnooze`, `POST …/emails/:emailId/mute` and `…/unmute`; the search operators `in:snoozed` and `is:muted`.
11. **How it will read over JMAP** (phase B, not built here): Snoozed is a Mailbox with the role `snoozed`; muted is the keyword `$muted`; a message that woke carries `$new` until it is read.

## What is not decided here

- Sending a message at a later time ("Scheduled"). It is the same alarm and a different place, and belongs with the queue for outgoing mail in milestone 3.
- Following a conversation (`$followed`) and reminders to answer.
- A snooze of a person's own in a shared mailbox.

## Consequences

- The feature matrix moves Snoozed from phase B to phase A, and keeps Scheduled in B, when this record is accepted and not before.
- The mailbox object gets its first alarm. The alarm, the schedule it reads and the at-least-once rule get tests in the Workers runtime before any screen is built.
- The alarm alone is not enough to rely on: reading for [ADR-0016](0016-outgoing-mail-waits-before-it-leaves.md) found that a handler that throws is tried a limited number of times, that an alarm can run late, and that one held for days can be lost. That record's decisions 17 and 18 say how one alarm serves every waiting time and is set again on every wake; if both records are accepted, snooze uses the same function, and if only this one is, it needs the same care.
- The inbound path gets one more step (mute), next to conversation matching.
- The app gets "Snooze" and "Mute" where the reference has them: on a line, in a line's menu, in a conversation's menu.

## Triggers

Look again when one of these is true:

- People who share a mailbox want to snooze for themselves only.
- A snoozed message is found not to have come back, or to have come back twice.
- Scheduled sending is taken up: it should share the alarm.

## Sources

- RFC 9979, "Registration of Further IMAP/JMAP Keywords and Mailbox Name Attributes" (May 2026), sections 7.6, 7.7 and 8.1: `rfc-editor.org/rfc/rfc9979.txt`.
- The IANA registries "IMAP and JMAP Keywords" and "IMAP Mailbox Name Attributes": `iana.org/assignments/imap-jmap-keywords/`, `iana.org/assignments/imap-mailbox-name-attributes/`.
- Cloudflare, Durable Objects alarms (page dated 2026-04-21): `developers.cloudflare.com/durable-objects/api/alarms/`.
- The repository: `workers/durableObject/index.ts`, `workers/index.ts` (`receiveEmail`), `workers/durableObject/threads.ts`.
