# ADR-0013: The mailbox tells the open app that something changed, and nothing more

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead, as proposed
- Sources: read on 2026-11-17 and listed at the end. Each quoted finding was read in the document's own text on that day; a quote is a few words.

## Context

The open app learns of new mail by asking. A list asks again every 30 seconds (`app/routes/email-list.tsx`), and `NewMailNotifier` looks at the top of the inbox every half minute to raise a notification of the device. So mail shows up to half a minute late, a second tab or a second member of a shared mailbox sees a move or a label only at the next look, and every open tab costs requests while nothing happens. In the mail people know from Gmail and Google Workspace, new mail is there the moment it arrives.

The [roadmap](../roadmap.md) (section 4, row 8) names what is missing: a connection from the mailbox to the page, and push. The [feature matrix](../feature-scope.md#3-feature-matrix) has "Live updates" in phase A and push notifications in phase B. This record is about the first and leaves the second where it is.

It is a decision because it adds a route, a message shape that old and new versions of the app must both understand, a small persisted format in the mailbox's database, and a connection that is authorised once and then stays open, in the core of the product and on for everyone (boundaries B3 and B4). The only other connection of that kind is the assistant's, which is off by default and is not changed here; reading for this record found that its handshake did not ask the origin, and that was corrected on 2026-11-17 (`workers/app.ts`).

What the answer has to respect:

1. **Deny by default, in one table** (S1). Being told that a mailbox changed is a way of reading it.
2. **A right that ends, ends here too.** A person who signs out, loses a mailbox or whose session ends must not go on learning about it through a connection opened earlier.
3. **Browser hardening** (S11). A request that acts for a signed-in person comes from the app's own origin, and the page's content policy names no host.
4. **Everything in the user's own account, a mailbox as the unit**, bindings only ([feature scope](../feature-scope.md), section 4).
5. **JMAP in phase B** ([ADR-0001](0001-founding-decisions.md), decision 10). JMAP has a model for exactly this, and what is built now should read as that model later.
6. **The mailbox object's single alarm** is asked for by [ADR-0010](0010-snooze-and-mute.md). This record must live beside it.
7. **Cost.** An idle tab should cost close to nothing, also on the Workers Free plan.
8. **Logs carry no mail** (S7).

## Findings

### What exists today

- A tab that shows a list asks 120 times an hour, and 240 times with notifications on. Each asking is one request to the Worker and two calls to the mailbox object (a page of conversations and their count: `workers/index.ts`).
- Every change to mail goes through a method of the mailbox object, whoever asks: the API routes, the assistant's tools and the MCP tools (`workers/lib/tools.ts`), and incoming mail (`receiveEmail`). A mailbox's settings are in the index and are changed by the Worker.
- The guard checks that a request comes from the app's own origin only when its method changes state (`workers/auth/middleware.ts`). A WebSocket handshake is a GET, so a route that takes one has to ask the origin itself, as the assistant's does.
- The guard reads the membership from the index on every request, so a removed member is refused at their next request. A session is cached in its cookie for a minute, so an ended session is refused within that minute; routes marked `fresh` read it from the database (`workers/auth/options.ts`, `workers/auth/middleware.ts`).
- The mailbox object is called by RPC only. It has no `fetch` handler, no alarm and no timer.
- The page's content policy says `connect-src 'self'` (`shared/security-headers.ts`). Only paths under `/api/`, `/mcp` and `/agents/` reach the Worker (`wrangler.jsonc`).

### The standard has a model for push, and it carries no data

- JMAP's push "sends minimal data": "just enough for the client to know whether it needs to resync". Changes may "be coalesced into a single push update", and it does not matter if "some push events are dropped": the next ordinary request finds the change (RFC 8620, section 7).
- What is pushed is a `StateChange`: for each data type, the state string that a read of that type would now return. The client compares it with the state it holds and fetches when they differ (section 7.1).
- Mail adds one type that exists only for push, `EmailDelivery`. Its state changes when mail "is added to the store" and not when a message is marked read or deleted, so that a client can notify at once and fetch the rest later (RFC 8621, section 1.5).
- The same object can travel on an event source (RFC 8620, section 7.3) or on a WebSocket (RFC 8887, section 4.3.5). On a WebSocket the handshake is authenticated as an ordinary HTTP request, and those credentials "remain in effect for the duration" of the connection; when they expire the server may close it, with status 1008 (RFC 8887, section 4.2).

### The platform lets the mailbox object sleep with its connections open

- A Durable Object that accepts a WebSocket with the hibernation API is removed from memory when idle while its "clients remain connected", and duration charges "do not accrue during hibernation". An event wakes it: its `constructor` runs again, and what it held in memory is gone ("In-memory state is reset").
- It sleeps "after 10 seconds" without an event, and only if no `setTimeout` or `setInterval` is pending, no request is still being processed and no WebSocket of the ordinary kind is open. An object stays active while a "response stream" is in flight, so a stream of server-sent events keeps it awake and billed; so does a WebSocket taken with `accept()`, "for the entire time" it is connected.
- What survives sleep is kept with the connection: up to 10 tags of at most 256 characters, by which connections are found again, and an attachment of at most 16,384 bytes. Attachments "persist through hibernation" and are lost when the connection closes.
- One object may hold 32,768 such connections. A received message may be 32 MiB.
- The platform answers the protocol's own ping frames without waking the object. A browser's WebSocket does not expose those frames to a page, so the platform also offers an automatic answer to one fixed text message, sent "without waking" the object and without duration charges; both texts are at most 2,048 characters.
- Billing: opening a connection is one request to the Worker and one to the object. Messages the object sends cost nothing; messages it receives count at twenty to one. Requests are 100,000 a day on the free plan, for Workers and for Durable Objects each; duration is 13,000 GB-s a day, charged at 128 MB whatever the object uses.
- A deploy does not drop sleeping connections: they "remain connected" when the object takes the new code after sleeping. An object that is still active 300 seconds after a deploy (the default) is reset and its connections close. A runtime update gives connections "up to 20 minutes"; a shutdown of the object ends them. The documentation says to design clients to reconnect.
- The compatibility date in `wrangler.jsonc` is past 2026-04-07, so the runtime completes a close handshake by itself.

### The browser sends the cookie and the origin, and leaves the checking to the server

- A page's WebSocket takes an address and a list of subprotocols and nothing else: it cannot set a header. The handshake is sent with credentials (mode "include"), so the session cookie travels with it by itself.
- A browser always names the page's origin in the handshake (RFC 6455, section 4.1), and the server is the one that checks it: a server meant for certain sites "SHOULD verify the |Origin| field" and answer 403 otherwise (section 10.2). Nothing else stops a foreign page from opening a WebSocket with the reader's cookie; the name for that attack is cross-site WebSocket hijacking.
- `SameSite=Lax` keeps the cookie off such a request from another site, not from another host of the same site ([ADR-0003](0003-project-home-on-cloudhal-dev.md) says why that line matters).
- A page is told nothing about why a handshake failed: every failure is the same close code, 1006, by design.
- Content policy: `connect-src` governs WebSockets, and `'self'` matches the `wss:` address of the page's own host (CSP Level 3, sections 6.1.2 and 6.7.2.8). The reference documentation warns that this "does not resolve to websocket schemes in all browsers".

## Options

| | Option | For | Against |
|---|---|---|---|
| A | **Keep asking**, as today | Nothing to build, no new boundary | Late by design. An idle tab spends 120 to 240 Worker requests and twice as many object requests an hour |
| B | **Server-sent events** from the mailbox object | One direction is all that is needed. A plain GET the guard already understands. The shape JMAP describes first | Only WebSockets sleep. A mailbox with one tab open stays in memory: eight hours are about 3,700 GB-s, so a fourth such mailbox passes the free plan's day. The server would also have to send the pings, which needs a timer |
| C | **A WebSocket that carries the mail itself** (the new message, the changed line) | No second request | A second way for mail to reach a browser, with its own rights to get right at every message. A connection that outlives a right leaks mail. Every shape exists twice |
| D | **A WebSocket to the mailbox object, hibernating, that carries only "this changed"** | The object sleeps; an idle tab costs a connection now and then. Nothing on it is mail, so the ordinary API stays the only way to read, with its rights. It is JMAP's model | A new kind of route for the guard. The app must reconnect and must not trust the connection to be there |
| E | **One connection per person**, to an object of its own, for all their mailboxes | One connection per tab whatever is open; counts of the other mailboxes could be live | A new Durable Object class. Every write in a mailbox would have to find its members and call each one's object, which puts the index on the path of incoming mail. The mailbox stops being the unit |

## Decision

Option D.

1. **The transport is a WebSocket from the app to the mailbox's own object**, accepted with the hibernation API. One route opens it: `GET /api/v1/mailboxes/:mailboxId/live`. It is under `/api/`, so it reaches the Worker and the guard without a change to the configuration.
2. **It carries no mail.** The object sends one shape and nothing else:

   ```json
   { "v": 1, "type": "state", "state": { "delivery": "41", "mail": "1203", "labels": "9", "settings": "3" } }
   ```

   No address, no id of a message, no sender, no subject, no count of unread mail. The app reads what changed through the ordinary API, where every request is authorised as it is today.
3. **Four kinds, each with a counter that only grows.** The app compares a counter with the one it holds; it does not calculate with it.

   | Kind | It moves when |
   |---|---|
   | `delivery` | Mail arrives in the mailbox. Also when a snoozed conversation wakes, if [ADR-0010](0010-snooze-and-mute.md) is accepted |
   | `mail` | Anything about messages changes: arrival, a move, read or starred, a label given or taken, a draft saved or discarded, a message sent, a message deleted, a place emptied |
   | `labels` | A label is made, renamed, recoloured or deleted |
   | `settings` | The mailbox's settings are saved |

4. **Every message carries all four counters**, and the object sends one as soon as a connection opens. A message that is lost is repaired by the next one; a tab that was away learns at once whether it is behind.
5. **The counters are stored**, in a table `states` of the mailbox's database, and a counter is written with the change it counts. Kept in memory they would start again after every sleep, and a tab could then be shown a number it had already seen for a different state.
6. **The write itself raises the signal**, inside the mailbox object. So the app, the assistant, an MCP client, incoming mail, and later the rules of [ADR-0008](0008-rules-for-incoming-mail.md), the emptying of [ADR-0009](0009-emptying-trash-and-spam.md) and the alarm of ADR-0010 are covered alike: no caller can forget it, and none can raise it without writing. The one change that is not made in the object, a mailbox's settings, is reported to it by the route that saves them.
7. **A burst is evened out in the app.** The object sends one message for each call that changed something, never more, and never the same state twice. The app refetches at once on the first, and then at most once a second while messages keep coming. The object holds no timer for this, so it goes back to sleep.
8. **The handshake goes through the guard.** The route is in the route table with the right `mailbox.read`: a reader may listen, someone who is not a member is told 404 like everywhere else, and so is an owner or administrator of the instance without a membership. The proof is the session cookie. There is never a token in the address, where it would be logged and remembered.
9. **The route is marked as an upgrade in the table, and the guard is stricter for it than for a read**: a request that is not a WebSocket upgrade is refused (426); an `Origin` that is missing or is not the app's own is refused (403) before a session is looked for; and the session is read from the database, not from the cookie's copy, as for a route marked `fresh`. A program has no `Origin` and no way in here.
10. **The object is told who, by the Worker.** The Worker hands the object a request it builds itself; nothing of the browser's request travels on. The object keeps, with the connection, the id of the person (as a tag) and the time the guard allowed it (in the attachment). Both survive sleep. It keeps no session and no role.
11. **A connection is good for five minutes.** Whenever the object is awake (a write, a new connection, its alarm) it first closes every connection that was allowed more than five minutes ago, and only then sends. So nothing is ever sent on a connection more than five minutes after its right was last checked. The app opens a new connection after about four minutes, through the guard again, and closes the old one, so a person never sees this.
12. **Where the Worker knows that a right ended, the connection closes at once.** The routes that remove a member or change a role tell the object to close that person's connections, in the same request, after the index is written; the app comes back through the guard and gets its new answer. Deleting a mailbox closes all of them.
13. **Signing out, and a session that ends.** The app closes its connections before it signs out. The server does not rely on that: the object does not know sessions, so a session that was ended, replaced or revoked (a recovery link ends them all) stops being told anything after five minutes at the latest, and cannot open a new connection at all. An idle mailbox may hold such a connection open, silent, until its next event.
14. **The app says one thing: `ping`.** The platform answers `pong` without waking the object. The app sends it once a minute and reconnects when no answer comes within ten seconds. Any other message from the app closes the connection (status 1008).
15. **One connection per tab, for the mailbox on screen**, open while the tab is, seen or not. When it drops, the app tries again after a second, then doubles the wait up to a minute, each time by a random part less, and starts over once a connection has held. A failed handshake tells a page nothing, so the app does not guess why: the ordinary requests of the fallback answer 401 or 404, and what the app does with those today takes over.
16. **Asking stays, as the fallback.** While there is no connection, lists ask every 30 seconds as today. While there is one, they ask every five minutes: a net under a signal that was lost, and under a fault in the signal itself.
17. **Notifications of the device come from the signal.** When `delivery` moves, the notifier asks once for the top of the inbox and announces what is unread and new to it: the sender and the subject, as today. Its half-minute look remains only while there is no connection.
18. **The content policy does not change.** `connect-src 'self'` stays. A browser test opens the connection under the real headers and fails on any report. In a browser where `'self'` does not cover `wss:`, the app stays on asking; the policy is not widened with `wss:`, which would name every host.
19. **The alarm is not used.** Nothing here happens at a time: the five minutes are checked when the object is awake for another reason, bursts are evened out in the app, and the ping is answered by the platform. The alarm stays free for ADR-0010 and for sending later.
20. **Limits, chosen and to be revised from use:** 8 connections for one person in one mailbox (a ninth closes the oldest) and 200 in one mailbox (one more is refused with 503, and that tab keeps asking); five minutes for a connection; a ping a minute; a message of at most 256 bytes.
21. **Logs** say that a connection opened or closed, with opaque ids. A message is never logged.
22. **Sticky names, fixed by this record:** the route `GET …/live`; the message shape above with `v` 1, its `type` `state` and the kinds `delivery`, `mail`, `labels` and `settings`; the texts `ping` and `pong`; the table `states` with `kind` and `value`. The app ignores a field or a kind it does not know and falls back to asking when `v` is not one it knows, because after a deploy an old tab can meet a new object and a new tab an old one.
23. **How it will read over JMAP** (phase B, not built here): a counter is the state string of a type. `mail` is the state of Email and Thread, `labels` (and `mail`, for the counts) of Mailbox, `delivery` of `EmailDelivery`. JMAP's own push, as an event source or on a WebSocket with the subprotocol `jmap`, is a second door that the JMAP record builds; this connection names no subprotocol and leaves that name alone.

## What is not decided here

- **Notifications while the app is closed.** That is Web Push: a service worker in the app, a key pair that identifies the server (RFC 8292), messages encrypted for the browser (RFC 8291), and a push service that the browser's maker runs, outside the user's account, to which the Worker would send requests (rule S12). JMAP has the object for it (`PushSubscription`, RFC 8620, section 7.2). It is the first thing in Podbay that would pass through a third party, and it needs its own record.
- Presence, who is reading a conversation, and typing indicators.
- Live counts for the mailboxes that are not on screen, and one connection for all of a person's mailboxes (option E).
- Sharing one connection between the tabs of a browser.
- A connection for programs: a key, or a webhook on new mail (phase B).
- Telling a tab that a signal is the echo of its own change. Today that costs one refetch more.
- What changed since a state, as a list. JMAP's `/changes` needs a log; a counter is not one.
- A person's own choices changed in another tab.

## Consequences

- New mail, a move, a label and read state appear in every open tab and for every member within about a second. The half minute goes away where a connection holds, and stays as the fallback where it does not.
- An open tab asks the Worker about 27 times an hour (15 connections and 12 slow looks) instead of 120 to 240, and the mailbox object about 40 times instead of 240 to 480. The pings are answered without waking the object; whether they are counted as received messages the pricing page does not say, and at twenty to one they would be three requests an hour.
- The mailbox object gets a `fetch` handler, its first, for this one request, and the WebSocket handlers. Its constructor now runs at every wake, so the check for migrations there must stay a few reads.
- The guard and the route table learn one more mark, and the check on the origin of an upgrade is one function with its own test.
- Boundaries B3 and B4 get their tests before any screen changes. In the Workers runtime: the route is in the table and refuses a non-member, a missing session, a foreign and a missing `Origin`, and a session revoked a moment ago; marked content fed through every kind of write appears in no message, and every message fits the shape; removing a member, changing a role and deleting the mailbox close the connections in the same request; with the clock moved on five minutes, the next write closes a connection instead of telling it; a connection found by its tag after a sleep is still the same person's. In the browser: the connection opens under the real headers with no policy report, a second tab sees a move without a reload, new mail appears without waiting, and with the connection blocked the app still shows it within half a minute.
- The message shape is a schema in `shared/`, read by the app and written by the object (rule D2).
- The work comes in the usual order: the counters and the signal in the mailbox object; the route, the mark and the guard; the app's connection, its fallback and the notifier; the browser tests; the documents and the ledger of Cloudflare facts. Nothing is built before acceptance.
- JMAP later reuses the counters as its state strings and adds its own doors.

## Triggers

Look again when one of these is true:

- A browser Podbay supports is found not to open the connection under `connect-src 'self'`.
- Five minutes is found too long for a right that ended, or the reconnects are found to cost more than they protect.
- A mailbox reaches a limit of decision 20 in ordinary use.
- People ask for live counts of mailboxes that are not on screen.
- The JMAP record is written: its push should be this state, not a second one.
- Web Push is taken up: a notification should be raised by `delivery`, and by nothing else.

## Sources

Each read on 2026-11-17.

- RFC 8620, "The JSON Meta Application Protocol (JMAP)", sections 7, 7.1, 7.2 and 7.3: `rfc-editor.org/rfc/rfc8620.txt`.
- RFC 8621, "The JSON Meta Application Protocol (JMAP) for Mail", section 1.5: `rfc-editor.org/rfc/rfc8621.txt`.
- RFC 8887, "A JSON Meta Application Protocol (JMAP) Subprotocol for WebSocket", sections 4.1, 4.2 and 4.3.5: `rfc-editor.org/rfc/rfc8887.txt`.
- RFC 6455, "The WebSocket Protocol", sections 1.3, 4.1, 7.4.1 and 10.2: `rfc-editor.org/rfc/rfc6455.txt`.
- RFC 8291, "Message Encryption for Web Push", and RFC 8292, "Voluntary Application Server Identification (VAPID) for Web Push", titles and abstracts: `rfc-editor.org/rfc/rfc8291.txt`, `rfc-editor.org/rfc/rfc8292.txt`.
- WHATWG, WebSockets Standard (last updated 2026-11-12), the opening handshake, feedback from the protocol, and ping and pong frames: `websockets.spec.whatwg.org`.
- W3C, Content Security Policy Level 3 (working draft of 2026-10-27), sections 6.1.2 and 6.7.2.8: `w3.org/TR/CSP3/`. W3C, Push API (working draft of 2026-11-16): `w3.org/TR/push-api/`.
- MDN, `connect-src` (page dated 2026-07-03), "Writing WebSocket servers" (2026-07-28), the `WebSocket()` constructor (2026-06-22), `Set-Cookie` (2026-09-01) and the Push API (2025-05-28), all under `developer.mozilla.org/en-US/docs/Web/`: `HTTP/Reference/Headers/Content-Security-Policy/connect-src`, `API/WebSockets_API/Writing_WebSocket_servers`, `API/WebSocket/WebSocket`, `HTTP/Reference/Headers/Set-Cookie`, `API/Push_API`.
- Cloudflare, Durable Objects, each under `developers.cloudflare.com/durable-objects/`: "Use WebSockets" (page dated 2026-10-30), `best-practices/websockets/`; the state interface (2026-09-30), `api/state/`; the base class (2026-06-15), `api/base/`; the lifecycle (2026-10-30), `concepts/durable-object-lifecycle/`; code updates (2026-10-30), `deployments/durable-objects-code-updates/`; pricing (2026-11-13), `platform/pricing/`; limits (2026-11-13), `platform/limits/`.
- Cloudflare, Workers, each under `developers.cloudflare.com/workers/`: WebSockets (page dated 2026-10-12), `runtime-apis/websockets/`; limits (2026-11-13), `platform/limits/`; pricing (2026-11-13), `platform/pricing/`; compatibility flags (2026-09-18), `configuration/compatibility-flags/`.
- The repository: `app/routes/email-list.tsx`, `app/components/NewMailNotifier.tsx`, `app/queries/emails.ts`, `workers/index.ts` (`receiveEmail`, the list route), `workers/durableObject/index.ts`, `workers/lib/tools.ts`, `workers/auth/middleware.ts`, `workers/auth/route-table.ts`, `workers/auth/options.ts`, `workers/routes/people.ts`, `workers/routes/mailboxes.ts`, `shared/security-headers.ts`, `wrangler.jsonc`.
