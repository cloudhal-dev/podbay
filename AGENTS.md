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
pnpm static [name]    # one static check: pins, copies, licences, names, imports, docs, ratchets
node scripts/pins.ts --resolve [names]   # newest stable version that is at least 3 days old (network, read-only)
pnpm pins:outdated                       # pins that are behind (network, read-only)
node scripts/checks/copies.ts --fix      # after editing a seed file: set its status and add the notice
node scripts/checks/ratchets.ts --update # after paying down debt: lower the baseline (never raise it)
```

Deliver a test message to the local server:

```bash
curl -X POST 'http://localhost:5173/cdn-cgi/handler/email?from=a@sender.test&to=hello@example.com' --data-binary @message.eml
```

## Layout

- `workers/` — the Worker: `app.ts` (entry, `fetch` and `email`), `index.ts` (API routes and inbound mail), `durableObject/` (`MailboxDO`), `lib/` (pure helpers: `inbound.ts`, `filenames.ts`, `features.ts`), `agent/` and `mcp/` (optional features).
- `app/` — the single-page app: `router.tsx` (the route tree), `routes/`, `components/`, `queries/` (TanStack Query), `services/api.ts`.
- `shared/` — code both sides import. No Node-only and no browser-only API.
- `test/unit/` — tier 0, pure code in Node. `test/workerd/` — tier 3, the Workers runtime.
- `scripts/` — Node-only tooling: `pins.ts`, `check-static.ts`, `checks/`.
- `docs/` — architecture, feature scope, sign-in and access, engineering rules, ADRs.

## Hard rules

Short form; the full text and the reason for each is in [docs/engineering-rules.md](docs/engineering-rules.md). **A rule without an automated check is not a rule**, so the table under it says which checks exist today.

1. **Latest, pinned.** Every dependency is one exact stable version, at least three days old when installed. A 0.x package needs a dated `pinExceptions` entry in `package.json`. (V1, V3, V6)
2. **Original work only.** No code, schema, test, text, translation or asset from any other mail product, and no other product named in this repository. No dependency under AGPL or GPL. A file that came from the seed stays listed in `copies.json`; when you change one, run `node scripts/checks/copies.ts --fix`. (S17, S15)
3. **Mail is hostile bytes.** Route by the envelope recipient, never by a header. A name or id from a message or a request never becomes a storage key without going through `workers/lib/inbound.ts` or `workers/lib/filenames.ts`. (S2, S3)
4. **Optional features are off by default.** The agent and MCP run only when `AGENT_ENABLED` or `MCP_ENABLED` is exactly `"true"`. Tests and local development never call a model or send real mail. (D7)
5. **A change to a trust boundary ships a regression test**: sign-in, authorisation, mail rendering, attachments, the sender check, the agent and MCP, tokens, exports, CI and releases. (S18)
6. **Cloudflare facts come from current sources**, never memory: the docs page as `index.md`, the OpenAPI document, the changelog, with the URL and the date in the change. (V5)
7. **Dependency direction.** The UI never imports Worker code; the Worker never imports the UI; Worker-reachable code imports no Node-only module. (D5)
8. **Debt only shrinks.** `ratchets.json` records lint warnings, `console.*` calls and oversized files. Lower it when you pay debt down; never raise it. New files get no exemption. (D1, D4, S7)
9. **Conventional commits, signed off** (`git commit -s`). A contract, a persisted format or a sticky name (a binding, a queue, a Durable Object class) needs an RFC first. (D12)

### What is enforced today

| Check | Rules | Where |
|---|---|---|
| Exact pins, 0.x exceptions | V1, V3 | `pnpm static pins`, unit tests |
| Minimum release age | V6 | `pnpm-workspace.yaml` (`minimumReleaseAge`) |
| Copied files listed, modified ones marked | S17 | `pnpm static copies` |
| Licence allow-list over every installed package | S15, S17 | `pnpm static licences` |
| No other mail product named | S17 | `pnpm static names` |
| Dependency direction | D5 | `pnpm static imports` |
| Markdown links and anchors | D14 | `pnpm static docs` |
| Lint warnings, `console.*` calls, file size: only down | D1, D4, S7 | `pnpm static ratchets` |
| Lint errors, formatting | D1 | `pnpm lint` |
| Types | D1 | `pnpm typecheck` |
| Envelope routing, file names, feature switches, sender check | S2, S3, S8, D7 | `test/unit/`, `test/workerd/` |
| Actions pinned by commit, read-only token | S16 | `.github/workflows/checks.yml` (by review until the workflow lint lands) |

### Not enforced yet

These rules are accepted but their checks land with the code they guard. Until then they are review rules, and a change that touches the area must not make them harder to meet.

| Rules | Lands with |
|---|---|
| S1, S10, S11, S13 (authorisation table, sign-in, browser hardening, deletion) | Milestone 2: accounts and roles |
| S4, S5 (one HTML renderer with remote content blocked, attachment risk flags) | Milestone 1, remaining work |
| S6 (secret scanning), V2 and V4 (update bot, monthly compatibility date) | Milestone 1, remaining work |
| S8, S9, S12 (one send path, confirmation for agent sends, constrained outbound requests) | Milestone 2 and 3 |
| S14 (no account credential: static check on bindings and outbound hosts) | Milestone 1, remaining work |
| S18 (vendored security skill, audit records) | Milestone 1, remaining work |
| D2, D3, D8, D9, D10, D13 (schemas at every entry point, migration tests, message keys, design lint, drift check, budgets) | Milestones 1 to 3 |

### Known debt from the seed

Recorded in `ratchets.json` and in the `overrides` of `biome.json`: explicit `any` casts around Durable Object calls, non-null assertions in the API routes, a few accessibility and hook-dependency findings in the UI, `console.*` calls, and `workers/durableObject/index.ts` above the 800-line limit. Paying these down is part of milestone 1.

## When unsure

Read [docs/adr/README.md](docs/adr/README.md) and [docs/engineering-rules.md](docs/engineering-rules.md). If a rule seems wrong, raise it (rule id, need, proposal) and change the rule together with its check; never skip it silently.
