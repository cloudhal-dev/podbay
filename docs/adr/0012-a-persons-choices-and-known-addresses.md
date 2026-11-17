# ADR-0012: A person's choices are kept with their account, and a mailbox remembers the addresses it has written to

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each finding about a standard or about Cloudflare was read in its own text on that day. Nothing of this record is built.

## Context

The mail screens were compared with the mail people know from Gmail and Google Workspace ([roadmap](../roadmap.md), section 4). Two things there are kept by the server and here only by one browser.

1. **A person's choices.** The app keeps thirteen choices in the browser under `podbay.display` (`app/hooks/useDisplay.ts`) and a fourteenth, the collapsed rail, under `podbay.rail` (`app/hooks/useUIStore.ts`). Another browser or another device starts from the defaults. The roadmap says of them: "giving them a home on the server needs an ADR".
2. **Addresses while writing.** The address field completes from the lists this browser has already loaded (`app/hooks/useKnownAddresses.ts`). A person who wrote to someone last month gets no suggestion unless that message is on screen. The roadmap names "an address book that knows more than the loaded lists" as missing.

It is a decision because it adds two persisted formats (a table in the accounts database, a table in the mailbox's database), routes, and a step on the path of outgoing mail (boundary B6). The [feature matrix](../feature-scope.md#3-feature-matrix) has "Contacts: an address book" in phase B, and a phase B feature is not pulled forward without a record; this record says what is and is not pulled forward.

What the answer has to respect:

1. **Managing is not reading** (S1, S10). An owner or administrator manages accounts. What a person chose for their own screens is not theirs to see or set.
2. **The accounts database holds no mail.** `migrations/0002_index.sql` says so, and its audit table holds "never an address of a correspondent".
3. **A mailbox is the unit** of isolation, export and deletion, and deletion deletes (S13).
4. **Mail is hostile bytes** (S3). What a stranger sends must not teach a mailbox anything.
5. **Schema first, additive migrations** (D2, D3), for D1 and for the mailbox's database.
6. **JMAP in phase B** ([ADR-0001](0001-founding-decisions.md)). What is stored should be what the standards for contacts will ask for.

## Findings

### What the code has today

- `Choices` has thirteen keys. `readChoices` is lenient: a stored value it does not know becomes the default. The file says the choices are "never something the Worker decides by", and that is true: the Worker never sees them.
- A mailbox already has settings on the server: `mailboxes.settings`, one JSON text with a `rev` column, holding the name, the signature and the assistant's prompt. `PUT …/mailboxes/:mailboxId` accepts any record of keys under 16 KiB, replaces the whole value, and raises `rev` without comparing it. So "one JSON document in a column" exists, but without a schema and without protection against two saves at once.
- "The signed-in person themself" is expressed by the right `session` and a handler that takes the person from the session only: `/api/v1/me`, `/api/v1/keys`. No person id is in the path, so there is nothing to point at someone else.
- Every table of a person refers to `user` with `on delete cascade`. No route deletes an account today.
- The mailbox object knows no person: there is no account id anywhere in its database.
- A message is stored in Sent by three routes (send, reply, forward), each through `createEmail` of the mailbox object. Their bodies carry recipients as bare addresses; only `from` may carry a name. A message goes to at most 50 recipients (`shared/sending-limits.ts`).
- `useKnownAddresses` reads the sender, recipient, Cc and participants of every list loaded for the mailbox. Until 2026-11-17 it read them whatever the place, so mail in Spam that was on screen was offered too; that was found while writing this record and corrected the same day: Spam and Trash are left out.

### The standards for contacts

- JSContact (RFC 9553) is a JSON model for "contact card information". A `Card` has a mandatory `uid`, a `kind` (`individual`, `group`, `org` and others), a `name`, and `emails`: a map of `EmailAddress` objects, each with a mandatory `address`, and optional `contexts`, `pref` and `label`. A group is a card whose `members` are the `uid`s of other cards. A product may add its own property only under a name that starts with a domain it controls (section 1.8.1). The model has no property for how often or how recently an address was used.
- JMAP for Contacts (RFC 9610) carries those cards. An `AddressBook` is "a named collection" of cards, a `ContactCard` is a JSContact card plus `id` and `addressBookIds`, and each card "belongs to one or more AddressBooks". Sharing is "managed per AddressBook", with `mayRead`, `mayWrite`, `mayShare` and `mayDelete`. Its security section calls contacts "private, personally identifiable information".
- JMAP's address form in mail (RFC 8621, section 4.1.2.3) is a `name` that may be null and an `email`.

### JMAP has no object for a client's settings

RFC 8620 defines the session, the standard methods, binary data and push. RFC 8621 defines Mailbox, Thread, Email, SearchSnippet, Identity, EmailSubmission and VacationResponse. Neither defines a data type for how a client looks or behaves. The one mention is in Identity, whose signature a client may combine with a "client-specific signature preference" (RFC 8621, section 6): the standard leaves such preferences to the client. So there is no standard shape to follow for part A, and no mail app will ask for it.

### The platform

- D1 enforces foreign keys "within all queries and migrations", so a row that refers to `user` with `on delete cascade` goes with the account.
- D1 limits: a string or a row is at most "2,000,000 bytes (2 MB)"; a database is "10 GB (Workers Paid) / 500 MB (Free)"; a Worker invocation makes at most "1000 (Workers Paid) / 50 (Free)" queries. Statements in a batch are "SQL transactions".
- D1 has the SQLite JSON functions built in. `json_patch` merges a patch "into the target JSON object".
- A mailbox's database is SQLite in one Durable Object: "10 GB on Workers Paid, or 1 GB on the Free plan" for each object, 100 bound parameters in a query, and a `LIKE` pattern of at most "50 bytes". The last one matters: completing what is typed must not be built as a pattern.

## Options

### A. Where a person's choices live

| | Option | For | Against |
|---|---|---|---|
| A1 | **In the browser only**, as today | Nothing to build. Nothing about a person on the server | The gap stays |
| A2 | **Per person and per mailbox**, in the mailbox's database | Close to the mail | Line height is not a fact about a mailbox. A person with three mailboxes would choose three times. The mailbox object would have to learn who people are, which it does not know today |
| A3 | **Per person in the accounts database, a column for each choice** (or extra fields on Better Auth's `user`) | The database checks each value | A migration for every new choice, and migrations only add. Extra fields on `user` change a generated table and travel in every session answer |
| A4 | **Per person in the accounts database, one versioned document** checked by a schema | One migration, once. A new choice is a change to the schema both sides share. Matches how a mailbox's settings are kept | The database does not check the values; the schema must. Needs a rule for values it does not know |

### B. Whose the known addresses are, and where they come from

| | Option | For | Against |
|---|---|---|---|
| B1 | **The browser's loaded lists**, as today | Nothing to build | The gap stays |
| B2 | **The person's, in the accounts database** | One set across a person's mailboxes. Private from other members | Correspondents' addresses would enter the database that holds none (constraint 2). They would not go with the mailbox when it is deleted, and would stay with a person who lost their membership |
| B3 | **The person's, inside each mailbox's database** | Private between members | The mailbox object must learn who people are. Someone who joins a shared mailbox starts with nothing, in the one place where shared memory helps most. Hides nothing: every member can read Sent |
| B4 | **The mailbox's, learned only from mail a person sent from it** | Lives and dies with the mailbox. Nothing a stranger sends can add to it. Reveals nothing a member cannot already read in Sent | Members share it. An address stays known after its message is deleted, until it is forgotten |
| B5 | **Learned from received mail as well** | Fuller, sooner | Anyone can plant an address, and a name beside it, by sending mail (constraint 4) |
| B6 | **A full address book now**: people with several addresses, groups, import and export | The complete answer | Phase B work with its own model, rights, screens and JMAP mapping. Not needed to complete an address |

## Decision

Options A4 and B4.

### A person's choices

1. **They are kept per person, in the accounts database**, in a new table `user_choices`: `user_id` (primary key, refers to `user`, `on delete cascade`), `choices` (JSON text), `rev` (integer) and `updated_at`. It is Podbay's own table; the generated Better Auth migration is not touched.
2. **One versioned document that holds only what the person chose**: `{ "v": 1, … }`. A key that is absent means the default of the running version, so a default is not a choice and can change for people who never chose. Every value comes from a closed list or is yes or no. No choice is free text.
3. **One schema, shared by the Worker and the app, strict when writing and lenient when reading.** A request with a key or a value the schema does not know is refused whole. A stored value that is no longer known reads as the default, as `readChoices` does today. A stored key the running version does not know is left in the document and is not sent to the app, so going back a version loses nothing. A document with a higher `v` than the Worker knows reads as the defaults and is not written.
4. **Ten choices travel with the person, four stay with the device.** A choice stays when its right value depends on the device: the room on its screen, or a permission its browser gave.

   | Choice | Key | Where | Why |
   |---|---|---|---|
   | Conversations on a page | `pageSize` | Person | A habit, not a screen |
   | What Reply does | `defaultReply` | Person | A habit |
   | Where to go after filing | `afterFiling` | Person | A habit |
   | Single keys as shortcuts | `shortcuts` | Person | A habit; harmless without a keyboard |
   | Light or dark | `appearance` | Person | `system` already means "as this device" |
   | Language | `language` | Person | `system` already means "as this device" |
   | Conversation view | `conversationView` | Person | A way of reading |
   | Snippets | `snippets` | Person | A way of reading |
   | Actions on a line | `hoverActions` | Person | A habit; does nothing without a pointer |
   | Send and archive | `sendAndArchive` | Person | A habit |
   | Line height | `density` | Device | A phone and a wide screen want different ones |
   | Reading pane | `readingPane` | Device | Needs room; a small screen has none |
   | The collapsed rail | (`podbay.rail`) | Device | Room on this screen |
   | Notifications | `notifications` | Device | The permission belongs to this browser |

5. **The browser's copy is a cache for the first paint.** The app draws from it at once, as today, so the language and the appearance hold before anything is asked. Then it reads the server's document, and for the ten travelling choices **the server wins**. The copy says whose it is: when someone else signs in on the same browser, their document replaces the travelling part.
6. **A change applies at once and is then sent.** The request carries only the keys that changed; `null` takes a choice back to its default. The Worker merges it into the stored document in one atomic write and answers with the whole document and its `rev`. Two devices that change different choices both keep theirs. Two that change the same choice: the later write wins. A change that could not be sent (offline, an error) stays in force on that device, is remembered as unsent, and is sent at the next contact, where it is then the last write.
7. **Another device learns of a change when it loads the app or comes back to the tab.** Nothing is pushed.
8. **The first browser to sign in after this is built brings its choices along.** When the server has no document for the person, the app sends what differs from the defaults in its own copy, once.
9. **Routes:** `GET /api/v1/me/choices` and `PUT /api/v1/me/choices`, with the right `session`. The person is taken from the session and from nowhere else: no account id in the path, the query or the body. The body is at most 4 KiB. No fresh proof, and no audit row: nothing here gives or takes access.
10. **Nobody else reads or sets them.** There is no route by which an owner or an administrator reaches another person's choices, the list of people does not carry them, a program key does not reach them, and neither the assistant nor MCP has a tool for them.
11. **The Worker stores choices and never acts on them.** It decides nothing by them: not access, not what a list returns, not what is sent. A choice the Worker would act on needs its own record.
12. **Recovery leaves them; removing the account removes them.** A recovery link replaces how a person signs in, and choices are not that. When an account is deleted its row goes with it, by the foreign key. No route deletes an account today, and this record adds none.

### Known addresses

13. **They are the mailbox's**, kept in the mailbox's own database. Everyone who may write from a shared mailbox is offered the same addresses.
14. **A mailbox learns an address only when a person sends mail from it**: when the send, reply or forward route stores a message in Sent, every address in its To, Cc and Bcc is recorded, except the mailbox's own. Nothing is learned from received mail, from a draft, from mail the Worker sends by itself (the automatic reply of [ADR-0008](0008-rules-for-incoming-mail.md), if that record is accepted), or from anything the assistant or MCP does.
15. **What is kept for an address:** the address in lower case, once; a name, which may be absent; how many messages went to it; when it was last used; when it was first recorded. Nothing of any message.
16. **The name is the one the outgoing message gave its recipient**, never one taken from received mail by the Worker. Today the sending routes take bare addresses, so names stay empty until those bodies may carry a recipient's name in the shape `from` already has; that change is small and additive, and is the lead's to include or leave out. A suggestion always shows the whole address; a name never stands in for it.
17. **The mailbox object records them in the call that stores the sent message**, so no sending route can be missed. Recording cannot fail a send: an address that cannot be recorded is skipped and counted.
18. **One route completes what is typed:** `GET …/known-addresses?q=`. It needs `mailbox.write`: completing an address is part of writing, and a reader does not write. It answers with at most 8 entries, each an opaque id, the address and the name, best first: more used, then more recent.
19. **It completes; it does not list.** `q` is 1 to 64 characters and must begin the address, the part after the `@`, or the name. It is compared as text without regard to case and is never put into a pattern, so nothing typed is a wildcard and the 50-byte limit of a pattern never applies. There is no empty query, no paging, no offset, no total and no "more". The answer carries no count and no date. No tool of the assistant or of MCP calls it.
20. **Forgetting.** A person forgets one address from its suggestion: `DELETE …/known-addresses/:knownId`, right `mailbox.write`. An owner forgets them all: `DELETE …/known-addresses`, right `mailbox.manage`, recorded in the audit log by the mailbox and never by an address. An address not used for two years is forgotten at the next send. Above the limit the least recently used go first. Deleting the mailbox deletes them all. Writing to a forgotten address again makes it known again. **Deleting a sent message for good does not forget its recipients**: a known address is the mailbox's memory of whom it writes to, not a part of a message.
21. **The app** asks this route while an address is typed and shows its answers first. What the loaded lists show stays as a second source, as today, without Spam and Trash. The app keeps answers in memory only.
22. **No address book in this record.** People with several addresses, groups, editing, notes, import and export stay in phase B and get their own record. That record builds on JSContact and JMAP for Contacts: a person is a `Card` with a `uid`, a `name` and `emails`; a group is a card of `kind` `group` with `members`; cards live in an `AddressBook`, whose rights decide who shares it. A known address already has what one `EmailAddress` of a card has, with a name beside it, so it can become a card, or stay a second source for completion, without being remodelled. Use count and last use have no property in JSContact and stay Podbay's own.
23. **Limits, chosen and to be revised from use:** 5,000 known addresses in a mailbox; 254 characters in an address and 120 in a name; 64 characters typed; 8 suggestions; two years without use. By these numbers the table is a few megabytes at most, far below the limit of one object on either plan.
24. **Migrations.** One D1 migration, the next free number in `migrations/` at build time, creates `user_choices`. One migration of the mailbox's database, the next free number in `mailboxMigrations` at build time, creates `known_addresses`. Other proposed records may take numbers first; neither migration depends on theirs. The table starts empty and fills from the next message sent: mail already in Sent is not read back.
25. **Sticky names, fixed by this record:** in the accounts database the table `user_choices` with its columns `user_id`, `choices`, `rev`, `updated_at`; the document's `v` and its ten keys as in decision 4, with the values `app/hooks/useDisplay.ts` has today; the routes `GET` and `PUT /api/v1/me/choices`. In the mailbox's database the table `known_addresses` with its columns `id`, `address`, `name`, `use_count`, `last_used_at`, `created_at`; the routes `GET` and `DELETE …/known-addresses` and `DELETE …/known-addresses/:knownId`; the query parameter `q`. An index, or a column that only serves the comparison, is the build's to add. The shape of the browser's copy is the app's own and no contract.

## Security

Three boundaries are touched and one is deliberately not.

| Boundary | Who is on the other side, and what they control | What stops them | What a test must show |
|---|---|---|---|
| B3, B4: a person's own data | Another signed-in person, an owner or administrator included. They control their own requests | No route names a person; the handler reads the session only (decisions 9, 10) | Each instance role reads and changes only its own document; the list of people carries no choices; a request from another origin is refused; an unknown key, an unknown value and a body over the limit are refused and change nothing; two changes at once to different keys both survive |
| B1: inbound mail | Anyone who can send mail. They control every address and name in a message, and how many they send | Nothing on the inbound path writes to `known_addresses` (decision 14) | After mail arrives, in the Inbox and in Spam, with crafted From, Reply-To and Cc, completion offers nothing. The same after an automatic reply, if ADR-0008 is built |
| B6: the outbound sender | A member who sends. The recording step sits on this path | It runs after the sender check, changes nothing that is sent, and cannot fail a send (decision 17) | Each of the three routes records its recipients once; the mailbox's own address is not recorded; a failing record still sends |
| B4: the mailbox | A non-member; a reader; someone who manages the instance without a membership; a member of another mailbox | The route table and `authorize`, as for every mailbox route | 404 to a non-member and to a manager without a membership, 403 to a reader; another mailbox's addresses never appear; deleting the mailbox leaves no row |

What stays possible, and is accepted:

- **A member can walk the alphabet.** Decision 19 keeps one request from returning the list; many requests still can, and only the sign-in routes are rate-limited today (the gaps are in [status](../status.md), sections 2 and 3). It shows a member nothing that Sent does not, with one exception: an address whose messages were deleted for good is still known until it is forgotten.
- **Replying to all teaches every recipient**, also ones a stranger put in Cc. The person did write to them. They rank by use, so an address used once stands below one used often.
- **A name is text someone chose.** Once names are carried (decision 16), a name that began in a stranger's message can reach the store when a person answers it. That is why the whole address is always shown.
- Logs and audit rows carry no address (S7), here as everywhere.

## What is not decided here

- The address book itself, and whether an address book is a mailbox's or a person's (phase B). Which JMAP account it belongs to is for the JMAP record.
- Whether the sending routes carry a recipient's name now (decision 16).
- A switch that stops a mailbox from remembering addresses at all.
- Reading mail already in Sent, or imported mail, into the known addresses.
- Whether known addresses are part of an export of a mailbox.
- Choices that differ per mailbox for one person, and a choice the Worker acts on (notifications that are pushed, for one).
- Telling an open tab at once that another device changed a choice. It belongs with the connection from the mailbox to the page (roadmap, section 4, row 8).
- Validating a mailbox's own settings with a schema and guarding them against two saves at once. The finding above stands; it is rule D2's work, not this record's.

## Consequences

- The feature matrix's "Compose" row gains "addresses completed from mail sent" in phase A; "Contacts" stays in phase B. Roadmap section 4, rows 2 and 3, change when this record is accepted, and not before.
- The status rows that say a person's choices "stay in their browser" change for the ten that travel.
- The schema of the choices moves to `shared/`, where both sides import it; `readChoices` becomes its lenient reader.
- The sending path gets one more step, inside the mailbox object. Rule S13's test gets a line: after a mailbox is deleted, no known address is left.
- The work comes in the usual order: the schema and the two migrations with their tests; the routes with their rights in the route table; the recording step and its tests on every sending route; the app; the browser tests (a choice made in one browser is there in a second; an address written to yesterday is offered today, and mail received is not); the documents.
- An instance that never sends learns no address, and a person who never changes a choice has no row.

## Triggers

Look again when one of these is true:

- People who share a mailbox ask for addresses the others are not offered.
- An address a person did not mean to write to is found among the suggestions.
- A choice is wanted that the Worker must act on, or that differs per mailbox.
- The address book of phase B is taken up: known addresses should become a source for it, not a second book.
- A mailbox reaches a limit of decision 23 in ordinary use.

## Sources

- RFC 9553, "JSContact: A JSON Representation of Contact Data" (May 2024), abstract and sections 1.8.1, 2, 2.1.4, 2.1.6, 2.1.9, 2.2.1 and 2.3.1: `rfc-editor.org/rfc/rfc9553.txt`, read 2026-11-17.
- RFC 9610, "JSON Meta Application Protocol (JMAP) for Contacts" (December 2024), sections 1.3, 2, 3 and 6: `rfc-editor.org/rfc/rfc9610.txt`, read 2026-11-17.
- RFC 8620, "The JSON Meta Application Protocol (JMAP)" (July 2019), the whole table of contents and section 1.6.3: `rfc-editor.org/rfc/rfc8620.txt`, read 2026-11-17.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail" (August 2019), its data types and sections 4.1.2.3 and 6: `rfc-editor.org/rfc/rfc8621.txt`, read 2026-11-17.
- Cloudflare, D1 limits (page dated 2026-10-30): `developers.cloudflare.com/d1/platform/limits/`, read 2026-11-17.
- Cloudflare, D1 foreign keys (page dated 2026-11-10): `developers.cloudflare.com/d1/sql-api/foreign-keys/`, read 2026-11-17.
- Cloudflare, D1 JSON functions (page dated 2026-04-21): `developers.cloudflare.com/d1/sql-api/query-json/`, read 2026-11-17.
- Cloudflare, D1 database API, `batch()` (page dated 2026-06-22): `developers.cloudflare.com/d1/worker-api/d1-database/`, read 2026-11-17.
- Cloudflare, Durable Objects limits (page dated 2026-11-13): `developers.cloudflare.com/durable-objects/platform/limits/`, read 2026-11-17. The Durable Object facts are also in the [ledger](../cloudflare/ledger.json).
- The repository: `app/hooks/useDisplay.ts`, `app/hooks/useUIStore.ts`, `app/hooks/useKnownAddresses.ts`, `app/lib/address-suggestions.ts`, `migrations/0002_index.sql`, `workers/auth/route-table.ts`, `workers/auth/authorize.ts`, `workers/routes/mailboxes.ts`, `workers/routes/keys.ts`, `workers/routes/account.ts`, `workers/index.ts` and `workers/routes/reply-forward.ts` (the three sending routes), `workers/durableObject/index.ts` (`createEmail`, `purge`), `workers/durableObject/migrations.ts`, `workers/lib/schemas.ts`, `shared/sending-limits.ts`.
