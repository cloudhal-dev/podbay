# ADR-0003: Project home is podbay.cloudhal.dev; nothing runs under cloudhal.com

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead
- Supersedes: [ADR-0002](0002-project-home.md)

## Context

ADR-0002 put Podbay's home at `podbay.cloudhal.com`. The Cloudhal project owns two domains: `cloudhal.com`, the marketing site and the home of its hosted services, and `cloudhal.dev`, the developer site. Three things make the first a poor home for Podbay:

- **Same site.** A browser treats every subdomain of `cloudhal.com` as the same site. Podbay renders mail written by strangers. A running Podbay under `cloudhal.com` would sit on the same site as services that hold sign-in sessions, so a flaw in Podbay could reach past its own origin: same-site requests carry `SameSite` cookies, and a subdomain can set cookies for the parent domain.
- **Mail reputation.** `cloudhal.com` sends the project's own service mail. Test sending and receiving for Podbay must not share that domain's reputation.
- **Audience.** Podbay's home is documentation, a setup guide and a demo for people who deploy it. That is what `cloudhal.dev` is for.

## Decision

1. **Podbay's home is `https://podbay.cloudhal.dev`**: the project site, the documentation and the setup guide.
2. **Demos, trial instances and test mail domains live under `cloudhal.dev`**, never under `cloudhal.com`.
3. **No running Podbay instance is ever served from `cloudhal.com` or a subdomain of it.** A static product page on the marketing site that links to the home is fine, because it runs no Podbay code.
4. Security and conduct contact addresses stay on `cloudhal.com`, as in `SECURITY.md` and `CODE_OF_CONDUCT.md`.

## Consequences

- The package manifest and the README name `podbay.cloudhal.dev`. Nothing is published there yet, and no document says otherwise until it is.
- Rule 3 is checked: `pnpm static hosts` fails when a deployment configuration or a workflow names a `cloudhal.com` host.
- The trademark review of the name "Podbay" is unchanged: it still happens before the repository becomes public (ADR-0001, decision 8).
- `cloudhal.dev` is already on Cloudflare DNS and serves the developer site; `podbay.cloudhal.dev` did not resolve on 2026-11-17, so the name is free to create.
