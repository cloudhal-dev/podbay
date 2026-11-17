# AGENTS.md — Podbay

One page for coding agents and new engineers. The design is in [docs/architecture.md](docs/architecture.md); the decisions are in [docs/adr/](docs/adr/README.md); the full rules are in [docs/engineering-rules.md](docs/engineering-rules.md).

## What this repo is

Podbay is self-hosted mail that runs entirely in the user's own Cloudflare account: Email Routing in, the `send_email` binding out, a Durable Object per mailbox, raw messages and attachments in R2. It started from Cloudflare's `agentic-inbox` reference app ([`NOTICE`](NOTICE), [`copies.json`](copies.json)) and is being built into a product. **Nothing here is ready for real mail yet.** Where the work stands and what comes next is in [docs/roadmap.md](docs/roadmap.md).

```
 Browser ──► podbay Worker (Hono): fetch · email            index.html + app/ (single-page app,
 MCP client      │   guard: route table → session → membership     TanStack Router, Kumo), served
                 ├── D1 (accounts, sessions, mailboxes, memberships, audit)     as static assets
                 ├── MailboxDO (one per mailbox, SQLite)
                 ├── R2 (attachments)
                 └── optional, off by default: EmailAgent (Workers AI), /mcp (stateless, per-key)
```

## Commands

```bash
pnpm install          # once; pnpm 12, Node 24 or newer
pnpm check            # lint → static checks → typecheck → unit tests → build (what CI runs)
pnpm test:workerd     # handlers in the real Workers runtime, every binding local, two suites (about 30 s)
pnpm e2e              # the built app in the installed Chrome, under its real headers, on its own throwaway
                      #   instance; every binding local, all outside traffic caught by a proxy (about 1 min)
pnpm dev              # local development on http://localhost:5173, simulated mail, no account;
                      #   first writes .dev.vars (generated secrets) and applies the local D1 migrations
PODBAY_STATE_DIR=<dir> pnpm exec vite preview   # the built app with its real response headers, on its own
                      #   throwaway data (apply migrations there: wrangler d1 migrations apply DB --local --persist-to <dir>)
node scripts/auth-ddl.ts --check   # the auth migrations still produce Better Auth's schema (--delta: what to add)
pnpm format           # Biome formatting and safe fixes
pnpm static [name]    # one static check: pins, copies, licences, names, secrets, account, imports, html,
                      #   dialogs, messages, hosts, headers, compat, ledger, vendored, docs, guidance, ratchets
node scripts/checks/headers.ts --write   # after changing shared/security-headers.ts
node scripts/pins.ts --resolve [names]   # newest stable version that is at least 3 days old (network, read-only)
pnpm pins:outdated                       # pins that are behind (network, read-only)
node scripts/checks/copies.ts --fix      # after editing a seed file: set its status and add the notice
node scripts/checks/ratchets.ts --update # after paying down debt: lower the baseline (never raise it)
node scripts/checks/ledger.ts --stale     # Cloudflare facts that are unverified or older than 90 days (a report, exit 0)
```

Deliver a test message to the local server:

```bash
curl -X POST 'http://localhost:5173/cdn-cgi/local/email?from=a@sender.test&to=hello@example.com' --data-binary @message.eml
```

## Layout

- `workers/` — the Worker: `app.ts` (entry, `fetch` and `email`), `index.ts` (API routes), `arrival.ts` (inbound mail: the original kept, then parsed and filed), `auth/` (Better Auth configuration, `authorize.ts`, the route table, the guard, the D1 index store, invitations and members, `keys.ts` for program keys, `fresh.ts` for fresh proof, `recovery.ts` for recovery links), `routes/` (account and setup, mailbox registry, people, keys, recovery, reply and forward, the original of a message, the connection to the open app), `durableObject/` (`MailboxDO`; `live.ts` wraps its every method, so a write tells the open app), `lib/` (pure helpers: `inbound.ts`, `filenames.ts`, `features.ts`, `list-options.ts`, `mailbox-rpc.ts`, `secrets.ts`, `models.ts` with every Workers AI model id, `ai.ts`), `agent/` (the assistant: `tools.ts`, `auto-draft.ts`, `prompt.ts`) and `mcp/server.ts` (the MCP endpoint; its tool list is `shared/mcp-tools.ts`), both optional features.
- `app/` — the single-page app: `router.tsx` (the route tree), `routes/`, `components/`, `queries/` (TanStack Query), `services/api.ts`, and `lib/mail-html.ts`, the only renderer of mail HTML.
- `shared/` — code both sides import: `log.ts` (the only module that writes logs), `live.ts` (the one message a mailbox sends the open app: four counters, no mail), `html-text.ts` (text of an HTML fragment, no DOM), `security-headers.ts` (the response headers and the two content policies; `public/_headers` is generated from it), `mail-frame.ts` (the one inline script, with the hash the page's policy names), `attachment-risk.ts` (which attachments can do harm, and the type a file is served as), `mcp-tools.ts`, `fresh-proof.ts`, `choices.ts` (the schema of a person's choices; `choices-schema.ts` is its strict half, loaded by the Worker only), `known-addresses.ts`. No Node-only and no browser-only API.
- `migrations/` — D1: `0001_auth.sql` is generated by Better Auth and never edited; `0002_index.sql` is Podbay's index (roles, mailboxes, memberships, audit); `0003` to `0006` add invitations, keys, the second step (generated, like `0001`) and recovery links; `0007` adds a person's choices. Additive only.
- `test/unit/` — tier 0, pure code in Node (the mail renderer runs against jsdom; the assistant runs against the fake model in `test/helpers/fake-ai.ts`). `test/workerd/` — tier 3, the Workers runtime; `test/workerd-agent/` — the same with the assistant and MCP switched on: their gates (`gate.test.ts`) and the MCP endpoint with its keys end to end (`mcp.test.ts`). `test/e2e/` — tier 6, the built app in a real browser (`pnpm e2e`): `scripts/e2e-server.ts` builds it, gives it secrets of its own and a fresh state directory and serves it with every binding local; `fixtures.ts` watches each page from outside (requests, messages, dialogs, new windows, policy violations) and `proxy.ts` is the browser's only way out, so "no request left" is a fact about the whole browser and not about what a debugger happened to see.
- `scripts/` — Node-only tooling: `pins.ts`, `check-static.ts`, `checks/`.
- `docs/` — architecture, feature scope, sign-in and access, engineering rules, ADRs; `docs/cloudflare/` (the ledger of Cloudflare facts); `docs/security/` (audit records).
- `.claude/skills/` — `security-audit` (Cloudflare's, vendored, never edited) and `podbay-security` (the trust boundaries; load it for any change that touches one).

## Hard rules

Short form; the full text and the reason for each is in [docs/engineering-rules.md](docs/engineering-rules.md). **A rule without an automated check is not a rule**, so the table under it says which checks exist today.

1. **Latest, pinned.** Every dependency is one exact stable version, at least three days old when installed. A 0.x package needs a dated `pinExceptions` entry in `package.json`. (V1, V3, V6)
2. **Original work only.** No code, schema, test, text, translation or asset from any other mail product, and no other product named in this repository. No dependency under AGPL or GPL. A file that came from the seed stays listed in `copies.json`; when you change one, run `node scripts/checks/copies.ts --fix`. (S17, S15)
3. **Deny by default.** Every API route is in `workers/auth/route-table.ts` with the right it needs; the guard refuses a route that is not there. Access is decided only by `authorize` in `workers/auth/authorize.ts`. A person who is not a member of a mailbox gets 404, whatever their instance role: managing is not reading. The one exception is who the members are: an owner or administrator of the instance sees and changes them without a membership, with fresh proof and on a record the mailbox's owners read. Accounts are never created over HTTP. (S1, S10)
4. **Mail is hostile bytes.** Route by the envelope recipient, never by a header. A name or id from a message or a request never becomes a storage key without going through `workers/lib/inbound.ts` or `workers/lib/filenames.ts`. (S2, S3)
5. **One renderer, one log.** Mail HTML reaches the screen only through `app/lib/mail-html.ts` and the mail frame; remote content stays blocked until the reader allows it. The page's content policy and the frame's are one design: the frame inherits the page's, so a change to either goes through `test/unit/content-policy.test.ts`. An attachment is a download, and one that can do harm is handed over only to the app's own POST. Logs are written only through `shared/log.ts` and never carry a body, a subject or an address. (S4, S7)
6. **Optional features are off by default.** The agent and MCP run only when `AGENT_ENABLED` or `MCP_ENABLED` is exactly `"true"`. Tests and local development never call a model or send real mail. (D7)
7. **A change to a trust boundary ships a regression test**: sign-in, authorisation, mail rendering, attachments, the sender check, the agent and MCP, tokens, exports, CI and releases. Load `.claude/skills/podbay-security` first. (S18)
8. **Cloudflare facts come from current sources**, never memory: the docs page as `index.md`, the OpenAPI document, the changelog. Record the URL, the date and a quote in `docs/cloudflare/ledger.json`. (V5)
9. **Dependency direction.** The UI never imports Worker code; the Worker never imports the UI; Worker-reachable code imports no Node-only module. (D5)
10. **Nothing runs under `cloudhal.com`.** The project's site, demos and test mail domains live under `cloudhal.dev` (home: `podbay.cloudhal.dev`). A running Podbay renders strangers' mail and must not share a site with services that hold sessions. ([ADR-0003](docs/adr/0003-project-home-on-cloudhal-dev.md))
11. **Debt only shrinks.** `ratchets.json` records lint warnings and oversized files. Lower it when you pay debt down; never raise it. New files get no exemption. (D1, D4, S7)
12. **Conventional commits, signed off** (`git commit -s`). A contract, a persisted format or a sticky name (a binding, a queue, a Durable Object class) needs an RFC first. (D12)

### Where each rule stands

[docs/status.md](docs/status.md) lists which check holds which rule today, what is not enforced yet, and the known debt and gaps. Read it before relying on a control, and update it in the same change that adds a check or closes a gap.

## How to work here

The method for each kind of work is a skill in `.claude/skills/`. Load the one that matches **before** editing; an agent that cannot load skills reads the file. Every change starts with `podbay-change`.

| Skill | Use it when |
|---|---|
| `podbay-change` | You start any change, are about to commit, or touch a decision. The order of work, what "done" means, and how to treat the developer's machine |
| `podbay-security` | The change touches a trust boundary (hard rule 7): Podbay's boundaries, their invariants and their proof |
| `security-audit` | The method `podbay-security` applies: Cloudflare's security audit skill, vendored unedited (`pnpm static vendored`). Never changed here |
| `podbay-audit` | The project lead asks for a full security audit: all six phases of `security-audit`, a record in `docs/security/audits/`. Never on your own |
| `podbay-ui` | Anything under `app/` |
| `podbay-cloudflare` | Anything that relies on how Cloudflare behaves (hard rule 8) |
| `podbay-testing` | You write, change or debug a test |

Subagents in `.claude/agents/` give a second, independent read. None of them edits; each reports, and the report is checked before it is passed on.

| Subagent | It |
|---|---|
| `security-reviewer` | Reads a change against the trust boundaries and reports findings |
| `cloudflare-fact-checker` | Checks statements about Cloudflare against the platform's current documentation |
| `verifier` | Runs the checks and tests and reports exactly what happened |
| `decision-researcher` | Researches a question from primary sources before an ADR |

Where the project is going is [docs/roadmap.md](docs/roadmap.md). A decision is an ADR in [docs/adr/](docs/adr/README.md): proposed by whoever needs it, accepted only by the project lead, never edited afterwards. The rules in `.claude/rules/` load themselves by path and say which skill a file needs. `pnpm static guidance` holds all of this to its own rules.

## When unsure

Read [docs/adr/README.md](docs/adr/README.md) and [docs/engineering-rules.md](docs/engineering-rules.md). If a rule seems wrong, raise it (rule id, need, proposal) and change the rule together with its check; never skip it silently.
