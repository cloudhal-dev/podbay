# AGENTS.md — Podbay

One page for coding agents and new engineers. The design is in [docs/architecture.md](docs/architecture.md); the decisions are in [docs/adr/](docs/adr/README.md); the full rules are in [docs/engineering-rules.md](docs/engineering-rules.md).

## What this repo is

Podbay is self-hosted mail that runs entirely in the user's own Cloudflare account: Email Routing in, the `send_email` binding out, a Durable Object per mailbox, raw messages and attachments in R2. It started from Cloudflare's `agentic-inbox` reference app ([`NOTICE`](NOTICE), [`copies.json`](copies.json)) and is being built into a product. **Milestone 1 (repository bootstrap) is in progress; nothing here is ready for real mail.**

```
 Browser ──► podbay Worker (Hono): fetch · email            index.html + app/ (single-page app,
 MCP client      │                                          TanStack Router, Kumo), served as
                 ├── MailboxDO (one per mailbox, SQLite)    static assets
                 ├── R2 (attachments, mailbox registry)
                 └── optional, off by default: EmailAgent (Workers AI), EmailMCP
```

## Commands

```bash
pnpm install          # once; pnpm 12, Node 24 or newer
pnpm check            # lint → static checks → typecheck → unit tests → build (what CI runs)
pnpm test:workerd     # handlers in the real Workers runtime, every binding local (about 30 s)
pnpm dev              # local development on http://localhost:5173, simulated mail, no account
pnpm format           # Biome formatting and safe fixes
pnpm static [name]    # one static check: pins, copies, licences, names, secrets, account, imports, html,
                      #   hosts, compat, ledger, vendored, docs, ratchets
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

- `workers/` — the Worker: `app.ts` (entry, `fetch` and `email`), `index.ts` (API routes and inbound mail), `durableObject/` (`MailboxDO`), `lib/` (pure helpers: `inbound.ts`, `filenames.ts`, `features.ts`, `list-options.ts`, `mailbox-rpc.ts`), `agent/` and `mcp/` (optional features).
- `app/` — the single-page app: `router.tsx` (the route tree), `routes/`, `components/`, `queries/` (TanStack Query), `services/api.ts`, and `lib/mail-html.ts`, the only renderer of mail HTML.
- `shared/` — code both sides import: `log.ts` (the only module that writes logs), `html-text.ts` (text of an HTML fragment, no DOM). No Node-only and no browser-only API.
- `test/unit/` — tier 0, pure code in Node (the mail renderer runs against jsdom). `test/workerd/` — tier 3, the Workers runtime.
- `scripts/` — Node-only tooling: `pins.ts`, `check-static.ts`, `checks/`.
- `docs/` — architecture, feature scope, sign-in and access, engineering rules, ADRs; `docs/cloudflare/` (the ledger of Cloudflare facts); `docs/security/` (audit records).
- `.claude/skills/` — `security-audit` (Cloudflare's, vendored, never edited) and `podbay-security` (the trust boundaries; load it for any change that touches one).

## Hard rules

Short form; the full text and the reason for each is in [docs/engineering-rules.md](docs/engineering-rules.md). **A rule without an automated check is not a rule**, so the table under it says which checks exist today.

1. **Latest, pinned.** Every dependency is one exact stable version, at least three days old when installed. A 0.x package needs a dated `pinExceptions` entry in `package.json`. (V1, V3, V6)
2. **Original work only.** No code, schema, test, text, translation or asset from any other mail product, and no other product named in this repository. No dependency under AGPL or GPL. A file that came from the seed stays listed in `copies.json`; when you change one, run `node scripts/checks/copies.ts --fix`. (S17, S15)
3. **Mail is hostile bytes.** Route by the envelope recipient, never by a header. A name or id from a message or a request never becomes a storage key without going through `workers/lib/inbound.ts` or `workers/lib/filenames.ts`. (S2, S3)
4. **One renderer, one log.** Mail HTML reaches the screen only through `app/lib/mail-html.ts` and the mail frame; remote content stays blocked until the reader allows it. Logs are written only through `shared/log.ts` and never carry a body, a subject or an address. (S4, S7)
5. **Optional features are off by default.** The agent and MCP run only when `AGENT_ENABLED` or `MCP_ENABLED` is exactly `"true"`. Tests and local development never call a model or send real mail. (D7)
6. **A change to a trust boundary ships a regression test**: sign-in, authorisation, mail rendering, attachments, the sender check, the agent and MCP, tokens, exports, CI and releases. Load `.claude/skills/podbay-security` first. (S18)
7. **Cloudflare facts come from current sources**, never memory: the docs page as `index.md`, the OpenAPI document, the changelog. Record the URL, the date and a quote in `docs/cloudflare/ledger.json`. (V5)
8. **Dependency direction.** The UI never imports Worker code; the Worker never imports the UI; Worker-reachable code imports no Node-only module. (D5)
9. **Nothing runs under `cloudhal.com`.** The project's site, demos and test mail domains live under `cloudhal.dev` (home: `podbay.cloudhal.dev`). A running Podbay renders strangers' mail and must not share a site with services that hold sessions. ([ADR-0003](docs/adr/0003-project-home-on-cloudhal-dev.md))
10. **Debt only shrinks.** `ratchets.json` records lint warnings and oversized files. Lower it when you pay debt down; never raise it. New files get no exemption. (D1, D4, S7)
11. **Conventional commits, signed off** (`git commit -s`). A contract, a persisted format or a sticky name (a binding, a queue, a Durable Object class) needs an RFC first. (D12)

### What is enforced today

| Check | Rules | Where |
|---|---|---|
| Exact pins, 0.x exceptions | V1, V3 | `pnpm static pins`, unit tests |
| Minimum release age | V6 | `pnpm-workspace.yaml` (`minimumReleaseAge`) |
| Weekly update pull requests | V2 | `.github/dependabot.yml` |
| Compatibility date at most 60 days old | V4 | `pnpm static compat` |
| Every Cloudflare surface in the configuration has a sourced ledger entry | V5 | `pnpm static ledger` |
| Copied files listed, modified ones marked | S17 | `pnpm static copies` |
| Licence allow-list over every installed package | S15, S17 | `pnpm static licences` |
| No other mail product named | S17 | `pnpm static names` |
| No credential shapes, no tracked environment file | S6 | `pnpm static secrets` |
| No Cloudflare REST call or account credential in shipped code | S14 | `pnpm static account` |
| Mail HTML has one renderer; no HTML injection in the UI | S4 | `pnpm static html`, `test/unit/mail-html.test.ts` (hostile bodies, real sanitiser) |
| Logs only through `shared/log.ts`, addresses masked | S7 | Biome `noConsole`, `test/unit/log.test.ts` |
| Dependency direction | D5 | `pnpm static imports` |
| No deployment configuration or workflow names a `cloudhal.com` host | ADR-0003 | `pnpm static hosts` |
| The vendored security skill is unmodified | S18 | `pnpm static vendored` |
| Markdown links and anchors | D14 | `pnpm static docs` |
| Lint warnings and file size: only down | D1, D4 | `pnpm static ratchets` |
| Lint errors, formatting | D1 | `pnpm lint` |
| Types | D1 | `pnpm typecheck` |
| Envelope routing, file names, feature switches, sender check, list options | S2, S3, S8, D2, D7 | `test/unit/`, `test/workerd/` |
| Actions pinned by commit, read-only token | S16 | `.github/workflows/checks.yml` (by review until the workflow lint lands) |

### Not enforced yet

These rules are accepted but their checks land with the code they guard. Until then they are review rules, and a change that touches the area must not make them harder to meet.

| Rules | Lands with |
|---|---|
| S1, S10, S11, S13 (authorisation table, sign-in, browser hardening, deletion) | Milestone 2: accounts and roles |
| S5 (attachment risk flags, `nosniff`), browser tests of the mail frame | Milestone 1, remaining work |
| S8, S9, S12 (one send path, confirmation for agent sends, constrained outbound requests) | Milestone 2 and 3 |
| S18 (audit records and the release gate; the skill and the hash check exist) | Before v0.1 |
| D2, D3, D8, D9, D10, D13 (schemas at every entry point, migration tests, message keys, design lint, drift check, budgets) | Milestones 1 to 3 |

### Known debt and known gaps

Debt from the seed, recorded in `ratchets.json` and the `overrides` of `biome.json`:

- Explicit `any` in the agent code (`workers/agent/`, `app/components/AgentPanel.tsx`), non-null assertions in the API routes, a few accessibility and hook-dependency findings in the UI.
- `workers/durableObject/index.ts` is above the 800-line limit.

Gaps that are open on purpose until their milestone, all behind features that are off by default or absent:

- **With MCP on, the `send_reply` and `send_email` tools send without a person's confirmation** (rule S9), and the tool send path does not use the per-mailbox send cap. MCP is off by default; do not turn it on for real mail before this is fixed.
- The mailbox list reads one R2 page (1,000 entries); the D1 index of milestone 2 replaces it.
- Search builds `LIKE` patterns from user text, and Durable Object SQL caps a pattern at 50 bytes; FTS5 replaces it in milestone 3.
- The agent's model ids are not verified against current Workers AI pages (two ledger entries are unverified; one id is a deprecated alias). The agent is off by default.

## When unsure

Read [docs/adr/README.md](docs/adr/README.md) and [docs/engineering-rules.md](docs/engineering-rules.md). If a rule seems wrong, raise it (rule id, need, proposal) and change the rule together with its check; never skip it silently.
