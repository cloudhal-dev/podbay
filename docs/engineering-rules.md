# Podbay: engineering rules

- Status: **Accepted** (2026-11-17, [ADR-0001](adr/0001-founding-decisions.md)). Companion to the [architecture](architecture.md), the [feature scope](feature-scope.md) and [sign-in and access](auth-and-access.md). [`AGENTS.md`](../AGENTS.md) carries the short form; this file is the full text.
- Intent: every version is the latest, and security and developer rules are controlled end to end, in every area of the repository.
- Principle: **a rule without an automated check is not a rule.** Every rule below names what enforces it. Where only review can enforce it, the table says so. The checks exist in CI before the first feature is merged.

## 1. Version policy: latest, pinned, kept latest

| Rule | Enforcement |
|---|---|
| **V1.** Every dependency starts at its latest stable version and is pinned exactly in one place: the catalog of `pnpm-workspace.yaml`, which every package of the workspace names as `catalog:` | The pins check reads every package and fails on a range or a pre-release in the catalog and on a version written in a package |
| **V2.** Updates arrive as automated weekly pull requests. A new major is adopted within 30 days or gets a dated exception in the catalog. A security fix is merged within 48 hours | Update bot; a scheduled job fails when a pin is more than one major behind without an exception |
| **V3.** No pre-release package in production dependencies without a written exception | The pins test rejects `-alpha`, `-beta`, `-rc` and `0.0.x` versions that are not on the exception list |
| **V4.** The Workers `compatibility_date` moves forward every month, with the full test run | Scheduled job opens the pull request |
| **V5.** Cloudflare facts come from current sources, never memory: docs `index.md`, the OpenAPI document, the changelog. Each is recorded in a ledger with URL, date and quote | A static check fails on a Cloudflare surface in the code without a ledger entry (a rule Cloudhal's other repositories already run) |
| **V6.** A new version must be at least a few days old before it is installed | The package manager's minimum release age setting |

Latest stable versions read from the npm registry and Node's release index on 2026-11-16 UTC:

| Package | Seed (`agentic-inbox`) | Latest | Cloudhal catalog |
|---|---|---|---|
| Node (tooling) | 20 types | 26.13.1 LTS | 24 |
| pnpm | npm | 12.21.0 | 12 |
| TypeScript | ^5.8.3 | 7.0.2 | 7.0.2 |
| Vite | ^6.3.3 | 8.3.8 | 8.3 |
| React | ^19.1.0 | 19.3.1 | 19.3 |
| Router | `react-router` ^7.5.3 | `@tanstack/react-router` 1.170.46 | 1.170 |
| `@tanstack/react-query` | ^5.99.0 | 5.107.1 | 5.104 |
| zod | ^3.25.76 | 4.6.7 | 4.6.7 |
| Hono | ^4.7.11 | 4.13.19 | 4.13 |
| `@cloudflare/kumo` | ^1.13.0 | 2.19.0 | ^2.14.0 |
| Tailwind | ^4.1.4 | 4.3.5 | 4.3 |
| wrangler | ^4.74.0 | 4.163.0 | 4.158.0 |
| `@cloudflare/workers-types` | ^4.20251128.0 | 5.20261116.1 | ^5.20261007.1 |
| `@cloudflare/vitest-plugin` | none | 1.8.3 | 1.6.0 |
| Vitest | none | 5.1.0 | 5.1.0 |
| Biome | none | 2.6.8 | 2.6.6 |
| `@playwright/test` | none | 1.65.1 | 1.64.1 |
| Better Auth | none | 1.7.25 | 1.7.18 |
| `agents` | ^0.7.6 | 0.33.0 | not used |
| `ai` | ^6.0.116 | 7.0.173 | not used |
| `@cloudflare/ai-chat` | ^0.1.8 | 0.12.2 | not used |
| `postal-mime` | ^2.6.1 | 4.2.1 | not used |
| DOMPurify | ^3.3.3 | 3.4.18 | not used |
| TipTap | 3.20.2 | 3.34.0 | not used |

Two notes. The seed is far behind on the agent stack (`agents` 0.7 to 0.33, `ai` 6 to 7, `postal-mime` 2 to 4), so the upgrade is real work in the bootstrap milestone. And `agents` and `@cloudflare/ai-chat` are still 0.x, so they go on the V3 exception list, and the product must work with the agent switched off.

## 2. Security rules

| Rule | Enforcement |
|---|---|
| **S1. Deny by default.** Every route, MCP tool, queue consumer and agent connection declares who may call it in one table. A caller without a membership of the mailbox gets 404 | A test enumerates every registered route and tool and fails on one that is missing from the table; a test per entry calls it as a non-member |
| **S2. No storage key from input.** A mailbox, message or attachment id from a request is resolved through the index to an opaque id before it touches D1, a Durable Object name or an R2 key | Static check on key-building call sites; path-traversal cases in the route tests |
| **S3. Mail is hostile bytes.** Parsing happens only in the queue consumer, with size and time bounds, and its output is validated before it is stored | A corpus of malformed and hostile messages runs in CI; a static check forbids the parser import elsewhere |
| **S4. One renderer for mail HTML.** Sanitised, in a sandboxed frame without same-origin access, under a strict content policy, with remote content blocked until the user allows it | Lint error on `dangerouslySetInnerHTML` and `innerHTML` outside the renderer; browser tests with the hostile corpus assert that no script runs and no request leaves |
| **S5. Attachments are downloads.** Served with `Content-Disposition: attachment` and `nosniff`; risky types are flagged and need an acknowledgement that the server enforces | Route tests per risky type; a direct link without the acknowledgement must fail |
| **S6. No secret in the repository, a fixture, a log or a test snapshot.** Test values are generated per run | Secret scanning in CI and before commit; a scan over test output |
| **S7. Logs carry no mail.** Only one module may write logs. No body, subject or address is logged, only opaque ids | Lint error on `console.*` elsewhere; a test feeds marked content through every handler and scans the log output |
| **S8. One sender check.** A message leaves only if `From` belongs to a mailbox the caller may send as, and the per-mailbox and per-instance caps allow it | Every send path goes through one function, proven by a static check; tests for each refusal |
| **S9. Agents and MCP cannot send alone.** They hold the caller's rights only, never another mailbox, and a send or forward needs a human confirmation in the UI: today neither has a send tool at all, and a person sends the draft. Mail content given to a model is data, never instructions; the injection scan is advisory | Tool tests as a non-member; a test proving that no tool reaches the send function without a confirmation token |
| **S10. Strong sign-in.** Better Auth for identity, Podbay's own `authorize` for access ([sign-in and access](auth-and-access.md)). Passkeys and an authenticator app; invitation only; step-up for sensitive changes; rate limits on every authentication route; a closed instance until the guarded first-owner call. Managing is not reading | Route tests; rate-limit tests; a test that an instance without an owner refuses everything but health and the guarded call; a test that an administrator without a membership cannot open a mailbox |
| **S11. Browser hardening.** A content policy for the app itself, `frame-ancestors 'none'`, HSTS, same-site cookies, and an Origin check on every state-changing request | A test asserts the headers on every response class and rejects a cross-origin mutation |
| **S12. Outbound requests are constrained.** A server-side request to a user-supplied address (webhook, image proxy) goes only to a public https host and follows no redirect | One fetch helper; a static check forbids bare `fetch(` outside an allow-list; tests with private addresses and redirects |
| **S13. Deletion deletes.** Removing a message or a mailbox removes its rows, its Durable Object data and its R2 objects | A test deletes and then lists every store for leftovers |
| **S14. No Cloudflare account credential.** The Worker has bindings only and calls no Cloudflare REST API | Static check on the bindings list and on outbound hosts |
| **S15. Supply chain.** Frozen lockfile; vulnerability audit; a licence allow-list that rejects AGPL and GPL; minimum release age | CI jobs; the licence check fails the build |
| **S16. CI and releases.** Actions pinned by commit; least-privilege tokens; no secret for fork pull requests; no job on a self-hosted runner, only on runners GitHub hosts; releases built once, attested and signed; code owners on security-sensitive paths; protected main branch | Workflow lint in CI; repository settings recorded in a checked file |
| **S17. Original work only.** No code, schema, test, UI text, translation or asset from any other mail product. Every file copied from the seed, `agentic-inbox`, keeps its header and is listed with its commit | The licence check, `copies.json` with a check, a pull-request checkbox (review) |
| **S18. Security governance.** Cloudflare's `security-audit` skill is vendored unedited; a `podbay-security` skill names the trust boundaries. A change to a boundary ships a regression test. A full audit runs before v0.1, before every release that changes a boundary, and quarterly. A confirmed critical or high finding blocks the release | Vendored-file hash check; audit records in `docs/security/`; the release workflow requires a current audit record |

The trust boundaries S18 refers to: inbound mail bytes; mail HTML and attachments in the browser; sign-in, sessions and step-up; per-mailbox authorisation; the agent and MCP; the outbound sender; the operator and setup tokens; queues and exports; dependencies; CI and release.

## 3. Developer rules

| Rule | Enforcement |
|---|---|
| **D1.** TypeScript strict; no `any`, no unchecked cast across a boundary | Compiler flags; lint errors. The seed's `as any` casts are removed in bootstrap |
| **D2.** Schema first. Every HTTP body, queue message, Durable Object call and MCP tool input is validated with a schema that the Worker and the UI share | A test enumerates entry points and fails on one without a schema |
| **D3.** Migrations are additive, numbered and literal SQL, for D1 and for Durable Objects | Tests migrate from empty and from the previous release |
| **D4.** Size ratchet: files at most 800 lines, functions at most 150, nesting at most 5 | A size check that only goes down. The seed's 872-line Durable Object file is split in bootstrap |
| **D5.** Dependency direction: the UI imports shared contracts only; Worker-reachable code imports no Node-only module | Static import check |
| **D6.** Test tiers: unit; D1 and Durable Objects in workerd; route integration; queue and `email` handler semantics in workerd; browser scenarios. Every bug fix lands with a test. The five security modules (authorisation, renderer, sender check, parser, and the rules of a mailbox in `shared/rules.ts`) have full branch coverage | CI jobs; a coverage threshold on those modules, not measured yet ([status](status.md), section 3) |
| **D7.** Every outside call has a fake: the send binding, the model, the queues. Tests and local development never send real mail | A static check that the real binding is reachable only through the adapter |
| **D8.** Every word the app shows is a message: named by its English text and shown through `t()`, `plural()` or `rich()` (`~/i18n`: the runtime is `packages/i18n/`, the catalogs `app/i18n/`), with a translation in every catalog. A sentence is one message, never pieces joined in code | `pnpm static messages`: a message without a translation, a translation without a message, other `{values}`, words bare in markup |
| **D9.** Kumo components only; one design lint; keyboard access and a mobile layout covered by the browser scenarios | Design lint; scenario tests at a phone width |
| **D10.** Generated files are never edited by hand | A drift check regenerates and fails on a difference |
| **D11.** One command, `pnpm check`, runs locally what CI runs | CI calls the same script |
| **D12.** Conventional commits with sign-off; a pull-request template with the security checklist; an RFC for any contract, persisted format or sticky name; ADRs for decisions | Commit lint; template; review |
| **D13.** Budgets: UI bundle size, and CPU time of the `email` handler on the largest allowed message | Budget tests |
| **D14.** Every user-visible feature has a docs page; links resolve | Docs link check |
| **D15. Guidance is checked like code.** `AGENTS.md` is one page for people and coding agents. The method for each kind of work is a skill; a rule scoped to paths names the skill a file needs; subagents review and verify and never edit; the committed settings keep local secrets unread and ask before anything leaves the machine ([ADR-0006](adr/0006-guidance-for-engineers-and-agents.md)) | A static check: every skill and subagent is named in `AGENTS.md`, names match folders, a rule's paths still match files, a subagent names only skills that exist and no editing tool, the settings keep their refusals |
| **D16. The app asks in its own voice.** A question, a warning or a form over the page is a Kumo `LayerDialog`; a confirmation goes through `useConfirm()`. The browser's own `confirm`, `alert` and `prompt` are not used: they block the page, cannot be read or styled, and look like a warning from the browser | A static check over `app/`; the browser tests fail on any browser dialog they did not expect |

## 4. End-to-end coverage: which rule guards which area

| Area of the repository | Rules |
|---|---|
| Worker: HTTP API | S1, S2, S10, S11, D2, D6 |
| Worker: `email` handler and inbound consumer | S2, S3, S7, D2, D6, D13 |
| Mailbox object: outgoing mail, which waits in a row and leaves through the one caller of the send binding ([ADR-0016](adr/0016-outgoing-mail-waits-before-it-leaves.md)) | S8, S9, S14, D7 |
| Durable Objects and D1 | S2, S13, D3, D6 |
| R2: raw messages, attachments, exports | S2, S5, S13 |
| UI | S4, S5, S11, D8, D9, D13, D16 |
| Agent and MCP | S1, S9, D2, D7 |
| Setup and operator surface | S10, S14 |
| Scripts and tooling | S6, D5, D11 |
| Dependencies | V1, V2, V3, V6, S15, S17 |
| Cloudflare surfaces and configuration | V4, V5, S14 |
| CI and releases | S16, S18, D11 |
| Docs | D14, S17 |
| Guidance for engineers and agents (`AGENTS.md`, `.claude/`) | D15, D14 |

No area is left without at least one automated check. A new area added later gets a row here in the same change.

## 5. What is carried over from Cloudhal's other repositories, and what is new

Carried over, adapted: the currency ledger, security governance on the vendored skill, every outside call has a fake, the size ratchet, schema-first contracts, the dependency direction check, the single log module, the test tiers, the drift check, RFCs for sticky names.

New for a mail product: S3, S4 and S5 (hostile mail, the renderer, attachments), S8 and S9 (the sender check and the confirmation rule), S12 (constrained outbound requests), S13 (deletion), S17 (original work only), and the version policy V1 to V6, which is stricter than the Cloudhal catalog: latest, not aligned.
