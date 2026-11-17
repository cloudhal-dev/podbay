# Podbay: sign-in and access

- Status: **Accepted** (2026-11-17, [ADR-0001](adr/0001-founding-decisions.md)). Companion to the [architecture](architecture.md), the [feature scope](feature-scope.md) and the [engineering rules](engineering-rules.md).
- Question answered here: how do people and programs sign in, and who may open which mailbox?

## Summary

Podbay has its own accounts, built on **Better Auth** with the data in D1. On top of it sits Podbay's own access model: an instance role says what a person may manage, and a mailbox membership says which mail they may read and send. The two are separate on purpose: **an administrator does not read mail by being an administrator.** Programs get their own, narrower credentials. Cloudflare Access stays available as an optional outer gate, never as the only one.

## 1. Why Better Auth

| Reason | Detail |
|---|---|
| It runs where Podbay runs | Workers and D1, through its Kysely adapter. No external identity service, nothing outside the user's account |
| It covers the whole list | Password, passkeys (`@better-auth/passkey`), authenticator app and recovery codes (two-factor plugin), API keys (`@better-auth/api-key`), an OAuth 2.1 server for MCP clients (`@better-auth/mcp`, `@better-auth/oauth-provider`), single sign-on later (`@better-auth/sso`) |
| The team already operates it | Cloudhal runs Better Auth on D1 in production, with the organisation, API-key, two-factor and MCP plugins. Podbay reuses that experience, not a new stack |
| Licence and currency | MIT. Core and plugins are at 1.7.25 on the npm registry (read 2026-11-16 UTC) and are released together |

| Alternative | Why not as the base |
|---|---|
| Cloudflare Access only (what the seed does) | One shared gate: whoever passes it reaches every mailbox. It gives no accounts, roles, memberships or API keys, and it requires a Zero Trust setup from every user. Kept as an optional outer layer |
| An external identity provider only | Adds a dependency outside the account and a setup step before the first sign-in. Offered later as single sign-on, on top of local accounts |
| Hand-written sign-in | The riskiest code in the product, written again. No |

Better Auth is used for identity only. Authorisation is Podbay's own code, in one place, because "may this person open this mailbox" is the product's central rule and must not depend on a plugin's defaults.

## 2. People: how they sign in

| Topic | Design |
|---|---|
| Methods | Password, passkey, or both. An authenticator app with recovery codes as the second step. A passkey satisfies the second step by itself: it is bound to the site and must verify the person. There are no trusted devices and no codes by mail or text message: a mail product cannot mail a code to the mailbox being opened |
| New accounts | By invitation only. An administrator creates a single-use invitation link. There is no open registration, ever |
| First owner | A new instance is closed. The first owner is created only by a call that carries the setup token the deployer set. The setup page never trusts the first visitor |
| Sessions | Server-side sessions in D1. Cookies are host-only, `HttpOnly`, `Secure`, `SameSite=Lax`. A person sees and can end their sessions. A password change ends all of them |
| Step-up | Sensitive changes ask for fresh proof of identity: adding or removing a credential, creating an API key, inviting a person, changing a mailbox membership, exporting or deleting a mailbox, changing forwarding. Fresh proof has one meaning: the person signed in within the last ten minutes. Asking again is the same sign-in (a passkey, or the password and the second step) and replaces the session, so confirming is never weaker than signing in |
| Abuse limits | Rate limits on every sign-in, reset and invitation route; uniform answers that do not reveal whether an address exists |
| Cross-site requests | Every state-changing request is checked against the app's own origin |

### Recovery: the mail product's own trap

A mail product cannot send a password reset to the mailbox the person is locked out of. So:

- **A recovery address is outside Podbay.** Each account may record an external address for reset links.
- **Owners and administrators can issue a one-time recovery link** for another account: an owner for anyone, an administrator for members only, nobody for themselves. It needs fresh proof, is audited and never reveals the old credentials.
- **The last owner recovers through the operator path**: a one-time link created with the setup token (the `SETUP_TOKEN` secret), by the person who controls the Cloudflare account, or by the installer acting for them. It serves owners only. A deployer who removes the secret after setup closes this path until they set it again.
- **A recovery link resets the account to a new password alone.** It works once, for a day. Using it ends every session, removes the authenticator app and the passkeys and revokes the person's keys for programs: whatever was lost or stolen stops working, and the person sets their second step up again.
- **Before a sending domain is onboarded**, Podbay cannot send mail at all. Invitation and recovery links are then shown to the administrator to pass on by hand.

## 3. Who may do what

Two layers, checked together on every request.

**Instance role** (one per person): what they may manage.

| Role | May |
|---|---|
| Owner | Everything an administrator may, plus owners, instance settings and deletion of the instance's data |
| Administrator | Accounts, invitations, domains, mailboxes and memberships, audit log, exports |
| Member | Their own account and the mailboxes they are a member of |

**Mailbox membership** (one per person per mailbox): what they may do with that mail.

| Membership | Read | Send as the mailbox | Manage members, rules and settings of the mailbox |
|---|---|---|---|
| Owner | yes | yes | yes |
| Sender | yes | yes | no |
| Reader | yes | no | no |

Rules that follow:

- **Managing is not reading.** An owner or administrator without a membership cannot open a mailbox. They can grant themselves one; that grant needs step-up, is written to the audit log and is visible to the mailbox's owners.
- **A personal mailbox has one owner; a shared mailbox has several members.** The same model serves both.
- **A non-member gets "not found".** The existence of a mailbox is not revealed.
- **One function decides.** Every route, tool and connection calls the same `authorize(actor, action, resource)`. A table lists every entry point with its required right, and a test fails when one is missing (rule S1).
- **Storage never trusts a request.** The Worker resolves the membership and passes an opaque mailbox id to the Durable Object. A Durable Object is reachable only through the Worker (rule S2).

## 4. Programs: narrower credentials

| Credential | For | Limits |
|---|---|---|
| API key | Scripts and integrations | Stored hashed, shown once. Scoped to chosen mailboxes and actions (read, draft, send, manage). Optional expiry. Never more than its creator may do, and it loses rights when its creator does |
| Management key | Automating accounts, domains and mailboxes | Cannot read or send mail at all |
| MCP client | AI tools | Built: a key the person makes in Podbay for chosen mailboxes, to read or to read, organise and draft. Stored hashed, shown once, optional end date, revocable, and checked against the person's membership on every call. No MCP tool sends: a client leaves a draft and a person sends it in Podbay (rule S9). Planned: OAuth 2.1 with PKCE and a consent screen that lists the mailboxes and tools being granted ([ADR-0004](adr/0004-mcp-keys-first.md)) |
| App password (with JMAP, phase B) | Mail apps | One per app, revocable, limited to mail |
| The built-in agent | The assistant panel | Acts as the signed-in person in the open mailbox. Holds no credential of its own |
| Setup and deploy tokens | The installer or the person who deployed | Not user credentials. A short, documented set of calls. Never returns message content |

## 5. What is recorded

The audit log records sign-ins and failures, credential changes, invitations, membership changes (above all a manager granting themselves access), API key and MCP grants, exports, deletions and operator calls. It records who, what and when, never message content, and it is itself readable only by owners and administrators.

## 6. Phases

| Phase | Included |
|---|---|
| A (v0.1) | Better Auth on D1; password, passkeys, authenticator app; invitations; the guarded first owner; sessions and step-up; instance roles and mailbox memberships; the audit log; keys for MCP clients; optional Cloudflare Access in front |
| B | OAuth 2.1 for MCP clients; API keys for the HTTP API and management keys; app passwords with JMAP; single sign-on with an external identity provider; trusting a Cloudflare Access identity as a sign-in method |

## 7. Decisions

Accepted on 2026-11-17 ([ADR-0001](adr/0001-founding-decisions.md)).

| # | Question | Decision |
|---|---|---|
| A1 | Better Auth as the identity layer, with Podbay's own authorisation on top? | Yes |
| A2 | "Managing is not reading": administrators need an audited membership to open a mailbox? | Yes. It is the strongest privacy promise the product can make |
| A3 | Invitation only, no open registration? | Yes |
| A4 | Passkeys and the authenticator app in v0.1, not later? | Yes |
| A5 | Single sign-on and Access-as-identity in phase B? | Yes |
