# ADR-0002: Project home is podbay.cloudhal.com

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead
- Amends: [ADR-0001](0001-founding-decisions.md), decision 8 (the repository becomes public after the name's domain and trademark check)

## Context

ADR-0001 held the public launch until the name's domain and trademark had been checked. Podbay is part of the Cloudhal project, which already owns `cloudhal.com`.

## Decision

Podbay's home is **`https://podbay.cloudhal.com`**: the website, the documentation and any hosted demo live there. No separate domain is registered for the name.

## Consequences

- **The domain half of the name check is settled.** A subdomain of the project's own domain needs no availability check and no purchase.
- **The trademark half remains.** Using a subdomain does not answer whether "Podbay" can be used as a product name. That review still happens before the repository becomes public.
- The package manifest names the home page. Nothing is published there yet, and no document should say otherwise until it is.
- Security and conduct contacts stay on `cloudhal.com` addresses, as in `SECURITY.md` and `CODE_OF_CONDUCT.md`.
