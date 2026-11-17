# Podbay

Self-hosted mail that runs entirely in your own Cloudflare account. Email Routing brings mail in, Email Sending sends it out, each mailbox is a Durable Object, and messages stay in your account.

> **Status: early development.** Sign-in, per-mailbox access and the mail renderer exist and are tested; invitations, queues, search and releases do not yet. Nothing here is ready for real mail.

## Try it locally

No Cloudflare account is needed. Local development uses simulated mail and never sends anything.

```bash
pnpm install
pnpm dev        # http://localhost:5173; then open /setup with the token from .dev.vars
pnpm check      # lint, static checks, typecheck, unit tests, build
```

See [`AGENTS.md`](AGENTS.md) for the layout, the commands and the rules, and [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.

## Documents

- [Architecture](docs/architecture.md): what Podbay is, its components, the installer contract and the roadmap.
- [Feature scope and phases](docs/feature-scope.md): the experience bar, the feature matrix, the design principles.
- [Sign-in and access](docs/auth-and-access.md): accounts, roles, mailbox memberships, credentials for programs.
- [Engineering rules](docs/engineering-rules.md): the version policy, the security rules and the developer rules, each with its automated check.
- [Decisions](docs/adr/README.md).

## Home

The project's home is `podbay.cloudhal.dev` ([ADR-0003](docs/adr/0003-project-home-on-cloudhal-dev.md)). Nothing is published there yet.

## Origin

Podbay starts from Cloudflare's [`agentic-inbox`](https://github.com/cloudflare/agentic-inbox) reference app. See [`NOTICE`](NOTICE).

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
