# ADR-0017: The repository opens before the name is reviewed

- Status: **Accepted**
- Date: 2026-11-18
- Decided by: Halil (@madraka), project lead
- Amends: [ADR-0001](0001-founding-decisions.md), decision 8, and the third consequence of [ADR-0003](0003-project-home-on-cloudhal-dev.md). Neither file is changed; this record is where the change is.

## Context

ADR-0001 (decision 8) made the repository public only after the name "Podbay" had passed a domain and trademark check, and ADR-0003 repeated it: the review "still happens before the repository becomes public". The review ([issue #4](https://github.com/cloudhal-dev/podbay/issues/4)) is not done.

Keeping the repository private had a cost. The organisation is on GitHub's free plan, and on that plan the protections the project depends on exist only for a public repository. GitHub refused each of them for this repository on 2026-11-18 ([repository](../repository.md), section 3 as it stood): the rulesets for `main` and for release tags, secret scanning with push protection, private vulnerability reporting and code scanning. While it was private, `main` was guarded by review alone (rule S16 in the [status](../status.md), section 2).

## Decision

1. **The repository is public from 2026-11-18**, before the name review is done.
2. **The name review is done before version 0.1 is released.** No release, tag or package is published under the name until the review is closed with its outcome written on issue #4.
3. **If the review fails, the project is renamed** by a new decision, before any release.

## What is not decided here

- The outcome of the review, or a new name.
- Where the project is published or announced. Nothing is published yet, and the project's home is still the one in ADR-0003.

## Consequences

- The protections GitHub offers a public repository are on from the day it opened, and [repository](../repository.md) records them with the date they were checked.
- Anything pushed, and every issue, pull request and comment, is public from that day. The rules that already held for that are unchanged: no other mail product is named, and no real mail, address or token goes into the repository or its tracker.
- The name is used in public before it is cleared. If it has to change, the repository, the package name, the project's home and the documents change with it, and links to the old name may break. That cost is accepted, and it is smallest before a release.
- The release gate gains one condition. Issue #4 is closed before version 0.1, alongside the full security audit ([security records](../security/README.md)).

## Triggers

Look at this again if:
- the review finds a conflict;
- a release is planned before the review is closed;
- someone outside the project raises the name.
