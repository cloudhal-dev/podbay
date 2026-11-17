# ADR-0015: The original message is kept

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each finding was read in the standard's or the platform's own text on that day and is retold here in Podbay's words; names in `code` are the source's own.

## Context

In the mail people know from Gmail and Google Workspace, the menu of a message offers to show the original message and to download it. Podbay does neither. An incoming message is parsed and only its parts are kept: fields in the mailbox's database, attachments in the bucket. The bytes that arrived are dropped when the handler returns. So a person cannot check where a message really came from, cannot hand it to someone who needs the evidence, and cannot move it to another mail system; and a mistake of the parser cannot be repaired afterwards, because what it read is gone.

[ADR-0001](0001-founding-decisions.md), decision 3, already says that raw messages live in R2. The [feature matrix](../feature-scope.md#3-feature-matrix) has the row "Original message" in phase A, and the [roadmap](../roadmap.md) lists it as missing (section 4, row 7) and puts "raw messages in R2" first in the storage work of milestone 3 (section 3, item 2). This record says how.

It is a decision because it changes persisted formats (columns and a table in the mailbox's database, a new kind of object in the bucket), adds routes other programs call, and touches four trust boundaries: inbound mail bytes (B1), mail in the browser (B2), per-mailbox authorisation and deletion (B4) and the assistant and MCP (B5). It moves no scope.

What the answer has to respect, whatever it is:

1. **Mail is hostile bytes** (S3), and the original is all of them at once. It is never a page (S4, S5).
2. **No storage key from input** (S2). Nothing a sender wrote and nothing a request names becomes a key.
3. **Deletion deletes** (S13). Nothing may stay in the bucket that no row of a mailbox names.
4. **Deny by default in one table** (S1), and a person without a membership is told nothing.
5. **Agents and MCP hold less, not more** (S9). A raw message is the largest piece of hostile text there is.
6. **Mail that Podbay has taken is not lost.** A failure after that point must not cost the message.
7. **No account credential in the Worker** (S14): bindings only.
8. **Three things are not decided yet** and must not be decided by accident: a per-mailbox prefix for storage keys, storage ids that say nothing, and inbound mail through a queue (roadmap, section 3, item 2).
9. **JMAP in phase B** (ADR-0001, decision 10). What is stored should be what a mail app will ask for.

## Findings

### What the code does today

- **Arrival.** The `email` handler (`workers/app.ts`) calls `receiveEmail` (`workers/index.ts`). It picks the mailbox by the envelope recipient and rejects an unknown one before a byte is read. It then reads the whole message into memory, sized by `rawSize` and refused above 25 MiB, parses it with the mail parser, writes each attachment to the bucket, and last writes the message's row and its attachment rows in one call to the mailbox object. The bytes are not written anywhere.
- **What is kept of the header.** The column `raw_headers` holds every header field the parser found, in order, as a list of names and unfolded values in JSON. It is not the header block: the bytes, the line breaks and everything after the header are gone. "Show headers" in the app lists it. For a sent message the list has at most seven fields, which Podbay wrote itself.
- **What is kept of authentication.** Nothing reads what the receiving service says about SPF, DKIM and DMARC. The [architecture](../architecture.md) describes showing it as the target; no code does it.
- **When something fails.** The parser refuses a message that nests too deep, has too large a header or too many parts. A text longer than a row can hold cannot be written. In each case the handler throws, the message is not in the mailbox, and the attachments that were already written stay in the bucket without a row ([status](../status.md), section 3, names this order). A stream that ends before `rawSize` bytes is not noticed: the missing bytes are parsed as zeros.
- **Sent mail.** Podbay never builds a message. It hands fields (`from`, `to`, `subject`, `html`, `text`, `attachments`, two threading headers) to the sending service, which builds the message and signs it. The route answers before the service does, and what the service returns is not kept.
- **Attachments.** Bytes are under `attachments/{message id}/{attachment id}/{file name}`, built again from the row for every read and delete. An ordinary file is a link; one that can do harm leaves only through a POST from the app's own origin that says `acknowledged`. Deleting a message removes its rows and then its objects; deleting a mailbox empties the database (`purge`) and then deletes the objects.
- **Tools.** `get_email` and `get_thread` of the assistant and of MCP answer with the message's whole row, `raw_headers` included.
- **Ids.** A received message's id is random. The mailbox object is still named after the address.

### The standards

- **A message is lines**: a header section, an empty line, and a body. A line has at most 998 characters (RFC 5322, sections 2.1 and 2.1.1).
- **Taking a message is a duty.** A server that accepts a message accepts responsibility for it and must not lose it for reasons such as a crash. A receiver that answers slowly causes duplicates, because the sender times out and sends again (RFC 5321, section 6.1).
- **`Authentication-Results`** is added by the receiving side. A program should not interpret the field unless it knows that it was added inside the system that accepted the mail, that forged copies are removed at the border, and that the field carries the identifier that system uses. A border that does not remove forged fields lets a sender claim its own results. Results should not be shown to people without careful design, and an unknown result word is ignored (RFC 8601, sections 4.1, 5 and 7.1). As read from the field's grammar, it has no bare comma: one appears only inside a quoted string or a comment (section 2.2 and the grammars it names).
- **JMAP names the original.** An `Email` has a `blobId`, the id of the raw octets of the message, used to download the original or to attach it to another message; `size` is the number of those octets; `receivedAt` is when the store received it (RFC 8621, section 4.1.1). `headers` lists every header field in the order of the message with the capitalisation it has there; in the raw form an octet that is not valid UTF-8 becomes U+FFFD and a NUL is dropped (sections 4.1.2.1 and 4.1.3).
- **A blob is bytes and nothing else**, and it never changes. An id is 1 to 255 octets from letters, digits, `-` and `_`. A blob is downloaded with a GET on the server's `downloadUrl`, a template in which the client fills in `accountId`, `blobId`, `type` and `name`: the client names the type and the file name the answer carries (RFC 8620, sections 1.2, 6 and 6.2).
- **Importing is making a message from a blob.** A server may refuse a message whose content or whose `Message-ID` it already holds, or allow it; when it allows it, the copy is a message of its own (RFC 8621, section 4.8).
- **Types and names.** `message/rfc822` is the media type of a message (RFC 2046, section 5.2.1); a message with UTF-8 headers is `message/global`, for which `.u8msg` is suggested (RFC 6532, section 3.7). No standard read for this record fixes the ending `.eml`; it is the convention the [feature matrix](../feature-scope.md#3-feature-matrix) already uses. `Content-Disposition: attachment` tells a browser to save an answer and not to process it by its type (RFC 6266, section 4.2).

### The platform

Read in Cloudflare's documentation on 2026-11-17. "In the ledger" means the [ledger](../cloudflare/ledger.json) already holds the fact with its quote; the others are entered with the build.

| Fact | Value | In the ledger |
|---|---|---|
| Largest inbound message | 25 MiB; larger mail is rejected | Yes |
| The message in the handler | `raw` is a stream of the message, `rawSize` its size in bytes | Yes |
| The header on the message object | `headers`, a `Headers` object | No |
| Authentication | Email Routing checks DMARC before the Worker runs and puts an `Authentication-Results` field with SPF, DKIM and DMARC results in front of the message. The page says to read the first such field through `message.headers` and to check that its identifier is `mx.cloudflare.net`; other fields of that name may be the sender's | Yes, without the place to read it |
| Mail that fails both SPF and DKIM | Rejected; a sender domain's DMARC policy is honoured | No |
| Refusing a message | `setReject` answers the sending server with a permanent error | Yes |
| A handler that throws | The pages do not say what the sending server is told | Not documented |
| The handler on the Free plan | It runs under the Free plan's CPU and memory limits and can fail on a message that is costly to process | No |
| CPU time | 10 ms on Workers Free; 30 seconds by default on Workers Paid. The Workers page gives both for an HTTP request and names no figure for the `email` handler | No |
| Memory of an isolate | 128 MB | Yes |
| Writing to the bucket | `put` takes bytes or a stream. A stream's length must be known: a request body with its length, or the readable half of a `FixedLengthStream`. The page does not say that `raw` qualifies by itself | Bytes: yes. The stream rule: no |
| `FixedLengthStream` | Fails when more or fewer bytes pass than it was made for | No |
| Reading a part | `get` takes a `range` (offset and length) | No |
| Writes and deletes | Strongly consistent; one `delete` takes up to 1000 keys | Consistency: yes. 1000: no |
| A key | At most 1,024 bytes | Yes |
| One upload | Up to 5 GiB less 5 MiB in one part, so a message never needs a multipart upload | No |
| The bucket's price | Storage 0.015 dollars for a GB a month; a write 4.50 and a read 0.36 dollars for a million; deletes and egress free. Each month 10 GB, a million writes and ten million reads cost nothing | No |
| The mailbox's database | A string, a blob or a row holds at most 8 MB | Yes |
| What Podbay sets on a sent message | Not `Date`, `Message-ID`, `MIME-Version`, `Content-Type`, `DKIM-Signature` or `Return-Path`: the sending service makes them and refuses a request that tries to set one | No |
| Local development | A raw message posted to the local endpoint reaches the handler. Nothing there checks authentication | The endpoint: yes |

## Options

Where the bytes live:

| | Option | For | Against |
|---|---|---|---|
| A | **Nowhere**, as today | Nothing to build | The gap stays, and a message the parser refuses is lost |
| B | **In the mailbox's database** | One store, one deletion | A row holds 8 MB and a message can be 25 MiB |
| C | **In the bucket, under a key built from the message's id**, as attachments are today | The smallest change | The key follows from an id a request names. Every reader builds it again. Its shape must change when the two storage decisions are made, and the bucket cannot rename |
| D | **In the bucket, under a per-mailbox prefix decided here** | Closes one of the open decisions | It decides the storage of every attachment inside a record about something else, or leaves two shapes side by side |
| E | **In the bucket, under a key that is written whole into the message's row** and is never built again | The row is the only way to the object. Whatever is decided about prefixes and ids later, rows that exist keep working | One more column. Nobody can find the object without the row |
| F | **Only the original**, and every attachment is read out of it when asked for | One copy of each file | Each download of a file parses up to 25 MiB in the Worker. Not now |

When they are written:

| | Option | For | Against |
|---|---|---|---|
| G | **After parsing**, with the message | One step more than today | When the parser fails there is no message and no original: the bytes are lost exactly when they are needed |
| H | **Bytes first, a row afterwards** | Simple | A failure in between leaves an object no row names |
| I | **A row for the arrival first, then the bytes, then parsing** | The bucket never holds an object without a row. Once the bytes are stored the message cannot be lost, whatever the parser does | A small table, and arrivals that were left half done must be picked up |
| J | **The message's own row first**, hidden until it is complete | No second table | Every list, count, search and tool would have to leave hidden rows out |

Sent mail:

| | Option | For | Against |
|---|---|---|---|
| K | **Nothing is kept, and the app says so** | True | Sent mail has no file to download |
| L | **Podbay builds the message itself** and keeps what it handed over | A file exists | It is still not what left: the service sets the date and the message id and signs. A builder of messages is a new module on the sending boundary |
| M | **A file made from the stored parts when asked for** | A file exists | It is an export, not an original, and must not carry that name |

Reading:

| | Option | For | Against |
|---|---|---|---|
| N | **A link to the bytes** | Simple | A link in a message, or on another site, can start it. The file carries every attachment of the message, also the ones Podbay holds back behind a warning |
| O | **A signed address straight to the bucket** | The bytes do not pass the Worker | Signing needs the bucket's credentials inside the Worker (S14) |
| P | **The bytes through a POST from the app's own origin, and the first part as text in a JSON answer** | No link starts a download. Nothing is ever served that a browser would show | The app holds the file in memory before it saves it |
| Q | **Shown in the mail frame, or as a page** | None | It is the one thing this record must never do |

## Decision

Options E, I, K and P.

**Where it lives**

1. **The original of a received message is kept.** It is exactly the bytes `raw` gave, all `rawSize` of them, as one object in the bucket. Nothing is added, removed or decoded, and the object carries no metadata.
2. **Its key is written whole into the message's row**, in the column `raw_key`, and that column is the only way to the object. No code builds the key of an original from an id, an address or a name; reading and deleting read the column. The key is made for the object when the message arrives: `raw/` and 32 lower-case hexadecimal characters from 16 random bytes. It is not the message's id and says nothing of the mailbox, the sender or the time.
3. **The two open storage decisions are not made here.** The shape is chosen so that it does not have to change when they are. If a per-mailbox prefix is accepted before this is built, new keys begin with it; if it is accepted later, rows that exist keep their keys and new rows get the new shape. The column holds either. All this record asks of those decisions is that they do not build the key of an original from parts. Attachment keys are left as they are.
4. **The row also holds `raw_size`**, the number of bytes. `raw_key` never leaves the Worker: it is in no API answer, no tool's answer, no log and not in the app. An answer about a message says `has_original` and `raw_size`.

**When it is written**

5. **The order on arrival:**

   | Step | What happens |
   |---|---|
   | a | The mailbox is picked by the envelope recipient; an unknown one is rejected. Unchanged, and before any byte is read |
   | b | A declared size that is not between 1 byte and 25 MiB is refused with `setReject`. Nothing is read or stored |
   | c | A row is written in a new table of the mailbox's database, `arrivals`: the id the message will have, the key, the size, the envelope sender, the time |
   | d | The bytes are written under that key. The object has exactly `rawSize` bytes, or the arrival has failed |
   | e | The message is parsed, and the rules for incoming mail run if [ADR-0008](0008-rules-for-incoming-mail.md) is accepted |
   | f | One transaction in the mailbox object writes the message's row with `raw_key` and `raw_size` and its attachment rows, and removes the arrival row |
   | g | The attachments' bytes are written to the bucket |

   Today the handler holds the whole message in memory to parse it, and it writes those bytes. A handler that no longer parses would pass `raw` through a `FixedLengthStream` of `rawSize` bytes.
6. **Step d is the line.** Before the original is stored, a failure removes the arrival row and what was written, and the handler throws, as it does today: Podbay has not taken the message. A stream that gives more or fewer bytes than `rawSize` is such a failure; a part of a message is never kept as if it were the whole. After the original is stored, the handler neither throws nor rejects: Podbay has the message and finishes by itself.
7. **A message that cannot be parsed or filed is still a message.** When the parser refuses it, or a part of it is too large for a row, step f writes a message that says so: in the Inbox, with the envelope sender as its sender, no subject and no text, its original, and the column `unparsed` set to `parser` or `too_large`. The app shows that Podbay could not read it and offers the original. It joins no conversation and wakes no assistant.
8. **Attachment rows come before attachment bytes** (steps f and g), so the rule of step c holds for them too. A failure in step g leaves a row whose file cannot be downloaded, never an object without a row; the file is still inside the original. If [ADR-0011](0011-drafts-keep-their-files.md) is accepted, its column `uploading_since` marks such a row until its bytes are stored.
9. **An arrival that was left half done is picked up by the next one.** A handler can be stopped by the platform between two steps. An arrival row older than 15 minutes is such a case. After a new message of the same mailbox is safely stored, the handler takes up to three of them, each by a call that counts the attempt: when the object is there, the arrival goes on from step e; on its second attempt it is filed as `unparsed` with `interrupted` and is not parsed again, so that a message that stops the parser cannot do so for ever. When the object is not there, the row is removed. No timer is needed. This is a rescue and not a promise: the sending server may have been told that the delivery failed.
10. **A message that is too large never gets this far.** The platform rejects mail above 25 MiB, and step b refuses one that arrives all the same. Podbay's limit is the platform's.
11. **Every delivery is a message.** The same message delivered twice is two messages, each with its own id, row and original. Podbay does not drop or merge by `Message-ID`, which is the sender's text: whoever sent first under a known id could silence the real message. It does not compare contents either. The conversation rules put the copies side by side. A delivery that the platform or the sender tries again after a failure cannot be told from a new message; decision 6 keeps that window small. JMAP allows a server either way.

**Sent mail, drafts and mail that is already stored**

12. **A sent message and a draft have no original**, and `raw_key` is empty for them. The sending service builds and signs what leaves, and those bytes never come back to Podbay. The app offers neither "Show original" nor the download there. "Show headers" stays for a sent message and says what it shows: the fields Podbay handed over, not the date and the message id the service gave the message. No file made from stored parts is called an original.
13. **Mail that arrived before this is built has no original** and never will: the bytes are gone. The app says so and shows the stored list of header fields, as today. The migration rewrites nothing.

**Reading it**

14. **Showing: `GET …/emails/:id/original`** answers JSON, like every API answer: `size` (the bytes of the original), `shown` (how many of them the answer covers), `header` (the header block: the lines up to the first empty one), `rest` (what follows, as far as `shown` reaches) and `authentication` (decision 18). It covers the first 256 KiB, taken from the bucket by a ranged read, so the Worker never holds more. The bytes become text as JMAP's raw form does: UTF-8, U+FFFD for what is not, NUL dropped. The app says "the first 256 KB of" the size when there is more, and offers the download.
15. **Downloading: `POST …/emails/:id/original/download`** with `{ "acknowledged": true }`, which the guard accepts from the app's own origin only. The answer is the object as a stream, with `Content-Length`, `Content-Type: application/octet-stream`, `Content-Disposition: attachment` and the headers every answer of the Worker carries (`nosniff`, a content policy that allows nothing and sandboxes, no caching). There is no GET for the bytes and no `Range`. The type is not `message/rfc822`: rule S5 serves only types from a short inert list, and a program learns what the file is from its name.
16. **The file's name is made by Podbay**: `message-`, the day it arrived as eight digits, `-`, the first eight characters of the message's id, and `.eml`. Nothing of the subject or the sender is in it: a name written by a stranger is what the attachment rules call deceptive. Before the download the app says, in its own dialog, that the file holds the whole message with every attachment and that another program will open it without Podbay's protections; it names the attachments that can do harm.
17. **On the screen it is text and only text.** The header block and the rest are text nodes in a preformatted block, in one component. It is never HTML, never in the mail frame, and no link is made from it. Control characters and the characters that change the direction of text are drawn as visible marks, so a line reads in the order of its bytes.
18. **What is said about SPF, DKIM and DMARC is the platform's statement, and is shown as that.** On arrival the handler reads the first `Authentication-Results` field from `message.headers`, as the platform's page says to. When its identifier is exactly `mx.cloudflare.net`, the field's value is kept in the column `auth_results`, cut to 2,048 characters; otherwise the column stays empty. The answer of decision 14 gives it back as `authentication`: the identifier and each result written for `spf`, `dkim` and `dmarc`, in order, when the result is a plain lower-case word. The app writes it as a sentence: that Cloudflare Email Routing recorded these results when the message arrived, and that Podbay did not check them itself. There is no tick, no colour and no word such as "verified", it says nothing about who wrote the message, and it appears only under "Show original", where a person goes on purpose. When the column is empty the app says that nothing was recorded.
19. **Two things about that field are fixed by tests before the line is shown to anyone.** The page does not say how `message.headers` gives a field that occurs more than once, so the value is cut at the first comma outside a quoted string or a comment, which the field's grammar never has; a test in the Workers runtime sends a message with a second, forged field and expects only the first, and when the first cannot be told apart nothing is kept. And one message with a forged field of the platform's own identifier is sent to a real domain of the project's test zone, by hand, and what arrives is recorded in the ledger. On a development instance nothing checks authentication and a field the sender wrote is believed; the documents say so.

**Rights, tools, deletion**

20. **Both routes need `mailbox.read`**, as reading a message and downloading an attachment do. Neither needs fresh proof: the original holds what a reader may already read. A person without a membership gets 404. A message that has no original answers 404 with `code: "NO_ORIGINAL"`; a row whose object is not in the bucket answers 404 with `code: "ORIGINAL_MISSING"`, and that is logged with the message's id.
21. **The assistant and MCP get nothing new.** No tool returns the original, its text, `raw_key` or `auth_results`, and no tool downloads. What a tool answers about a message is built from a list of named fields, so that a new column cannot reach a model by accident. `raw_headers` stays in those answers as it is today; taking it out is not decided here.
22. **The original goes with its message.** Moving a message to Trash keeps it. Deleting a message for good deletes its objects, the original among them, and then its rows, in the one function [ADR-0011](0011-drafts-keep-their-files.md) proposes for every path that deletes a message. Deleting a mailbox reads the keys of every original, every attachment and every arrival, deletes the objects 1000 at a time, and only then empties the database. Objects go before rows in both, so a failure leaves rows that can be deleted again and never an object without a row.

**Limits and cost**

23. **Limits:** an original is at most 25 MiB and is written in one `put`; 256 KiB of it are shown; its key is 36 bytes of the 1,024 a key may have. Parsing still happens in the handler, with the message in memory once and its parts beside it, inside the 128 MB of an isolate. On the Free plan storing the bytes is waiting and not computing, so a message whose parsing runs out of CPU time is rescued by decision 9 instead of lost.
24. **Cost:** one write to the bucket for each message that arrives, one read for each time an original is shown or downloaded; deleting is free. A message with files takes about twice the room it takes today: each file is kept decoded as an attachment and encoded inside the original. Ten thousand messages of 100 KB are 1 GB of originals, a cent and a half a month once the free 10 GB are used. Whoever can send mail to a mailbox can fill it, as today; a quota is not decided here.

**Names, migration and how it reads later**

25. **Sticky names, fixed by this record:**

   | Kind | Name |
   |---|---|
   | Columns on `emails` | `raw_key` (text), `raw_size` (integer), `unparsed` (text: empty, `parser`, `too_large` or `interrupted`), `auth_results` (text) |
   | Table | `arrivals`: `id`, `raw_key`, `raw_size`, `envelope_from`, `started_at`, `attempts` |
   | Key shape | `raw/{32 hexadecimal characters}`, after the per-mailbox prefix if one is decided |
   | Routes | `GET …/emails/:id/original` and `POST …/emails/:id/original/download` |
   | Fields | `has_original`, `raw_size` and `unparsed` in a message's answer; `size`, `shown`, `header`, `rest` and `authentication` in the answer of decision 14; `acknowledged` in the request of decision 15 |
   | Codes | `NO_ORIGINAL`, `ORIGINAL_MISSING` |
   | File name | `message-{YYYYMMDD}-{8 characters}.eml` |

26. **Migration.** One migration of the mailbox's database, with the next free number at build time (today's last is `11_message_id_index`; the other proposed records may take numbers first). It adds the four columns and the table and rewrites nothing: every row that exists has an empty `raw_key`. No D1 migration, no binding and no change to the Worker's configuration.
27. **How it will read over JMAP** (phase B, not built here): the original is what an `Email`'s `blobId` stands for, `raw_size` is its `size`, and the time of arrival is `receivedAt`. The id given out is one that the row resolves to the key, never the key itself, which holds a `/`. `headers` in the raw form can be read from the original's header block. Three things do not fit and belong to the JMAP record: `downloadUrl` lets the client name the type and the file name of the answer, which rule S5 does not; it is a GET; and every `Email` has a `blobId`, also a sent message and a draft, for which Podbay has no bytes today. Storing a message from given bytes, which is what importing is, starts at step c.

## What is not decided here

- **Inbound through a queue.** The arrival row and the stored object are what a queue message would point at. The queue changes who runs steps e to g and nothing above.
- **Exports** of a mailbox, and **import**.
- The per-mailbox prefix, storage ids that say nothing for attachments, and the name of the mailbox object.
- Acting on what the platform says about authentication: filing a failure in Spam, or a mark on a message or in a list.
- A file for sent mail, and Podbay building messages itself. Both belong to the queue for outgoing mail and to the JMAP record.
- Parsing again from the original: for a message marked `unparsed`, for an attachment whose object is missing, or after the parser is corrected. The original makes it possible; when and for whom is its own change.
- Keeping only the original and no separate attachment objects (option F).
- A digest of the original in the row, and keeping the envelope with the message. The envelope sender is in `arrivals` only while a message arrives; the envelope is not part of the bytes.
- A quota, a smaller limit for one instance, and removing originals by age.
- A download in parts, and of several messages at once.
- Taking `raw_headers` out of the tools' answers, or out of the row.
- A timer that finishes a left-over arrival in a mailbox that gets no more mail.
- A text larger than a row for a message that is otherwise read. Decision 7 files the whole message as `unparsed`.

## Security: the boundaries it touches

| Boundary | Who, and what they control | What stops them | The test it needs |
|---|---|---|---|
| B1 | Anyone on the internet: every byte of the message, its size up to 25 MiB, any header, a structure made to stop the parser | The mailbox is picked by the envelope before a byte is read. The key is random and holds nothing of the message. The size is exact. Parsing comes after storing and is tried twice at most | A message the parser refuses arrives as `unparsed` and its original equals what was sent, byte for byte. A stream shorter or longer than declared leaves no row and no object. A size over the limit is rejected. The key matches its shape for a message full of path characters. A second `Authentication-Results` field with the platform's identifier is not believed |
| B2 | The sender: what a signed-in reader sees and saves | Never a page: text in a JSON answer, text nodes on the screen. The bytes leave by a POST from the app's origin, as opaque bytes, as a download, under a name Podbay made | In the Workers runtime: the headers of both answers; a GET on the download path gives no bytes; no acknowledgement, another origin and no origin are refused. In a real browser: an original full of markup, script, links and direction marks runs nothing, requests nothing, shows no link, and the file is saved and never opened |
| B4 | A signed-in person: the mailbox and message ids in the path | The guard. The id looks a row up in this mailbox's database. The key comes from the row alone | A non-member gets 404 on both routes and a reader is served. A message id of another mailbox is 404. No answer of any route contains `raw_key` |
| B4 (S13) | Nobody: failures and stopped handlers | A row before bytes; objects before rows when deleting; left-over arrivals picked up | After deleting a message for good and after deleting the mailbox, the bucket holds nothing of it. A handler stopped after each step leaves no object without a row, and the next arrival finishes or removes what was left |
| B5 | A hostile message, through a model or an MCP client | Decision 21 | The tool lists are unchanged. No tool answer contains the original, `raw_key` or `auth_results`, also after the columns exist |

What a stranger can spend is storage in the instance they write to: at most 25 MiB for a message, now about twice. That is true of mail itself.

## Consequences

- A received message's menu gets "Show original" and "Download message", for mail that arrives from then on. Older mail, sent mail and drafts say why they have none.
- A message the parser cannot read is no longer lost, and a handler that is stopped half way no longer loses the message or leaves files nobody can find.
- The row "Authentication results" of the [architecture](../architecture.md) becomes true in its first half: read and shown. Its second half, Spam for a DMARC failure, stays open.
- The bucket grows about twice as fast for mail with files.
- The known gap "files are written to the bucket before their rows" ([status](../status.md), section 3) closes for arriving mail when this is built, and not before; for sent mail it stays with ADR-0011. Deleting a mailbox changes its order.
- The [ledger](../cloudflare/ledger.json) gets the facts marked "No" above, and a note that the platform does not document what a throwing handler tells the sender.
- The work comes in the usual order: the mailbox object (the table, the columns, arrival and deletion) with its tests in the Workers runtime; the handler; the two routes with their rights in the route table; the app; the browser tests; the documents and the ledger. Nothing is built before acceptance.
- Today's instances are development instances. No mail that matters arrives without an original if this is built before the first release.

## Triggers

Look again when one of these is true:

- The record for inbound mail through a queue is written: steps e to g move, and the handler stops holding the message in memory.
- The records for the per-mailbox prefix and for storage ids are accepted: decision 3 says how new keys follow.
- The JMAP record is written: the type and name a client asks for, a `blobId` for sent mail, and a GET.
- An object is found in the bucket that no row names, or a row whose original is not there.
- The platform documents what a handler that throws tells the sending server, or changes how it marks authentication.
- Originals turn out to be most of what a bucket costs, or people ask for a quota.
- People ask for the original of mail they sent.

## Sources

- RFC 5322, "Internet Message Format", sections 2.1 and 2.1.1: `https://www.rfc-editor.org/rfc/rfc5322.txt`, read 2026-11-17.
- RFC 5321, "Simple Mail Transfer Protocol", section 6.1: `https://www.rfc-editor.org/rfc/rfc5321.txt`, read 2026-11-17.
- RFC 8601, "Message Header Field for Indicating Message Authentication Status", sections 2.2, 4.1, 5 and 7.1: `https://www.rfc-editor.org/rfc/rfc8601.txt`, read 2026-11-17.
- RFC 8620, "The JSON Meta Application Protocol (JMAP)", sections 1.2, 6 and 6.2: `https://www.rfc-editor.org/rfc/rfc8620.txt`, read 2026-11-17.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", sections 4.1.1, 4.1.2.1, 4.1.3 and 4.8: `https://www.rfc-editor.org/rfc/rfc8621.txt`, read 2026-11-17.
- RFC 2046, "Multipurpose Internet Mail Extensions (MIME) Part Two: Media Types", section 5.2.1: `https://www.rfc-editor.org/rfc/rfc2046.txt`; RFC 6532, "Internationalized Email Headers", section 3.7: `https://www.rfc-editor.org/rfc/rfc6532.txt`; RFC 6266, "Use of the Content-Disposition Header Field in the Hypertext Transfer Protocol (HTTP)", section 4.2: `https://www.rfc-editor.org/rfc/rfc6266.txt`; all read 2026-11-17.
- Cloudflare, Email Service, the Workers API for routed mail (page dated 2026-11-17): the message object, `raw`, `rawSize`, `headers`, `setReject`, authentication results: `https://developers.cloudflare.com/email-service/api/route-emails/email-handler/`, read 2026-11-17.
- Cloudflare, Email Service limits (page dated 2026-10-30): the inbound size, the handler on the Free plan: `https://developers.cloudflare.com/email-service/platform/limits/`, read 2026-11-17.
- Cloudflare, Email Service, postmaster (page dated 2026-10-30): mail that fails SPF and DKIM, DMARC policies: `https://developers.cloudflare.com/email-service/reference/postmaster/`, read 2026-11-17.
- Cloudflare, Email Service, email headers (page dated 2026-11-11): the headers the sending service makes itself: `https://developers.cloudflare.com/email-service/reference/headers/`; the Workers API for sending (page dated 2026-11-17): `https://developers.cloudflare.com/email-service/api/send-emails/workers-api/`; both read 2026-11-17.
- Cloudflare, Email Service, testing routing locally (page dated 2026-10-15): `https://developers.cloudflare.com/email-service/observability/local-development/routing/`, read 2026-11-17.
- Cloudflare, R2 Workers API reference (page dated 2026-11-04): `put` and a stream of known length, `get` with a range, 1000 keys in a delete, strong consistency: `https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`, read 2026-11-17.
- Cloudflare, R2 limits (page dated 2026-10-30): key length, upload size: `https://developers.cloudflare.com/r2/platform/limits/`; R2 pricing (page dated 2026-10-30): `https://developers.cloudflare.com/r2/pricing/`; both read 2026-11-17.
- Cloudflare, Workers, `TransformStream` (page dated 2026-04-23): `FixedLengthStream`: `https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/`, read 2026-11-17.
- Cloudflare, Workers limits (page dated 2026-11-13): CPU time, memory: `https://developers.cloudflare.com/workers/platform/limits/`; Durable Objects limits (page dated 2026-11-13): the size of a row: `https://developers.cloudflare.com/durable-objects/platform/limits/`; both read 2026-11-17.
- The repository: `workers/app.ts` (the `email` handler), `workers/index.ts` (`receiveEmail`, the send, delete and attachment routes), `workers/lib/inbound.ts`, `workers/lib/attachments.ts`, `workers/lib/filenames.ts`, `workers/email-sender.ts`, `workers/routes/reply-forward.ts`, `workers/routes/mailboxes.ts`, `workers/durableObject/index.ts` (`createEmail`, `deleteEmail`, `purge`) and `migrations.ts`, `workers/lib/tools.ts`, `workers/auth/route-table.ts`, `shared/attachment-risk.ts`, `shared/security-headers.ts`, `app/components/email-panel/EmailPanelDialogs.tsx`, and the types of the mail parser in use.
