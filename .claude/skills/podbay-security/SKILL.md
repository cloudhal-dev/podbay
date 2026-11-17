---
name: podbay-security
description: Podbay's security governance (rule S18), on top of Cloudflare's vendored security-audit skill. Use it for ANY change that touches a trust boundary - inbound mail handling, parsing or routing; mail HTML rendering or attachments; sign-in, sessions, step-up, cookies or headers; per-mailbox authorisation, roles or memberships; the agent, MCP tools or anything that gives mail to a model; the sender check or any path that sends mail; the setup or operator tokens, bindings or secrets; queues or exports; dependencies, copied or vendored files; CI workflows or releases; hostnames the project deploys to - and for every security question, review, audit or release-readiness check. Do not ship a boundary change, and do not cut a release, without it.
---

# Podbay security

Podbay stores and shows other people's mail, inside the user's own Cloudflare account. Four outcomes are critical here ([`SECURITY.md`](../../../SECURITY.md)): reading a mailbox without a membership, sending as someone else, running script from a message, and leaking a credential.

This skill is the Podbay half of rule S18 ([engineering rules](../../../docs/engineering-rules.md)). It says **what** must hold: the trust boundaries, their invariants, the rules that guard them and the proof that exists today. The **method** (how to hunt, validate and report) is Cloudflare's [`security-audit`](../security-audit/SKILL.md) skill, vendored next to this one.

| Skill | Holds | Edited here |
|---|---|---|
| `.claude/skills/security-audit/` | The audit method, severity anchors, report schema and validators. MIT, from Cloudflare | **Never.** `pnpm static vendored` compares every file with `vendored.json` |
| `.claude/skills/podbay-security/` (this file) | Podbay's boundaries, invariants, cadence, release gate, records | Yes, in the same change that moves a boundary or adds a proof |

The rule in one paragraph: a change to a boundary ships a regression test. A full audit runs before v0.1, before every release that changes a boundary, and every quarter. A confirmed critical or high finding blocks the release. Records live in [`docs/security/`](../../../docs/security/README.md).

## 1. Does my change touch a boundary?

Find the paths you changed. A path may sit on more than one boundary.

| Path | Boundary |
|---|---|
| `workers/lib/inbound.ts`, `workers/lib/filenames.ts`, the `email` handler in `workers/app.ts`, `receiveEmail` in `workers/index.ts`, any use of the mail parser, `shared/log.ts` and any log call | B1 |
| `app/lib/mail-html.ts`, `app/components/EmailIframe.tsx`, anything that puts message content in the DOM, the attachment route in `workers/index.ts`, `workers/lib/attachments.ts` | B2 |
| `workers/auth/options.ts`, `workers/auth/instance.ts`, `workers/routes/account.ts` (sign-in, setup), the origin check and session lookup in `workers/auth/middleware.ts`, the optional Access check in `workers/app.ts`, `migrations/0001_auth.sql`, cookies, response headers | B3 |
| `workers/auth/authorize.ts`, `workers/auth/route-table.ts`, `workers/auth/middleware.ts` (the guard), `workers/auth/store.ts`, `workers/routes/mailboxes.ts`, every route under `/api/v1/mailboxes/`, `workers/durableObject/`, `migrations/0002_index.sql`, any place that builds a Durable Object name or an R2 key | B4 |
| `workers/agent/`, `workers/mcp/`, `workers/lib/tools.ts`, `workers/lib/ai.ts`, `workers/lib/features.ts`, the `/mcp` and `/agents` routes | B5 |
| `workers/email-sender.ts`, `validateSender` in `workers/lib/email-helpers.ts`, `workers/routes/reply-forward.ts`, the send route in `workers/index.ts`, the send caps in the Durable Object | B6 |
| Bindings, variables and secrets in `wrangler.jsonc`, `.dev.vars.example`, later the health, setup and operator routes | B7 |
| Later: queue producers and consumers, the export code, the scheduled handler | B8 |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `copies.json`, `NOTICE`, `.claude/skills/security-audit/` | B9 |
| `.github/`, `scripts/check-static.ts`, `scripts/checks/`, `ratchets.json`, `biome.json`, later the release workflow | B10 |
| Any hostname in a `wrangler` configuration or a workflow | B11 |

Unsure? Treat it as a boundary change. A new entry point (a route, a tool, a handler, a consumer, a binding) is always one.

## 2. The trust boundaries

State on 2026-11-17: milestone 1 (repository bootstrap). Accounts, queues, exports and releases are **not built yet**. Their rows say so. Do not read a planned control as a control that exists.

| # | Boundary | Rules | Proof today |
|---|---|---|---|
| B1 | Inbound mail bytes | S2, S3, S7, D2, D13 | Partly: envelope routing, file names and log redaction are tested |
| B2 | Mail HTML and attachments in the browser | S4, S5, S11, S12 | Partly: the renderer is unit-tested and a static check keeps it the only one |
| B3 | Sign-in, sessions and step-up | S10, S11 | Partly: password sign-in, sessions, the guarded first owner and the origin check are built and tested; passkeys, the authenticator app, step-up and invitations are not |
| B4 | Per-mailbox authorisation | S1, S2, S10, S13 | Built and tested for the API; the agent connection is checked; every MCP tool call is checked against the key's mailboxes and its owner's membership |
| B5 | The agent and MCP | S9, D7, S1 | The assistant: gated, cannot send, tested with a fake model. MCP: its own keys, per mailbox, read or read-and-draft, no tool sends; OAuth and per-key rate limits are open |
| B6 | The outbound sender | S8, S9, D7 | Partly: the `From` check is unit-tested |
| B7 | The setup and operator tokens | S6, S10, S14 | Tokens not built yet. Static checks for S6 and S14 exist |
| B8 | Queues and exports | S1, S2, S3, S5, S13, D2 | Not built yet |
| B9 | Dependencies and original work | V1, V2, V3, V6, S15, S17, S18 | Yes: five static checks, four with unit tests; weekly update pull requests |
| B10 | CI and releases | S6, S16, S18, D11 | Partly: the workflow, by review. Releases not built yet |
| B11 | Where the project hosts things | ADR-0003, S11 | Yes: a static check with unit tests |

Each boundary below has the same five lines: what crosses it, the invariant, the code, the proof, and what is open.

### B1. Inbound mail bytes

- **Crosses:** a raw message from anyone on the internet, through Email Routing into the `email` handler. Envelope, headers, body, attachments and file names are all written by the sender.
- **Invariant:** the envelope recipient picks the mailbox, never a header. Nothing from a message becomes a Durable Object name or an R2 key without passing `workers/lib/inbound.ts` or `workers/lib/filenames.ts`. Parsing happens in one place, with size and time bounds, and its output is validated before it is stored. Logs carry opaque ids, never a body, a subject or an address.
- **Code today:** `mailboxAddressFor` and `routeInbound` in `workers/lib/inbound.ts`; `storageFilename` in `workers/lib/filenames.ts`; `receiveEmail` in `workers/index.ts`, which parses inside the handler under a 25 MiB cap; `shared/log.ts`, the only module that writes logs.
- **Proof today:** `test/unit/inbound.test.ts`, `test/unit/filenames.test.ts`, and `test/workerd/inbound.test.ts` (the `To` header cannot pick a mailbox; a message without `To` is delivered; unknown and malformed recipients are rejected and nothing is stored). `test/unit/log.test.ts` (an address in a log field is masked); `pnpm static ratchets` counts `console.*` calls outside the log module.
- **Open:** the queue consumer as the only parser, the hostile-message corpus, the static check on the parser import, validation of parsed output, the test that feeds marked content through every handler and scans the log output, the CPU budget.

### B2. Mail HTML and attachments in the browser

- **Crosses:** a stranger's HTML, links, inline images, attachment bytes, file names and declared types, shown inside a signed-in session. This is the one place a stranger's bytes meet the reader's session.
- **Invariant:** one renderer. The body is sanitised, placed in a document with a strict content policy, and shown in a sandboxed frame without same-origin access. Remote content stays out until the reader allows it. No other code injects message HTML. An attachment is a download: `Content-Disposition: attachment`, `nosniff`, and a risky type needs an acknowledgement that the server enforces.
- **Code today:** `app/lib/mail-html.ts` and `app/components/EmailIframe.tsx`; `scripts/checks/html.ts`; the attachment route in `workers/index.ts` with `headerFilename`.
- **Proof today:** `test/unit/mail-html.test.ts` (active content removed, remote content removed and counted, links, the content policy, the script nonce); `pnpm static html` with its tests in `test/unit/checks-more.test.ts` (no HTML injection in the UI, only the mail frame sets `srcdoc`); `test/unit/filenames.test.ts` (a file name cannot break out of the header).
- **Open:** browser tests with the hostile corpus (no script runs, no request leaves), and all of S5 beyond the header file name: `nosniff`, risk flags, the enforced acknowledgement. S12 applies as soon as the server fetches anything for a message.

### B3. Sign-in, sessions and step-up

- **Crosses:** credentials, session cookies, invitation and recovery links and step-up proofs, from any browser.
- **Invariant:** the design in [sign-in and access](../../../docs/auth-and-access.md). Invitation only. A new instance is closed until the guarded first-owner call. Sessions are server-side; cookies are host-only, `HttpOnly`, `Secure`, `SameSite=Lax`. Sensitive changes need fresh proof. Every authentication route is rate-limited and answers uniformly. Every state-changing request is checked against the app's own origin.
- **Code today:** Better Auth on D1 (`workers/auth/options.ts`, tables generated into `migrations/0001_auth.sql` and checked by `node scripts/auth-ddl.ts --check`). Password sign-in with a 12-character minimum; rate limits counted in the database. Accounts cannot be created over HTTP: the sign-up endpoint is refused, and accounts are made on the server by the guarded first-owner call (`POST /api/setup/owner`, needs the `SETUP_TOKEN` secret, works once, compared in constant time). An account without an instance role is not admitted. Every request that changes state must carry the app's own `Origin` (`sameOrigin` in `workers/auth/middleware.ts`). Cloudflare Access is an optional outer layer; a half-configured Access refuses to run. **Second step and passkeys** (Better Auth's two-factor plugin and `@better-auth/passkey`, tables in `migrations/0005_second_step.sql`): an authenticator app with recovery codes, enabled with the password and a first code, secrets and codes stored encrypted; `workers/auth/options.ts` refuses trusted devices (`trustDevice`), codes by mail or text message, and any method but the app. A passkey is bound to the request's hostname, needs user verification and a resident key, and is a complete sign-in. **Fresh proof (step-up)** has one definition (`workers/auth/fresh.ts`): the session signed in within `FRESH_SECONDS` (ten minutes), and signing in again replaces the session (`afterAuthEndpoint` deletes the one the browser held). Routes marked `fresh` in the route table are checked last in the guard, on the session read from the database; Better Auth's own endpoints that change how a person signs in are held to it in `beforeAuthEndpoint` (`FRESH_AUTH_PATHS`), and registering a passkey by the plugin itself with the same `freshAge`. Sign-in attempts are counted per `cf-connecting-ip`. **Recovery** (`workers/auth/recovery.ts`, `workers/routes/recovery.ts`, table in `migrations/0006_recoveries.sql`): a link is issued by someone else, never for oneself (`mayIssueRecovery`: an owner for anyone, an administrator for members only), with fresh proof; the operator issues one for an owner with `SETUP_TOKEN`, compared in constant time (`POST /api/setup/recovery`). A link is 256 random bits, stored as a digest, good for a day, and a new one replaces the old. Redeeming it is one D1 batch whose later statements run only if the first marked the link used: new password hash, every session deleted, authenticator app and passkeys deleted, program keys revoked, audit row. It signs nobody in and never shows an old credential.
- **Proof today:** `test/workerd/access.test.ts`: a new instance answers 401 everywhere; the first-owner call is refused without the token, with a weak password and from another origin, and works once; HTTP sign-up is refused and creates no row; a wrong password and a forged cookie are refused; the session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`; a cross-origin or origin-less mutation is refused. `test/workerd/second-step.test.ts`: the app is not in force before its first code; then a password alone gives no session; a wrong code, a code without the password step and a reused recovery code are refused; `trustDevice` is refused and the same browser is asked again; codes by mail are refused; guesses from one address are limited; the secret and the recovery codes are not readable in D1. A passkey registers only with a fresh session, signs in by itself (also for a person with an app), and is refused without user verification, for another origin or site id, when unknown, and when an answer is replayed. An eleven-minute-old session still reads and does ordinary work but is refused every sensitive change, with nothing changed and nothing revealed about a mailbox it may not manage; signing in again gives it back and leaves no older session. `test/unit/fresh.test.ts`: the window, the exact list of fresh routes, and that every Better Auth path named in the rules is an endpoint of the installed version. `test/workerd/recovery.test.ts`: who may issue for whom, never for oneself, never stale, never to a member or without a session; the token is not in D1 or the audit log; a person with a session, a passkey, an app and a key ends with the new password alone (old password refused, no code asked, passkey refused, key revoked, sessions gone); a link works once even for two requests at once; a short password does not use it up; unknown, replaced and expired links answer alike; the operator call needs the setup token and the app's origin, and serves owners only. `test/unit/recovery.test.ts`: the issue matrix.
- **Open:** no self-service reset (a recovery address outside Podbay and reset links by mail); the setup token is a standing owner-recovery credential unless the deployer removes it; Podbay's own public routes are not rate-limited; nobody is required to have a second step; a code can be reused within its 30 seconds; passkeys are not yet tested with a real device; changing a password in the app; the app's own response headers (content policy, `frame-ancestors`, HSTS); session listing and revocation in the UI. Do not add a second way to create an account.

### B4. Per-mailbox authorisation

- **Crosses:** a mailbox, message or attachment id in a request, and the identity of the caller.
- **Invariant:** deny by default. One `authorize(actor, action, resource)` decides for every route, tool and connection, from one table. A non-member gets "not found". **Managing is not reading:** an owner or administrator without a membership cannot open a mailbox, and granting themselves one needs step-up, is audited and is visible to the mailbox's owners. An id from a request is resolved to an opaque id before it touches storage. Deleting a message or a mailbox removes its rows, its Durable Object data and its R2 objects.
- **Code today:** `authorize` in `workers/auth/authorize.ts` decides; `ROUTE_TABLE` in `workers/auth/route-table.ts` names the right of every API route; the guard in `workers/auth/middleware.ts` runs in front of all of `/api/*`, refuses a route that is not in the table, resolves the mailbox through the D1 index with the caller's membership, and names the Durable Object after the address stored in the index, never after the request. A non-member gets 404, whatever their instance role. Deleting a mailbox purges its Durable Object and its attachments (`purge` in `workers/durableObject/index.ts`). The agent connection checks a session and the right to change mail in that mailbox (`mailboxDecision`).
- **Proof today:** `test/unit/authorize.test.ts` (the whole rights matrix, the table's shape) and `test/workerd/access.test.ts`: every registered route is in the table and the table names no missing route; each mailbox route answers 404 to a signed-in non-member and to an administrator without a membership, 401 without a session, 403 to a reader where it changes anything, 403 to a sender where it manages; a crafted address is 404; an administrator can create a mailbox for someone else and then cannot open it; deletion removes mail, attachments, the index row and memberships, and a new mailbox at the same address starts empty.
- **Open:** opaque storage ids (the Durable Object and attachment keys are still named after the address and the message id); membership management routes with step-up and audit for a manager granting themselves access; MCP tools take any mailbox id and are reachable only by the instance owner until they are limited; the assistant's chat history is not purged with the mailbox.

### B5. The agent and MCP

- **Crosses:** mail content into a model prompt, and tool calls from a model or an MCP client back into mailboxes.
- **Invariant:** both are off unless `AGENT_ENABLED` or `MCP_ENABLED` is exactly `"true"`. They hold the caller's rights only, and less when the key says so. Neither can send or forward: the only way mail leaves is a person sending a draft in the UI. An MCP request is authenticated by its own key and never by a browser session; a mailbox a key cannot reach looks exactly like one that does not exist. Mail content given to a model is data, never instructions; the injection scan is advisory. Tests and local development never call a model.
- **Code today:** `workers/lib/features.ts` and the gates in `workers/app.ts`: the assistant's connection needs a session and the right to change mail in the mailbox it names (`mailboxDecision`). MCP (`workers/mcp/server.ts`) is stateless: `workers/app.ts` resolves `Authorization: Bearer pbk_…` to a key that is neither revoked nor expired and whose owner is still admitted (`workers/auth/keys.ts`), and a server is built for that one request. Every tool call reads the key's mailboxes joined with its owner's memberships again (`keyMailboxes`), so losing a membership or deleting a mailbox takes effect on the next call; a tool that changes anything also needs `keyAllows` (a write key and a role of owner or sender). Keys are made from the person's own memberships only (`workers/routes/keys.ts`), stored as a SHA-256 digest with a four-character hint, shown once, capped per person, optional expiry, creation and revocation audited. The handler allows only the request's own hostname as a browser Origin and sends no CORS headers. The assistant's tools (`workers/agent/tools.ts`) run with `withoutSend(env)`, an environment whose send binding refuses, so no tool can send whatever the model asks; they only save drafts. The automatic draft (`workers/agent/auto-draft.ts`) scans the sender, the subject and the body before any of it reaches the chat model, and fails closed: only a clear NO passes. Fixed rules follow every system prompt, including a mailbox's own (`workers/agent/prompt.ts`). Every model id is in `workers/lib/models.ts`. The tools shared by both (`workers/lib/tools.ts`) contain no function that sends; MCP runs them with `withoutSend(env)` as well.
- **Proof today:** `test/unit/features.test.ts`; "optional features are off by default" in `test/workerd/inbound.test.ts`; `test/workerd-agent/gate.test.ts` (with both features on: 401 without a session, 404 to a non-member and to an administrator without a membership, 403 to a reader, a crafted mailbox name refused, MCP answering 401 to every role's session); `test/workerd-agent/mcp.test.ts` (no key, a made-up key and a session are refused; the token is not in D1 or in the key list; a key cannot be made for a mailbox its maker is not a member of, whatever their instance role; the tool list has no send, forward or delete; out-of-scope, missing and crafted mailbox ids give one identical error; a read-only key and a reader's write key change nothing; a sender's write key saves a draft and Sent stays empty; no move to Sent; membership removed, key revoked, key expired and mailbox deleted each stop the key at once; answers are `no-store` with the security headers and no CORS header); `test/unit/keys.test.ts`; `test/unit/agent-no-send.test.ts` (a model that asks to send reaches no send binding, and Sent stays empty); `test/unit/agent-ai.test.ts`, `agent-auto-draft.test.ts`, `agent-prompt.test.ts` and `agent-models.test.ts`, all against the fake model in `test/helpers/fake-ai.ts`.
- **Open:** MCP has keys only: OAuth 2.1 with a consent screen and per-tool grants is not built (ADR-0004); there is no per-key rate limit and no audit record per call; a key is a bearer secret, so a leaked key works until it is revoked or expires. Mail read through MCP is not scanned, so a hostile message can talk a client into moving mail to Trash or saving a draft. In chat, mail read through a tool is not scanned, so a hostile message can still make the assistant move mail to Trash or discard drafts. The assistant has not been run against a real model since its model ids changed.

### B6. The outbound sender

- **Crosses:** `From`, recipients, headers, body and attachments from a caller to the `send_email` binding, and from there to the internet under the domain's reputation.
- **Invariant:** one send path. A message leaves only if `From` is an address of a mailbox the caller may send as, and the per-mailbox and per-instance caps allow it. The real binding is reachable only through the adapter. Tests and local development never send real mail.
- **Code today:** `validateSender` in `workers/lib/email-helpers.ts`; `workers/email-sender.ts`; the send, reply and forward routes; the per-mailbox cap `checkSendRateLimit` in the Durable Object.
- **Proof today:** `test/unit/sender.test.ts` (`From` must be the mailbox's own address). `test/workerd/vitest.config.ts` sets `remoteBindings: false`, so no test can send.
- **Open:** the single send function with its static check (the tool path in `workers/lib/tools.ts` sends without `validateSender`), tests for the caps, the per-instance cap, the outbound queue with an idempotency key.

### B7. The setup and operator tokens

- **Crosses:** the setup token (the first-owner call) and the deploy token (operator calls), from the person who deployed or an installer acting for them.
- **Invariant:** these are not user credentials. They authorise a short, documented set of calls and never return message content. The health answer shows version and schema state only. The Worker holds bindings only: no Cloudflare account credential, no call to a Cloudflare REST API, no call home. No secret is in the repository, a fixture, a log or a snapshot.
- **Code today:** the tokens are not built. There is no setup token, no deploy token and no health route. `.dev.vars.example` holds placeholders only. `scripts/checks/account.ts` and `scripts/checks/secrets.ts` guard the two rules that already apply.
- **Proof today:** `pnpm static account` (shipped code and the Worker configuration name no Cloudflare API host and no credential variable) and `pnpm static secrets` (no credential shape, no tracked environment file), with their tests in `test/unit/checks-more.test.ts`. The secrets check is a net: a secret in an unknown format passes.
- **Open:** the tokens themselves, the closed-instance test (S10), the health route and its test, a scan over test output (S6).

### B8. Queues and exports

- **Crosses:** queue messages (inbound pointers, outbound sends, delivery events, the dead-letter queue), and export archives in R2 with their download links.
- **Invariant:** every consumer declares who may produce for it and validates each message with a schema. A queue message carries pointers and opaque ids, not mail. Parsing happens only in the inbound consumer. An export is made only for someone who may read the mailbox, after step-up; it is stored under the mailbox's prefix, served as a download, audited, and removed with the mailbox.
- **Code today:** not built. `wrangler.jsonc` binds no queue and there is no export code.
- **Proof today:** none.
- **Open:** everything; lands with milestones 2 and 3.

### B9. Dependencies and original work

- **Crosses:** every package version with its install scripts and licence, every file copied from the seed, and third-party text such as the vendored skill.
- **Invariant:** exact pins, at least three days old, installed from a frozen lockfile; build scripts approved one by one. Licences from the allow-list; no AGPL or GPL. No code, schema, test, text, translation or asset from any other mail product, and none named. Every seed file is listed in `copies.json`. The vendored skill is byte-identical to its manifest.
- **Code today:** `scripts/pins.ts`, `scripts/checks/licences.ts`, `names.ts`, `copies.ts`, `vendored-skills.ts`; `minimumReleaseAge` and `allowBuilds` in `pnpm-workspace.yaml`.
- **Proof today:** `pnpm static pins`, `licences`, `names`, `copies`, `vendored`; `test/unit/pins.test.ts`, `test/unit/checks.test.ts` (licences, names), `test/unit/vendored-skills.test.ts`; CI installs with `--frozen-lockfile`; `.github/dependabot.yml` opens weekly update pull requests.
- **Open:** a unit test for the `copies` check, the vulnerability audit job (S15), the scheduled job that fails on a pin more than one major behind (V2).

### B10. CI and releases

- **Crosses:** pull requests from forks, workflow tokens, and the artefact a deployer installs.
- **Invariant:** actions are pinned by commit. Tokens are least-privilege. A fork pull request gets no secret. CI runs `pnpm check`, the same command as a contributor. Security-sensitive paths have code owners; `main` is protected. A release is built once, attested and signed, and needs a current audit record.
- **Code today:** `.github/workflows/checks.yml` (read-only token, pinned actions, no secret, no persisted credentials) and `.github/CODEOWNERS`.
- **Proof today:** review only. No check reads the workflow yet.
- **Open:** the workflow lint, repository settings in a checked file, and the whole release side: the workflow, signing, attestation and the audit-record gate.

### B11. Where the project hosts things

- **Crosses:** the browser's same-site line. Every subdomain of one registrable domain is the same site, so a Podbay instance shares cookies' site scope and same-site requests with its neighbours. A test mail domain also shares a domain's sending reputation.
- **Invariant:** no running Podbay instance is served from `cloudhal.com` or a subdomain of it ([ADR-0003](../../../docs/adr/0003-project-home-on-cloudhal-dev.md)). The project's site, demos, trial instances and test mail domains live under `cloudhal.dev`. Cookies are host-only.
- **Code today:** `scripts/checks/hosts.ts`.
- **Proof today:** `pnpm static hosts` and the `hosts` tests in `test/unit/checks.test.ts`.
- **Open:** the cookie attributes, which land with sign-in (B3).

## 3. Guidance mode: a normal change

Use this for every change that touches a boundary, and for any security question or review.

1. **Name the boundaries.** Use the table in section 1. Say them in the pull request.
2. **Load the vendored skill** and stay in its guidance mode: the relevant parts only. No six phases, no output directory, no report files.
3. **Pick the companion files** that match the boundary:

   | Boundary | Read with `ATTACK-CLASSES.md` |
   |---|---|
   | B1, B8 | `PROTOCOLS-RPC-AND-MESSAGING.md`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` |
   | B2 | `CLIENT-SIDE.md` |
   | B3 | `WEB-PROTOCOL-AND-AUTH.md` |
   | B4, B8 (exports, deletion) | `DATA-ISOLATION-AND-LIFECYCLE.md` |
   | B5 | `AI-AND-LLM.md` |
   | B6 | `WEB-PROTOCOL-AND-AUTH.md`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` |
   | B7, B11 | `CLOUD-AND-DEPLOYMENT.md` |
   | B9, B10 | `SUPPLY-CHAIN-AND-RELEASE.md` |

4. **Apply it to the diff.** For each boundary, write down who the lower-trust party is, what they control, which control is meant to stop them, and what they would reach if it failed. If you cannot name all four, you have not understood the change yet.
5. **Add a regression test for each boundary touched.** The rules for that test are below.
6. **Keep this file true.** If the change adds a proof, moves code or closes an open item, update section 2 here and the "What is enforced today" table in [`AGENTS.md`](../../../AGENTS.md) in the same change.
7. **Run** `pnpm check` and `pnpm test:workerd`.

A regression test counts when all of these hold:

| It must | Why |
|---|---|
| Fail when the guard is removed | A test that passes either way proves nothing. Check it once by hand |
| Attack the boundary, not the happy path | A non-member, a forged header, a hostile file name, a foreign `From` |
| Run in the tier that can prove it | Pure helpers in `test/unit/`; handlers, bindings and Durable Objects in `test/workerd/` |
| Use values made for the test | No real address, no real mail, no secret, in the test or its snapshot |
| Be named in the pull request | The template asks which test covers the boundary |

If the boundary's code is not built yet, the rule still binds: a change in that area must not make the accepted rule harder to meet.

**If you find a vulnerability** while working, in your change or in existing code: do not describe it in a public issue, pull request or commit message. Follow [`SECURITY.md`](../../../SECURITY.md).

## 4. Full audit

A full audit is the vendored skill's **full audit mode**: all six phases, written artefacts, validated findings.

| When | Scope |
|---|---|
| Before v0.1 | The whole repository |
| Before every release that changes a boundary | The whole repository, at the release commit. A release changes a boundary when its diff touches a path in section 1 or a rule in the security table |
| Every quarter | The whole repository, at the tip of `main` |

Run it with the `standard` or the `deep` profile. A `quick` or scoped run is partial coverage by the vendored skill's own definition; it is useful, and it does not count as a full audit.

### Where it may run

**Locally, with every binding local. Nowhere else.**

| Allowed | Never |
|---|---|
| Reading source | A real Cloudflare account, token or binding |
| `pnpm check` | `wrangler deploy`, a remote or preview binding, remote development |
| `pnpm test:workerd` (its config sets `remoteBindings: false`) | Sending real mail, to any address |
| `pnpm dev` with simulated mail, on loopback | Calling a real model: the agent stays off, or the `AI` binding is replaced by a fake |
| Fixtures and principals made for the run | A deployed Podbay, anyone's: a demo, a trial instance, a user's installation |
| | Real mailboxes, real messages, real addresses, real secrets |

The vendored skill's own execution rules also apply in full: a sandbox with no outside network, an empty environment, dummy principals. If the sandbox it requires is not available, do not run target code. Record the question as `needs_validation` with a safe plan.

### What it produces

1. The vendored skill writes its run directory **outside the repository** (by default under `~/security-audit-skill/podbay/`). Never commit it: it holds the detail of findings that may not be fixed yet, and this repository is public.
2. Both vendored validators pass on the run: `validate-findings.cjs` and `validate-coverage-ledger.cjs`.
3. A record goes to `docs/security/audits/`, from the template in [`docs/security/README.md`](../../../docs/security/README.md).
4. Each confirmed finding becomes a private advisory ([`SECURITY.md`](../../../SECURITY.md)). The public record names it by id, boundary, severity and status. The detail is added after the fix is released.
5. Each fix ships with a regression test, like any other boundary change.

## 5. The release gate

**A confirmed critical or high finding that is open blocks the release.**

| Question | Answer |
|---|---|
| Whose severity? | The vendored skill's anchors. The four outcomes at the top of this file are critical for Podbay. When the two differ, take the higher |
| What closes a finding? | The fix is merged with its regression test, and a fresh check confirms it. Or a fresh check rejects the finding with evidence. Both are written in the record |
| Is there a waiver? | No. Releasing with an open critical or high finding means changing rule S18 first, in the open, together with its check |
| Medium and lower? | They do not block. The record gives each an owner and a status |
| `needs_validation`? | It has no severity and does not block alone. The record states the missing fact and who resolves it |
| What is a current audit record? | A full-audit record whose commit includes the release's last boundary change, and that is less than one quarter old |
| Who checks the gate? | The project lead, by hand, until the release workflow exists. The workflow will then require the record (rule S18) |

## 6. Records

| What | Where |
|---|---|
| One dated record per full audit | `docs/security/audits/` |
| The record template and the gate, for readers | [`docs/security/README.md`](../../../docs/security/README.md) |
| How to report a vulnerability | [`SECURITY.md`](../../../SECURITY.md) |
| The rules and their enforcement | [`docs/engineering-rules.md`](../../../docs/engineering-rules.md) |
| The target design | [`docs/architecture.md`](../../../docs/architecture.md), [`docs/auth-and-access.md`](../../../docs/auth-and-access.md) |

## 7. Never

- **Never edit a file in `.claude/skills/security-audit/`**, and never add one. Podbay specifics belong in this file. To update the skill, replace the whole directory from upstream at a new commit, refresh `vendored.json` (commit, date, every hash), run its own tests with `node --test .claude/skills/security-audit/*.test.cjs`, and do nothing else in that change.
- Never run audit code against a real Cloudflare account, and never send real mail.
- Never put a real secret, a real message or a real address in a test, a fixture, a snapshot or a record.
- Never publish the detail of a finding before its fix is released.
- Never write "proof today" for a test that does not exist yet.
- Never skip a rule silently. Raise it with the rule id, the need and a proposal, and change the rule together with its check.
