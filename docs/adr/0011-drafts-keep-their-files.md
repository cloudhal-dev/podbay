# ADR-0011: A draft keeps its files

- Status: **Proposed** (awaits the project lead)
- Date: 2026-11-17
- Sources: read on 2026-11-17 and listed at the end. Each quoted finding was read in the standard's or the vendor's own text on that day.

## Context

A person can attach files while writing. The files live in the compose window and travel inside the send request, as base64 in its JSON. What is written is saved as a draft every few seconds, but the draft does not keep the files, and the window says so: "Files are sent with the message. A draft does not keep them." Closing the window, the tab or the laptop loses them. In the mail people know from Gmail and Google Workspace a draft keeps its files, on every device. The [roadmap](../roadmap.md) (section 4, row 3) lists "files kept in a draft" as still missing and says it needs the Worker and a record.

It is a decision because it adds routes other programs call, changes the save and the send request, adds a column to the mailbox's database, and touches four trust boundaries: attachments (B2), per-mailbox authorisation and deletion (B4), the assistant and MCP (B5) and the sender (B6). It moves no scope: compose with attachments is phase A in the [feature matrix](../feature-scope.md#3-feature-matrix).

What the answer has to respect, whatever it is:

1. **An attachment is a download** (S5), also when the person who downloads it is not the person who put it there.
2. **No storage key from input** (S2). A file's name is text someone typed or a stranger sent.
3. **Deletion deletes** (S13). Nothing may stay in the bucket that no row of a mailbox names.
4. **Deny by default in one table** (S1), and a non-member is told nothing.
5. **The assistant and MCP cannot send alone** (S9). A draft is all they leave, and a person sends it.
6. **One sender check, and the sending limits that exist** (S8, `shared/sending-limits.ts`): 25 MiB for the message, 18 MiB of files, 50 recipients.
7. **No account credential in the Worker** (S14): bindings only.
8. **JMAP in phase B** ([ADR-0001](0001-founding-decisions.md), decision 10). What is stored should be what a mail app will ask for.

## Findings

### What the code does today

- **Files of received and sent mail** are bytes in the bucket under `attachments/{message id}/{attachment id}/{file name}` and a row each in the table `attachments` of the mailbox's database (`id`, `email_id`, `filename`, `mimetype`, `size`, `content_id`, `disposition`). The row goes when its message goes. The name passes `storageFilename` before it is part of a key.
- **They are served** by two routes that need `mailbox.read`: a link for an ordinary file, and a POST from the app's own origin that says `acknowledged` for one that `attachmentRisk` names. Both answer with `Content-Disposition: attachment`, `nosniff` and a type the sender did not choose.
- **They are deleted** with their message by the route that deletes one message, and with their mailbox by `purge`, which reads the keys from the rows.
- **A draft is a message in the place Drafts. It does not keep its id.** Every save deletes the draft and makes a new one with a new id; MCP's `update_draft` does the same. Nothing can be tied to a draft until that changes. Until 2026-11-17 neither looked where the message it replaced was; that was found while writing this record and corrected the same day: both now replace a draft and nothing else.
- **Sending** makes a new message in Sent from the request, files included, and the app then deletes the draft with a second request.
- **A forward** has the browser download each file of the original and send it up again. A file that can do harm is left behind, because the browser cannot fetch it without the reader's word.
- **The draft tools** of the assistant and of MCP (`workers/lib/tools.ts`) make drafts without files. No tool takes or gives the bytes of a file.

### The standard Podbay will speak (JMAP)

- Bytes are uploaded apart from the message and then named by an id, which "solely represents the raw bytes of data"; the name and the type belong to whatever refers to it (RFC 8620, section 6; RFC 8621, section 4.1.4).
- An upload answers with `blobId`, `type` and `size` (RFC 8620, section 6.1). A draft is made with `Email/set`, where a part "may specify a partId OR a blobId" (RFC 8621, section 4.6).
- A file that is already in the account is attached again "without having to download and upload it again" (RFC 8620, section 6).
- An upload nothing refers to "MAY be deleted by the server", but not "for at least 1 hour", and until then is "accessible to the uploader" only, "even in shared accounts" (RFC 8620, sections 6 and 6.1).
- The server states its limits: `maxSizeUpload` for one upload (RFC 8620, section 2) and `maxSizeAttachmentsPerEmail` for one message (RFC 8621, section 1.3.1).
- Sending keeps the message: the standard's example sends a saved draft and then "moves it from the drafts folder" to the sent one, under the same id (RFC 8621, section 7.5.1).
- A message's subject and recipients cannot be changed there, so a mail app changes a draft by making a new one that names the same ids and destroying the old one (RFC 8621, sections 4.1.3 and 4.6).

### The platform

Read on 2026-11-17; the ones the [ledger](../cloudflare/ledger.json) does not hold yet are entered with the build.

- **A request body** to a Worker is limited by the plan of the domain, not of the Worker: "request body size limits depend on the domain's Cloudflare plan". It is 100 MB on Free and Pro. One file of a message fits in one request on every plan.
- **An isolate has 128 MB**, and a request on the Free plan has 10 ms of CPU time; waiting on the network does not count. Megabytes should pass through the Worker as a stream and not be decoded in it.
- **The bucket takes a stream**, but "its length must be known: for example, a request body with a `Content-Length` header".
- **The bucket binding** has `head`, `get`, `put`, `delete`, `list` and the multipart calls. It has no copy and no rename, so a copy is a read and a write inside the Worker. It "cannot generate presigned URLs"; signing one needs the bucket's API credentials.
- **Keys and objects**: a key is at most 1,024 bytes; one upload may be 5 GiB, so no multipart is needed here; one `delete` takes many keys ("Up to 1000 keys may be deleted per call"); writes and deletes are "strongly consistent".
- **Expiring objects by a bucket rule** "requires an API token". The Worker cannot set one.
- **The mailbox's database** holds a string, a blob or a row of at most 8 MB. A file cannot live there.
- **The sending service** takes 25 MiB for the whole message and refuses when the "`attachments` array exceeds 32 entries". The content of a file may be a base64 string or bytes. Podbay checks the size today and not the count.
- **Subrequests**: 50 for a request on the Free plan. The page does not say plainly whether a call to the bucket counts against that number or against the larger one for internal services; the numbers below hold under the smaller.

## Options

How a file gets to the draft:

| | Option | For | Against |
|---|---|---|---|
| A | **Nothing**: files live in the window, as today | Nothing to build | The gap stays |
| B | **Keep them in the browser's own storage** until the message is sent | No change to the Worker | They exist on one device and in one browser, and not in a private window. That is not a draft keeping its files. A forward still downloads and uploads |
| C | **Send the files with every save**, as base64 in its JSON | One route | The save runs every few seconds: megabytes travel again and again, or the save needs a second protocol to say what changed. The text waits behind the bytes. Decoding costs CPU time the Free plan does not have |
| D | **The browser uploads straight to the bucket** with a signed address | The bytes never pass the Worker | Signing needs the bucket's API credentials inside the Worker (S14). The Worker could no longer hold the size and the right while the bytes arrive |
| E | **Upload first, free-standing, then refer to it by id**: the standard's shape | What JMAP does | An upload exists before any draft. It needs a holding place, a quota of its own, access for the uploader only and a timer that removes what is never referred to. A second table for one feature |
| F | **Upload into the draft**: a file is a row of its draft from the first moment, in the table every message's files are in | One table, one key shape, one set of download routes, one deletion. The bytes travel once, as a stream. Nothing is ever free-standing | The draft must exist first and must keep its id, which it does not today. Two requests for a file |

Where the stored file lives:

| | Option | For | Against |
|---|---|---|---|
| G | **A place of its own** for draft files (a table, a key prefix) | Draft files are easy to tell apart | Sending must move them. The bucket has no rename and the binding no copy, so each file is read and written again, and a failure in the middle leaves two half sets |
| H | **The draft's own attachments**, and the draft becomes the sent message | Nothing moves when the message is sent: same row, same key. It is what the standard's example does | Sending changes a row instead of adding one |

## Decision (proposed)

Options F and H.

1. **A draft keeps its id for its whole life.** `POST …/drafts` makes a draft. `PUT …/drafts/:draftId` saves over it in place. A save changes a message only when it is in Drafts; anything else answers 404. The `draft_id` field of the `POST` body goes. MCP's `update_draft` changes the draft in place as well and answers with the same id.
2. **A draft's file is an attachment of the draft**: a row in `attachments` with the draft's id, and bytes in the bucket under the key shape every message uses. There is no second table and no second key shape. The key is built from the stored row alone, never from an id in the request.
3. **A file is uploaded once, into its draft, in two steps.** First the app declares it: `POST …/drafts/:draftId/attachments` with `{ filename, type, size }`. The Worker checks the limits before a byte travels, makes the row, and answers with the file's id and the name as it is stored. Then the bytes: `PUT …/drafts/:draftId/attachments/:attachmentId`, the file as the body, with a `Content-Length` equal to the declared size. The Worker hands the body to the bucket as a stream and marks the row stored. The name is never in a URL or a header: a file name is part of someone's mail.
4. **A file belongs to the draft once its bytes are stored.** Reading a draft, listing Drafts, searching and the tools show stored files only.
5. **The save that runs by itself carries text only** and never touches a file. Attaching a file to a message that has no draft yet saves the draft first. `DELETE …/drafts/:draftId/attachments/:attachmentId` removes one file, its row and its object.
6. **Limits**, held to what a message being sent may carry, so that a draft can always be sent as it stands: the files of a draft are 18 MiB together (`MAX_ATTACHMENTS_BYTES`, unchanged); one file may be all of it and has at least one byte; a draft holds 32 files, the sending service's number, which joins `shared/sending-limits.ts` and is checked when sending too; a file name is at most 255 bytes, a type at most 255 characters. The app says so while the person writes and the Worker enforces it.
7. **What the Worker refuses, and how:**

   | Case | Answer |
   |---|---|
   | Not a member of the mailbox | 404, from the guard, as everywhere |
   | A member who may only read | 403, from the guard |
   | The draft is not there, or the message is not in Drafts; the file is not one of this draft | 404 |
   | No name, a name or type that is too long, a size that is not a whole number from 1 | 400 |
   | The file, alone or with the draft's other files, is more than 18 MiB | 413, `code: "DRAFT_FILES_TOO_LARGE"`, at the declaration, before the bytes |
   | The draft already holds 32 files | 409, `code: "DRAFT_TOO_MANY_FILES"` |
   | Bytes without a `Content-Length` | 411 |
   | A `Content-Length` other than the declared size | 400; nothing is stored |
   | Bytes for a file that is already stored | 409; what was stored stays as it was |

8. **Sending.** The send request names the draft: `draft_id`, on `POST …/emails`, `…/emails/:id/reply` and `…/emails/:id/forward`. The text and the recipients come from the request, as today. The files are the draft's stored files, read from the bucket by the Worker; the `attachments` array of the send request goes, so files reach a message in one way. The draft's row then becomes the sent message: one transaction in the mailbox object moves it to Sent and writes what was sent. It keeps its id, so its files keep their rows and their keys. Nothing is uploaded twice, nothing is copied, and no draft is left to delete. The right is `mailbox.send`; the sender check, the caps and the limits of decision 6 are the ones every send goes through. A message without files can still be sent without a draft.
9. **Discarding.** Deleting a draft is deleting a message: its rows and its objects go, stored or not. One function does this for every path that deletes a message: the route, the assistant's `discard_draft`, the deletion of a mailbox, and the emptying of [ADR-0009](0009-emptying-trash-and-spam.md) if that record is accepted.
10. **A draft that is left is a draft.** It and its files stay until a person deletes it. Nothing removes drafts by age.
11. **Unfinished files.** A declared file whose bytes did not arrive within an hour is removed, with whatever is under its key, the next time that draft's files change. When the draft is sent, a file that is not stored is not part of the message and is removed, whatever its age; when the draft is deleted, everything goes. Because the row is written before the bytes, nothing of a draft is ever in the bucket without a row that names it, and the mailbox needs no timer for this.
12. **A forward copies inside the account.** `POST …/drafts/:draftId/attachments/copy` with `{ emailId, attachmentIds, acknowledged? }` copies files of another message of the same mailbox into the draft: the Worker makes the row, reads the object and writes it under the draft, and the bytes never reach the browser. Name and type are taken from the source row, never from the request. At most 16 files in one request: two calls to the bucket for a file, under the Free plan's 50. It answers with the files it copied and, for each it left, why: `risk`, `size`, `count` or `missing`. A file that can do harm is copied only when the request says `acknowledged: true`, which the app sends after the person agreed, as for a download.
13. **Rights.** Declaring, uploading, copying and removing a file need `mailbox.write`, as saving a draft does. Downloading a draft's file needs `mailbox.read` and uses the two attachment routes that exist. Sending needs `mailbox.send`. None needs fresh proof. In a shared mailbox a draft and its files are the mailbox's: every member who can read sees them, as they see a draft's text today.
14. **The assistant and MCP get no tool for files.** No tool uploads, copies or removes a file: the copy is exactly what a hostile message would ask a model for, a file of the mailbox put into a draft that a person then sends. They see the names, types and sizes of a draft's files, as of any message's. A tool changes or discards a draft (MCP's `update_draft`, the assistant's `discard_draft`) only while it holds no files; a draft a person gave files to is that person's, and a tool that could change its recipient would be one click away from sending those files to a stranger. Rule S9 is unchanged: no tool sends, and the window shows the files of a draft before a person sends it.
15. **Rule S5 goes by the row, not by who put it there.** A person's own file is served like any attachment: as a download, with `nosniff`, with a type from the inert list, and through the acknowledged POST when `attachmentRisk` names it. The name and the type a person declares are input like a sender's: the name passes `storageFilename`, the type is stored and never served as it is. A risky file is marked in the compose window and is sent if the person sends it.
16. **Sticky names, fixed by this record:** the column `uploading_since` on `attachments` (empty for a stored file, the time of the declaration until then); the routes `PUT …/drafts/:draftId`, `POST …/drafts/:draftId/attachments`, `PUT` and `DELETE …/drafts/:draftId/attachments/:attachmentId` and `POST …/drafts/:draftId/attachments/copy`; the field `draft_id` of the three send requests; the two codes of decision 7 and the four reasons of decision 12. Removed: `draft_id` in the body of `POST …/drafts`, and `attachments` in the send request. The key shape `attachments/{message id}/{attachment id}/{file name}` is kept as it is, and a file keeps its key from the upload to Sent.
17. **Migration.** One migration of the mailbox's database, with the next free number at build time (today's last is `11_message_id_index`; ADR-0008 and ADR-0010 may take numbers first). It adds the column and an index on `attachments.email_id`, which the table lacks today. It rewrites nothing: every row that exists is a stored file. No D1 migration, no binding and no change to the Worker's configuration.
18. **How it will read over JMAP** (phase B, not built here): a file's id is its `blobId`; name, type, disposition and content id are on the part. `maxSizeUpload` and `maxSizeAttachmentsPerEmail` are both 18 MiB. A draft that is sent keeps its id on the way to Sent, as in the standard's example. Two things do not fit and belong to the JMAP record: an upload there is made before any draft and is the uploader's alone for an hour, and a mail app changes a draft by making a new one that names the old one's files.

## What is not decided here

- Pictures placed in the text of a message being written. The columns for it exist (`disposition`, `content_id`); the editor and the renderer need their own look.
- Files larger than a message can carry, uploads that resume, and a link in place of a file.
- Sending a stored draft by its id alone, and what a failed send leaves behind. Both belong to the queue for outgoing mail (milestone 3), which this record makes possible: a queue message cannot carry a file.
- Whether the Worker hands a file to the sending service as base64 or as bytes. The local simulation takes only base64.
- Storage ids that say nothing (milestone 3). A draft's files change with every other file then.
- A sweep for objects in the bucket that no row names. Older paths write the bytes before the row; finding what they left needs the per-mailbox prefix of milestone 3.
- A quota for a mailbox, drafts of a person's own in a shared mailbox, and a record of who uploaded a file.
- Two windows that write the same draft at once. The last save wins, as today.
- Looking inside a file. Podbay does not scan ([feature scope](../feature-scope.md#5-out-of-scope-and-why)).

## Security: the boundaries it touches

| Boundary | Who, and what they control | What stops them | The test it needs |
|---|---|---|---|
| B2 | Another member of a shared mailbox, or the stranger whose file was forwarded: the bytes, the name, the declared type | Decision 15: a download, a type that was not chosen, the acknowledged POST | Each risky kind uploaded and copied into a draft is refused to a link; a copy without the acknowledgement leaves it |
| B4 | A signed-in person: the mailbox, draft, message and file ids in the path and the body; the size they declare | The guard; ids only look rows up in the mailbox's own database; the key comes from the row; decisions 6, 7 and 11 | A non-member gets 404 and a reader 403 on every new route; a file id of another draft or mailbox is 404; a longer body than declared stores nothing; a save or a send that names a message outside Drafts is 404 |
| B4 (S13) | Nobody: failures and closed tabs | Row before bytes; one deletion; decisions 9 and 11 | After discarding, after sending and after deleting the mailbox, the rows and the bucket hold exactly what they should; an unfinished file is gone after the hour |
| B5 | A hostile message, through a model or an MCP client | Decision 14 | The tool lists have no file tool; `update_draft` and `discard_draft` refuse a draft with files and anything outside Drafts |
| B6 | A member who may send: the draft named in the request | `mailbox.send`; the draft is looked up in this mailbox; one sender check; decision 6 again when sending | A draft of another mailbox cannot be named; a draft with 33 files or more than 18 MiB is refused before anything is sent |

What a member who may write can spend is storage in their own instance: 18 MiB for a draft, and any number of drafts. That is true of mail itself, and a quota is not decided here.

## Consequences

- The line "A draft does not keep them" goes. A file shows its progress while it is uploaded and is then part of the draft: closing the window keeps it, and opening the draft anywhere shows it.
- Sending no longer carries megabytes in a JSON body, and the app no longer deletes the draft after sending.
- A forward no longer moves the original's files through the browser, and can carry a file that can do harm when the person says so.
- The assistant and an MCP client can no longer change or discard a draft once a person has attached a file to it.
- The work comes in the usual order: the mailbox object (a draft that keeps its id, the column, the one deletion) with its tests in the Workers runtime; the routes with their rights in the route table; sending from a draft; the tools; the app; the browser tests; the documents and the ledger. Nothing is built before acceptance.
- Today's instances are development instances. Removing two fields from two requests is cheapest now.

## Triggers

Look again when one of these is true:

- The queue for outgoing mail is taken up: sending should then name the draft and nothing else.
- The JMAP record is written: uploads without a draft, and drafts replaced by a mail app.
- People ask the assistant to work on drafts that hold files.
- An object is found in the bucket that no row names, or a draft's file is found that cannot be downloaded.
- The sending service changes what a message may carry.

## Sources

- RFC 8620, "The JSON Meta Application Protocol (JMAP)", sections 2, 6 and 6.1: `https://www.rfc-editor.org/rfc/rfc8620.txt`, read 2026-11-17.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", sections 1.3.1, 4.1.3, 4.1.4, 4.6 and 7.5.1: `https://www.rfc-editor.org/rfc/rfc8621.txt`, read 2026-11-17.
- RFC 9110, "HTTP Semantics", sections 15.5.10 (409), 15.5.12 (411) and 15.5.14 (413): `https://www.rfc-editor.org/rfc/rfc9110.txt`, read 2026-11-17.
- Cloudflare, Workers limits (page dated 2026-11-13): request body by plan, memory, CPU time, subrequests: `https://developers.cloudflare.com/workers/platform/limits/`, read 2026-11-17.
- Cloudflare, R2 Workers API reference (page dated 2026-11-04): the bucket methods, a stream of known length, 1000 keys in a delete, strong consistency: `https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`, read 2026-11-17.
- Cloudflare, R2 limits (page dated 2026-10-30): key length, upload size: `https://developers.cloudflare.com/r2/platform/limits/`, read 2026-11-17.
- Cloudflare, R2 presigned URLs (page dated 2026-11-12): `https://developers.cloudflare.com/r2/api/s3/presigned-urls/`, read 2026-11-17.
- Cloudflare, R2 object lifecycles (page dated 2026-10-26): `https://developers.cloudflare.com/r2/buckets/object-lifecycles/`, read 2026-11-17.
- Cloudflare, Durable Objects limits (page dated 2026-11-13): `https://developers.cloudflare.com/durable-objects/platform/limits/`, read 2026-11-17.
- Cloudflare, Email Service, the Workers API for sending (page dated 2026-11-17): the attachment shape and the error for more than 32 attachments: `https://developers.cloudflare.com/email-service/api/send-emails/workers-api/`; its limits (page dated 2026-10-30): `https://developers.cloudflare.com/email-service/platform/limits/`; both read 2026-11-17.
- The repository: `workers/index.ts` (the send, draft, delete and attachment routes), `workers/routes/reply-forward.ts`, `workers/lib/attachments.ts`, `workers/lib/filenames.ts`, `workers/lib/tools.ts`, `workers/lib/schemas.ts`, `workers/durableObject/index.ts` and `migrations.ts`, `workers/auth/route-table.ts`, `shared/attachment-risk.ts`, `shared/sending-limits.ts`, `app/hooks/useComposeForm.ts`.
