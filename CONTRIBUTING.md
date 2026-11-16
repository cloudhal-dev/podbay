# Contributing to Podbay

Thanks for considering a contribution. You can go from clone to a green check run **without a Cloudflare account**: tests and local development use fakes and never send real mail.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 or newer (CI runs the latest LTS) | `.node-version` is set |
| pnpm | 12 (via Corepack) | `corepack enable` |

## Setup

```bash
pnpm install
pnpm check      # everything CI runs: lint, static checks, typecheck, tests, build
pnpm dev        # local development with simulated mail
```

## Rules

Read [`AGENTS.md`](AGENTS.md) first. It is one page, and every rule on it is enforced by a check in `pnpm check`. The full text is [`docs/engineering-rules.md`](docs/engineering-rules.md). Three that surprise people:

- **Original work only.** Do not bring code, schema, tests, text or assets from any other mail product, and do not add a dependency under AGPL or GPL. Files that came from the seed are listed in `copies.json`.
- **A change to a trust boundary ships a regression test** (sign-in, authorisation, mail rendering, attachments, the sender check, the agent and MCP, tokens, exports, CI and releases).
- **Cloudflare facts come from current sources**, with the URL and date recorded, never from memory.

## Pull requests

- Branch from `main`; keep pull requests focused.
- **Conventional commits**: `feat(inbox): …`, `fix(worker): …`, `docs: …`, `chore: …`.
- **DCO sign-off**: every commit needs `Signed-off-by:`; use `git commit -s`. This certifies the [Developer Certificate of Origin](https://developercertificate.org/); there is no CLA.
- `pnpm check` must be green.
