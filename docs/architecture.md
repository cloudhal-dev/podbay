# Podbay: architecture

- Status: **Accepted** (2026-11-17, [ADR-0001](adr/0001-founding-decisions.md)). Describes the target. The [roadmap](#7-roadmap) says what exists today.
- Companion documents: [feature scope](feature-scope.md), [sign-in and access](auth-and-access.md), [engineering rules](engineering-rules.md).
- Cloudflare facts below were read from the cited pages on 2026-11-16 (UTC) and are recorded, with the quote that supports each, in the [ledger](cloudflare/README.md). They are re-checked whenever the code that depends on them changes (rule V5).

## 1. What Podbay is

Podbay is a self-hosted mail product that runs entirely in your own Cloudflare account. Email Routing brings mail in, the `send_email` binding sends it out, each mailbox is a Durable Object, and raw messages and attachments live in R2. Nobody else sees a message: there is no hosted service behind it.

It is for a person or a small team with a domain on Cloudflare who wants real addresses at that domain and a modern web inbox, and for developers who want agents to work with mail under per-mailbox permissions.

## 2. Non-goals

- **No hosted mail service.** Podbay never relays or stores mail outside the user's account.
- **No IMAP, POP or SMTP server.** Podbay is a web inbox. Mail apps connect through JMAP, planned for phase B.
- **No marketing or bulk mail.** Cloudflare Email Sending is a transactional service ([deliverability](https://developers.cloudflare.com/email-service/concepts/deliverability/)). Podbay has no lists or campaigns.
- **Cloudflare only.** No other mail provider, database, object store or host.
- **No Cloudflare account credential inside the Worker.**

## 3. Requirements on the account

| Need | Why | Source |
|---|---|---|
| A domain on Cloudflare DNS | Email Routing and Email Sending are onboarded per domain | [Domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/) |
| Workers Paid, to send to anyone | Sending to arbitrary recipients needs it: 3,000 mails a month included, then $0.35 per 1,000. On Workers Free, Podbay can receive, and send only to verified destination addresses | [Pricing](https://developers.cloudflare.com/email-service/platform/pricing/) |
| Email Sending, which Cloudflare documents as beta | Outbound mail | [Email Service](https://developers.cloudflare.com/email-service/) |

## 4. Components

```
                 Internet mail
                      │
          Email Routing (catch-all)            Email Sending
                      │                              ▲
                      ▼                              │
 Browser ──► podbay Worker (Hono) ───────────────────┤
 MCP client     fetch · email · queue · scheduled    │
                      │                              │
        ┌─────────────┼──────────────┬───────────────┤
        ▼             ▼              ▼               │
   D1 index      MailboxDO      Queues: inbound, outbound, events (+ DLQ)
   users,        per mailbox:        R2: raw messages, attachments, exports
   domains,      messages, threads,
   mailboxes,    labels, FTS index
   memberships,
   audit
```

| Part | Design | Why |
|---|---|---|
| Worker | One Worker, four handlers: `fetch` (UI assets, API, MCP, agent WebSocket), `email` (inbound), `queue` (consumers), `scheduled` (cleanup, exports) | One deployable unit; simple to install by hand |
| Central index | D1: users, sessions, domains, mailboxes, addresses and aliases, memberships, audit. Batches only, compare-and-set on a revision column | Listing and authorisation need one queryable place; Durable Objects cannot be listed or joined |
| Mailbox | One `MailboxDO` per mailbox: message metadata, threads, folders, labels and an FTS5 index ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)) | A mailbox is the unit of isolation, export and deletion |
| Storage | R2 holds the raw message, attachments and exports under a per-mailbox prefix. The Durable Object holds metadata and extracted text only | A Durable Object stores at most 10 GB on Workers Paid (1 GB on the Free plan) and a row at most 8 MB ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)); inbound mail can be 25 MiB ([limits](https://developers.cloudflare.com/email-service/platform/limits/)) |
| Inbound | The `email` handler resolves the **envelope** recipient in D1, rejects unknown addresses, streams the raw message to R2 and enqueues a pointer. A consumer parses, files, applies rules and wakes the agent | A queue message is at most 128 KB ([Queues limits](https://developers.cloudflare.com/queues/platform/limits/)); an isolate has 128 MB ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) |
| Outbound | A send is a row plus a queue message with an idempotency key. The consumer calls `send_email`, retries retryable errors and records the result | No duplicate and no lost sends; a visible state |
| Delivery events | Email Sending publishes delivered, bounced and complained events to a Queue ([event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/)); a consumer attaches them to the message | Delivery status without a webhook endpoint |
| Sign-in and access | Better Auth on D1 for identity; Podbay's own `authorize` for access ([sign-in and access](auth-and-access.md)) | Managing is not reading |
| Sender check | `From` must be an address of a mailbox the caller may send as; per-mailbox and per-instance caps | Mailboxes are created at runtime, so the binding cannot be locked to fixed addresses ([send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)) |
| Authentication results | The first `Authentication-Results` header written by `mx.cloudflare.net` is read and shown; DMARC failures go to Spam ([email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/)) | Cloudflare validates before the Worker runs |
| Agent and MCP | Optional, off by default. They act with the caller's mailbox rights or less, and cannot send: they leave a draft, and a person sends it. The MCP endpoint is stateless and takes its own keys | Mail content is untrusted input to a model |
| Mail HTML | One renderer: sanitised, in a sandboxed frame, under a strict content policy, remote content blocked until allowed | The one place a stranger's bytes are shown in a signed-in session |
| Domains | A domain is a row the owner adds. Routing uses a catch-all rule to the Worker, so a new mailbox needs no Cloudflare change | The Worker has no credential to configure Cloudflare |
| Backup | Each mailbox exports to R2 on a schedule and on request; Durable Objects also offer point-in-time recovery for 30 days | A Durable Object's data cannot be exported from outside |

## 5. The installer contract

Podbay can be installed by hand from the docs or by an installer acting for the account's owner. Both end in the same state.

| Promise | Detail |
|---|---|
| Signed release | Each version ships a bundle, a manifest and a signed statement. The manifest lists the Worker, its bindings, Durable Object migrations, queues and assets |
| Health | `GET /api/health` without a credential: version and schema state, no mail counts, no addresses |
| Guarded first owner | A new instance is closed. The first owner is created only by `POST /api/setup/owner` with the setup token the deployer set as the Worker secret `SETUP_TOKEN`; it works once. The same token lets the deployer issue a recovery link for an owner (`POST /api/setup/recovery`). `AUTH_SECRET`, a second secret, signs session cookies |
| Narrow operator surface | A deploy token authorises a short, documented set of calls. It never returns message content |
| Names from the deployer | No hard-coded Worker, database, bucket or queue name |
| No credential, no call home | No Cloudflare token in the Worker and no request to any vendor. Removing the installer leaves Podbay running |
| Domain setup | Email Routing enabled on the zone, a catch-all rule to the Worker, the domain onboarded for Email Sending, the domain registered in Podbay. Done from the setup guide, or by the installer over Cloudflare's API |

## 6. Where Podbay is hosted by the project

The project's own site, demos and trial instances live under `cloudhal.dev`, with the home at `podbay.cloudhal.dev`. **No running Podbay instance is served from `cloudhal.com` or a subdomain of it** ([ADR-0003](adr/0003-project-home-on-cloudhal-dev.md)): Podbay renders mail written by strangers, and a browser treats all subdomains of one domain as the same site. The same reasoning applies to anyone who deploys Podbay: give it a hostname on a domain that does not also host services whose sessions you care about, or accept that they share a site.

## 7. Roadmap

| # | Milestone | Done when |
|---|---|---|
| 1 | Repository bootstrap | The seed is imported and credited; every dependency is latest and pinned; the app is a single-page app on the latest Kumo; every check in the [engineering rules](engineering-rules.md) runs in CI; inbound mail routes by the envelope recipient |
| 2 | Accounts and roles | D1 index, Better Auth sign-in, the guarded first owner, memberships on every route and tool, deletion that deletes, the audit log, a security review |
| 3 | Standalone v0.1 | Every phase A row of the [feature matrix](feature-scope.md#3-feature-matrix) works; queues, raw messages in R2, search, exports, a signed release and the health endpoint; a full security audit record |
| 4 | Installer support | A one-click installer can install, update, back up and remove Podbay |
| 5 | Complete mail (phase B) | Each phase B row ships as its own slice with its tests |

Current state: milestones 1 and 2 in progress. `AGENTS.md` lists what is enforced today and what is still open.
