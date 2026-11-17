# ADR-0008: A mailbox has rules for its incoming mail: blocked senders, filters, an automatic reply

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each quoted finding was read in the standard's own text on that day.

## Context

The mail screens were compared with the mail people know from Gmail and Google Workspace ([roadmap](../roadmap.md), section 4). What is missing most, once reading and writing are in place, is mail that manages itself: on a message, "Block the sender" and "Filter messages like this"; in the settings, filters and blocked addresses, and an automatic reply while away.

None of it can be done in the app alone. Each is stored, and each acts on mail when it arrives, with nobody at the screen. It is a decision because it adds a persisted format, routes other programs call, a step in the path of incoming mail (boundary B1), and, for the automatic reply, mail that leaves without a person sending it (boundary B6).

It also moves scope. The [feature matrix](../feature-scope.md#3-feature-matrix) has allow and block lists in phase A and "Rules: sort, forward or reject incoming mail" in phase B, and the roadmap says a phase B feature is not pulled forward without a record. A mailbox's settings already carry two shapes that nothing acts on, `forwarding` and `autoReply`.

What the answer has to respect:

1. **Mail is hostile bytes** (S3). A rule is matched against what a stranger wrote. Matching must be bounded and must not run anything.
2. **One sender check** (S8), and the caps of a mailbox and of the instance. Mail that the Worker sends by itself is still mail sent as the mailbox.
3. **Deny by default** (S1). A rule changes where everyone's mail goes in a shared mailbox.
4. **JMAP in phase B** (ADR-0001). What is stored should be what a mail app will ask for.
5. **Automatic mail must not loop, leak or be abused.** The standard for this is old and specific.

## Findings

### Filtering has a standard language, and it is a language

Sieve is "a language for filtering email messages at time of final delivery … It is suitable for running on a mail server where users may not be allowed to execute arbitrary programs … as the base language has no variables, loops, or ability to shell out to external programs" (RFC 5228, abstract). It is still a language: a script is parsed and interpreted. A person at a screen does not write a script; they fill in "from", "subject", "has the words" and tick what should happen.

### The automatic reply has a standard shape

JMAP describes it as one object for the account: "A vacation response sends an automatic reply when a message is delivered to the mail store, informing the original sender that their message may not be read for some time." Its properties are `isEnabled`, `fromDate`, `toDate`, `subject`, `textBody` and `htmlBody`, and "There is only ever one VacationResponse object, and its id is 'singleton'" (RFC 8621, section 8).

### Automatic replies have rules, and they are binding for JMAP

"Automated message sending can produce undesirable behaviour. To avoid this, implementors MUST follow the recommendations set forth in [RFC3834]" (RFC 8621, section 8). From RFC 3834:

- "An automatic responder MUST NOT blindly send a response for every message received" (section 2).
- "Automatic responses SHOULD NOT be issued in response to any message which contains an Auto-Submitted header field …, where that field has any value other than 'no'" (section 2).
- The same response "SHOULD NOT" go "to the same sender more than once within a period of several days … A 7-day period is RECOMMENDED as a default" (section 2).
- A notice of absence "SHOULD NOT be issued unless a valid address for the recipient is explicitly included in a recipient (e.g., To, Cc, Bcc …) field of the subject message" (section 2).
- "The Auto-Submitted field, with a value of 'auto-replied', SHOULD be included in the message header of any automatic response" (section 3.1.7).
- A responder "SHOULD NOT deliver a response to any address other than that in the Return-Path field" (section 4), and a response "SHOULD NOT include significant content from the subject message" (section 3.2).

## Options

| | Option | For | Against |
|---|---|---|---|
| A | **Nothing**: people file their mail by hand | Nothing to build, nothing that can loop | The gap stays. Two stored shapes go on promising what does not happen |
| B | **Store and run Sieve scripts** | The standard; what JMAP's filtering extension carries | An interpreter in the path of every incoming message, for scripts no person at a screen will write. The app would have to generate scripts and parse them back to show them |
| C | **Rules as data in a closed vocabulary**, matched by one pure function; the automatic reply as the JMAP object | Nothing is interpreted. The vocabulary is what the screens offer, so the screens and the store cannot disagree. Every condition and action has a Sieve equivalent, so an export, or JMAP's filtering extension later, is a translation | Less than Sieve can say. A rule a mail app writes in Sieve cannot be taken in until then |

## Decision

Option C.

1. **A mailbox has an ordered list of rules.** A rule has conditions, all of which must hold, and actions. Rules are kept in the mailbox's own database.
2. **Conditions**, a closed set: the sender is or contains; a recipient is or contains; the subject contains; the message contains the words; it has an attachment. Matching is plain text, without regard to case, with no patterns and no expressions, on fields with a fixed length limit.
3. **Actions**, a closed set: skip the inbox (to Archive); mark as read; star; give labels; move to Trash; move to Spam. No rule forwards and no rule rejects in this record: forwarding sends mail and needs a loop guard, rejecting answers the sending server, and both stay in phase B.
4. **A blocked sender is a rule of its own kind**: an address, or everything at a domain, whose mail goes to Spam. "Block the sender" on a message makes one, "Unblock" removes it. An allow list has nothing to override until Podbay scores spam itself, so it is not built yet.
5. **Rules run once, when a message arrives**, after it is parsed and before it is stored: blocked senders first, then every rule in order. All matching rules apply; when they disagree about the place, Trash wins over Spam, and Spam over Archive. A rule never runs on mail that is already stored; applying a new rule to old mail is a later feature.
6. **Rules are evaluated by one pure function** from a rule list and the facts of a message to an outcome. It has full branch coverage, as the other security modules do (D6), and it cannot fail a delivery: a rule that cannot be evaluated is skipped and counted.
7. **Rights.** Seeing rules needs `mailbox.read`. Changing them needs `mailbox.manage`: in a shared mailbox a rule decides where everyone's mail goes. Making a rule is recorded in the audit log.
8. **The automatic reply is one object for the mailbox**, with the names JMAP gives it: enabled, from, until, subject, text and HTML body. Changing it needs `mailbox.manage` and fresh proof, because it makes the mailbox send.
9. **The automatic reply follows RFC 3834, and each line is a test:** never to a message with `Auto-Submitted` other than `no`; never unless the mailbox's address is in To or Cc; never to mail that was filed in Spam or by a blocked-sender rule; to the envelope sender only; once per sender in seven days; marked `Auto-Submitted: auto-replied`; with none of the incoming message in it.
10. **It is still the mailbox sending** (S8): it goes through the one sender check and counts against the mailbox's caps, with a cap of its own below them, so a flood of incoming mail cannot spend the day's sending. It is the one case where mail leaves without a person: S9 is unchanged, because the assistant and MCP still have no send tool, and this is a person's standing instruction, set with fresh proof, visible in the settings and recorded in the audit log.
11. **Limits, chosen and to be revised from use:** 100 rules and 500 blocked senders in a mailbox, 200 characters in a condition, 10 labels in an action.
12. **Sticky names, fixed by this record:** the tables `rules` and `auto_reply_log` in the mailbox's database; the routes `GET` and `PUT …/rules`, `POST` and `DELETE …/blocked-senders`, `GET` and `PUT …/auto-reply`. The `autoReply` and `forwarding` keys of a mailbox's settings are removed from what a new mailbox gets; a stored value is ignored.
13. **How it will read over JMAP** (phase B, not built here): the automatic reply is the `VacationResponse` object as it stands. Rules are offered as a generated Sieve script when the filtering extension is taken up, by its own record.

## What is not decided here

- Forwarding incoming mail, and rejecting it (phase B, with the loop guard).
- An allow list, and any spam scoring.
- Applying a rule to mail that is already stored.
- Snooze and mute. Each is a state of a conversation, not a rule.
- Importing or exporting rules.

## Consequences

- The feature matrix moves sorting rules and the automatic reply from phase B to phase A, and keeps forwarding and rejecting in B, when this record is accepted and not before.
- The message menu gains "Block the sender" and "Filter messages like this"; the settings gain "Filters and blocked senders" and "Automatic reply".
- The inbound path gets one more step, and it is the first code that sends without a request from a person. Both boundaries get their tests before the screens are built.
- The work comes in the usual order: the pure function and the store; the inbound step; the automatic reply with its seven refusals; the routes and rights; the app; the browser tests; the documents.
- JMAP later carries the automatic reply unchanged.

## Triggers

Look again when one of these is true:

- A person needs a rule the vocabulary cannot say.
- JMAP's filtering extension is taken up, or a mail app that manages rules is to be supported.
- The automatic reply is found to have answered something it should not have.

## Sources

- RFC 5228, "Sieve: An Email Filtering Language", abstract: `rfc-editor.org/rfc/rfc5228.txt`.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", section 8: `rfc-editor.org/rfc/rfc8621.txt`.
- RFC 3834, "Recommendations for Automatic Responses to Electronic Mail", sections 2, 3 and 4: `rfc-editor.org/rfc/rfc3834.txt`.
- The repository: `workers/index.ts` (`receiveEmail`), `workers/routes/mailboxes.ts` (the `forwarding` and `autoReply` shapes), `docs/engineering-rules.md` (S3, S8, S9, D6).
