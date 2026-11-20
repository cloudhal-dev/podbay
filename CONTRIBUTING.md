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

Run `pnpm install` again after you pull a change to `pnpm-workspace.yaml` or any `package.json`. The code shared by the parts of the product lives in workspace packages under `packages/`, and pnpm links each one into `node_modules` only when it installs. Until it does, a new package does not resolve: the dev server answers 500, and the type check and tests fail to find it.

The two slower suites run in CI on every pull request; run them yourself when you touch what they prove:

```bash
pnpm test:workerd   # the handlers in the real Workers runtime, every binding local
pnpm e2e            # the built app in a real browser, on its own throwaway instance
```

## Before you start

- **A bug**: open an issue with the steps that show it. Never paste real mail, real addresses or a token.
- **A vulnerability**: never in an issue. Follow [`SECURITY.md`](SECURITY.md).
- **A feature**: look at the [roadmap](docs/roadmap.md) and the open [issues](https://github.com/cloudhal-dev/podbay/issues) first. For anything larger than a small fix, open an issue and agree on the shape before writing code. A change to a contract, a stored format, a sticky name or the access model needs a decision first ([`GOVERNANCE.md`](GOVERNANCE.md)).
- Everyone taking part follows the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Rules

Read [`AGENTS.md`](AGENTS.md) first. It is one page for people and coding agents alike: the rules, the commands, and which skill in `.claude/skills/` describes each kind of work (start with `podbay-change`). Where the project is going is [`docs/roadmap.md`](docs/roadmap.md); what is enforced today is [`docs/status.md`](docs/status.md). Every rule on that page is enforced by a check in `pnpm check`. The full text is [`docs/engineering-rules.md`](docs/engineering-rules.md). Three that surprise people:

- **Original work only.** Do not bring code, schema, tests, text or assets from any other mail product, and do not add a dependency under AGPL or GPL. Files that came from the seed are listed in `copies.json`.
- **A change to a trust boundary ships a regression test** (sign-in, authorisation, mail rendering, attachments, the sender check, the agent and MCP, tokens, exports, CI and releases).
- **Cloudflare facts come from current sources**, with the URL and date recorded, never from memory.

## Pull requests

- Branch from `main`; keep pull requests focused.
- **Conventional commits**: `feat(inbox): …`, `fix(worker): …`, `docs: …`, `chore: …`.
- **DCO sign-off**: every commit needs `Signed-off-by:`; use `git commit -s`. This certifies the [Developer Certificate of Origin](https://developercertificate.org/); there is no CLA.
- CI checks both on every commit of a pull request (the job `commits (form and sign-off)`). A revert is written `revert: …`: the subject GitHub and `git revert` write by themselves (`Revert "…"`) does not pass. Run it yourself with `node scripts/commits.ts $(git merge-base origin/main HEAD)..$(git rev-parse HEAD)`.
- `pnpm check`, `pnpm test:workerd` and `pnpm e2e` must be green; CI runs all three.
- `main` takes changes through pull requests only, and an owner of the code in [`.github/CODEOWNERS`](.github/CODEOWNERS) reviews the paths listed there.
