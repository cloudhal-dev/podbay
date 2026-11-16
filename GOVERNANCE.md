# Governance

## Current model: project lead and maintainers

Podbay is in its founding phase and is part of the Cloudhal project. **Halil (@madraka)** is the project lead, with final say on scope, architecture and releases. This is explicitly temporary: the goal is a maintainer team with documented, distributed authority before 1.0.

## Roles

| Role | How you get there | What you can do |
|---|---|---|
| Contributor | Open a pull request | Everything in `CONTRIBUTING.md` |
| Maintainer | Sustained, high-quality contributions in one area; nominated by a maintainer, approved by the lead | Review and merge in that area, triage issues |
| Lead | — | Final decisions, releases, security response |

## Decision process

- **Small changes**: pull request and review.
- **Significant changes** (a contract, a persisted format, a sticky name such as a binding, a queue or a Durable Object class, the access model, or licensing): an **RFC** in `docs/rfcs/NNNN-title.md`, opened as a pull request, then accepted or rejected by the lead with a written rationale.
- **Architecture decisions** are recorded as **ADRs** in `docs/adr/` and are immutable once accepted.

## Licence commitment

Code in this repository stays Apache-2.0, and no feature is gated behind a licence key. Changing either requires an RFC and is expected never to happen.
