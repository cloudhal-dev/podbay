# Podbay: feature scope and phases

- Status: **Accepted** (2026-11-17, [ADR-0001](adr/0001-founding-decisions.md)). Companion to the [architecture](architecture.md), [sign-in and access](auth-and-access.md) and the [engineering rules](engineering-rules.md).
- The experience bar: **the mail experience people know from Gmail and Google Workspace.** A fast inbox, conversations, search that finds things, keyboard shortcuts, shared mailboxes, a layout that works on a phone. Podbay should feel that complete, in the user's own Cloudflare account.
- Podbay is an original work. It starts from Cloudflare's `agentic-inbox` reference app and builds everything else itself.

## 1. Original work only

| Allowed | Not allowed |
|---|---|
| Code written for Podbay | Code, database schema, test cases, UI text, translations, icons or images taken from any other mail product |
| Files copied from the seed, `cloudflare/agentic-inbox` (Apache-2.0), with their headers kept and each one listed in `copies.json` | A file or function ported "with changes" from a project under another licence |
| Open standards and public documentation as requirements (the mail RFCs, JMAP, Cloudflare's docs) | Dependencies under AGPL or GPL |
| Learning how good products behave by using them | Reading another product's source while writing the same part |

A feature is written down in Podbay's own words as a requirement and built from that. The engineering rules enforce this with a licence check on dependencies, the `copies.json` check and a pull-request checkbox (rule S17). This is an engineering rule, not legal advice; a short review by a licence lawyer before the first public release is worth its cost.

## 2. Phases

A complete mail product is large, and the seed is small (70 files, no tests). The scope is therefore ordered:

- **Phase A** is the standalone v0.1: the core mail experience, safe for more than one person.
- **Phase B** is the complete mail product, shipped in slices.
- **Phase C** is beyond mail. Whether to build it is decided after phase B.

## 3. Feature matrix

| Area | What Podbay delivers | Seed has it | Phase |
|---|---|---|---|
| Mailboxes | Personal and shared mailboxes with memberships; aliases; one address on several domains | A mailbox per address, no access control | A |
| Places and labels | Inbox, Starred, Sent, Drafts, Archive, Spam, Trash; any number of labels on a message ([ADR-0007](adr/0007-places-and-labels.md)) | Inbox, Sent, Drafts, Archive, Spam, Trash | A; Snoozed and Scheduled in B |
| Conversations | Threading by message headers, with reply, reply all and forward | Yes | A |
| Compose | Rich text, attachments, signatures, addresses completed from mail sent ([ADR-0012](adr/0012-a-persons-choices-and-known-addresses.md)) | Rich text, attachments | A; scheduled send and follow-up reminders in B |
| Search | Full-text search with a query grammar: phrases, exclusions, `from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `after:`, `before:` | Substring match | A |
| Sender authentication | SPF, DKIM and DMARC results shown on each message; failures treated as suspicious | None | A |
| Spam | Authentication results, allow and block lists, Report spam and Not spam | An empty Spam folder | A; scoring that learns per mailbox in B |
| Attachments | Download only; risky types flagged and held until the user acknowledges, enforced by the server | Plain download | A |
| Original message | The raw message is kept and can be downloaded. Built on 2026-11-17 for mail that arrives from then on: shown as text, saved as a `.eml` file ([ADR-0015](adr/0015-the-original-message-is-kept.md)) | Not kept | A |
| Live updates | New mail appears without a refresh. Built on 2026-11-17: the mailbox tells the open app that something changed, and the app reads what changed as it always did ([ADR-0013](adr/0013-the-mailbox-tells-the-open-app.md)) | None | A; notifications while the app is closed in B |
| Sign-in | Password, passkeys, authenticator app, recovery, step-up ([sign-in and access](auth-and-access.md)) | Cloudflare Access only | A |
| Administration | Accounts, invitations, domains, mailboxes, memberships, audit log, exports | None | A |
| Assistant | An agent panel that reads, searches and drafts with the user's rights, and never sends without confirmation | Yes, without per-user rights | A; limits and a usage view in B |
| MCP | AI tools connect with a key limited to chosen mailboxes, to read or to read and draft; they never send. Consent by OAuth with per-tool grants follows in phase B | Yes, without limits | A |
| Keyboard and mobile | Shortcuts for every common action; a phone layout | Partly | A |
| Languages | English and Turkish, with message keys everywhere | English and Turkish in the app; the Worker's own words are English | A; a wider list in B |
| Rules | Sort, forward or reject incoming mail; a forwarding loop guard | None | B |
| Contacts | An address book and notes on a conversation | None | B |
| Import and export | IMAP, mailbox archives, `.eml` and `.mbox` | None | B |
| Mail apps | JMAP (RFC 8620 and 8621) with app passwords, so mail apps that speak it can connect | None | B |
| Notifications | Installable app and push notifications | None | B |
| API and webhooks | Scoped API keys, a REST API, webhooks on new mail | None | B |
| List mail | One-click unsubscribe handling | None | B |
| Calendar, booking, files | Events with invitations, public booking links, file storage and sharing | None | C |

## 4. Design principles

What Podbay holds to, whatever the feature:

| Principle | Meaning |
|---|---|
| Your account, your mail | Everything runs and is stored in the user's own Cloudflare account. No Cloudhal service sees a message |
| No account credential inside | The Worker has bindings only. It never holds a Cloudflare API token |
| A mailbox is the unit | One Durable Object per mailbox: the unit of isolation, export and deletion |
| Managing is not reading | Administrators manage; they need an audited membership to read |
| Rules are checked by machines | Every rule in the [engineering rules](engineering-rules.md) has an automated check, from the first commit |
| Latest and stable | Current versions, pinned, kept current; no pre-release package in production without a written exception |
| Signed releases | Each version is built once, attested and signed, so any installer can verify it |
| One platform, fully tested | Cloudflare only. Fewer code paths, each one covered |
| The Cloudflare dashboard's design system | Kumo components, with the polish of the experience bar above |
| Open, nothing gated | Apache-2.0. No paid tier or licence key inside the product |

## 5. Out of scope, and why

- **Third-party mail providers, other databases and object stores, other hosts.** Each one multiplies code paths and tests, and breaks "entirely in your Cloudflare account".
- **Domain setup from inside the app.** It would need an account token inside the Worker. Setup is done by the user from the guide, or by an installer.
- **A self-updater.** It would need a source-control token and would rewrite the installation. Podbay ships signed releases instead.
- **Antivirus.** Podbay does not run a scanner. Risk flags stop one-click mistakes; they do not detect malware, and the docs say so.
- **IMAP and POP servers.** Not possible on the platform. JMAP in phase B is the route for mail apps.

## 6. Decisions

Accepted on 2026-11-17 and recorded in [ADR-0001](adr/0001-founding-decisions.md): Cloudflare only, JMAP in phase B, the original-work rule, and phase C decided after phase B.
