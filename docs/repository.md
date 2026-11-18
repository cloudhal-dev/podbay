# Podbay: the repository and its settings

- Companion to [`GOVERNANCE.md`](../GOVERNANCE.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the [status](status.md).
- Question answered here: where the repository lives, which settings guard it and which are in force today.

The repository is `github.com/cloudhal-dev/podbay`. Settings live on GitHub, not in the tree, so this page is their record: change the setting and this page in the same sitting. Last checked against GitHub's API: 2026-11-18.

## 1. Public since 2026-11-18

The repository is **public**. It opened before the name "Podbay" had its trademark review: [ADR-0017](adr/0017-the-repository-opens-before-the-name-is-reviewed.md) amends ADR-0001 (decision 8) and ADR-0003 so that the review ([issue #4](https://github.com/cloudhal-dev/podbay/issues/4)) is done before version 0.1 is released. If the review fails, the project is renamed by a new decision before any release.

Everything pushed, every issue, pull request and comment is public. No other mail product is named, and no real mail, address or token goes into the repository or its tracker.

## 2. In force today

| Setting | Value | Why |
|---|---|---|
| Ruleset `main` | `main` cannot be deleted or force-pushed. A change arrives by pull request, merged with a merge commit, with a review from an owner of the code for the paths in [`.github/CODEOWNERS`](../.github/CODEOWNERS) and every conversation resolved. Five checks must be green: `pnpm check (Node 24)`, `pnpm check (Node 26)`, `pnpm e2e (browser)`, `commits (form and sign-off)` and `dependency review`. Code scanning must find no new security alert of level high or above and no new error. A repository administrator may merge their own pull request without the review; nobody can push past the pull request | Rule S16; [`.github/rulesets/main.json`](../.github/rulesets/main.json) |
| Ruleset `release tags` | A tag cannot be moved or deleted, by anyone | [`.github/rulesets/release-tags.json`](../.github/rulesets/release-tags.json) |
| Merging | Merge commits only; squash and rebase are off. Auto-merge is on: a pull request merges by itself once its requirements are met | A change keeps its commits and their messages |
| Branches | Deleted when their pull request merges; "Update branch" offered | |
| Sign-off | Required for commits made on the web | Every commit carries `Signed-off-by` ([`CONTRIBUTING.md`](../CONTRIBUTING.md)) |
| Secret scanning | On, with push protection: a push that carries a known kind of credential is refused | Rule S6 |
| Private vulnerability reporting | On: the form [`SECURITY.md`](../SECURITY.md) links to | |
| Code scanning | Default setup, query suite `extended`, for the workflows and for JavaScript and TypeScript, on `main` and on every pull request | Rule S16 |
| Workflows from forks | Wait for a maintainer's approval for every outside contributor (`all_external_contributors`), not only the first time | Rule S16 |
| Actions that may run | GitHub's own and `pnpm/action-setup`, each pinned by full commit id; GitHub refuses a workflow that is not | Rule S16 |
| The workflow token | Read-only by default; workflows cannot approve pull requests | Rule S16 |
| Runners | GitHub's hosted standard runners only. The repository has no self-hosted runner and must never get one while it is public: a pull request from anyone could run code on it | Rule S16 |
| Artifacts and logs | Kept 90 days, the most GitHub allows | |
| Releases | Immutable releases are on. The environment `release` needs a review from the project lead and deploys only from tags `v*`; nothing uses it yet: it is for the release workflow ([issue #21](https://github.com/cloudhal-dev/podbay/issues/21)) | Rule S16 |
| Dependabot | Alerts and security updates on; weekly version updates by [`.github/dependabot.yml`](../.github/dependabot.yml) | Rules V2 and S15 |
| Issues and discussions | Issues through two forms; blank issues are off, and a vulnerability is sent to the private report. Questions go to [Discussions](https://github.com/cloudhal-dev/podbay/discussions) | [`SECURITY.md`](../SECURITY.md) |
| Wiki and projects | Off | Documents live in `docs/`, where the checks read them |

The checks of [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) run on every pull request and every push to `main`: `pnpm check` and `pnpm test:workerd` on two versions of Node, and `pnpm e2e`. They use no secret and no account. On 2026-11-18 the Actions cache of the repository held about 1.1 GB.

## 3. Asked for and not given

Asked for on 2026-11-18 and still off afterwards, because GitHub does not give them to this repository:

- secret scanning for patterns that belong to no provider (generic passwords and keys);
- validity checks of the credentials secret scanning finds.

## 4. How it opened, and what is still open

On 2026-11-18 the repository was made public. The two rulesets were created from their files, and the settings of section 2 were turned on. Right after the visibility changed, GitHub refused the rulesets for some seconds ("Repository has been locked") and took them on the second try. The first code scanning run found twenty alerts, none of them a vulnerability: eleven in tests and tooling were dismissed with their reason on the alert, and nine are corrected by [pull request #60](https://github.com/cloudhal-dev/podbay/pull/60).

Still open:

- **Two-factor sign-in is not required by the organisation.** It is the project lead's setting, for the whole organisation.
- **The name review** ([issue #4](https://github.com/cloudhal-dev/podbay/issues/4)), before version 0.1 ([ADR-0017](adr/0017-the-repository-opens-before-the-name-is-reviewed.md)).
- **The files of the rulesets are a record, not the source.** Nothing compares them with what GitHub holds; they are compared by hand against `gh api repos/cloudhal-dev/podbay/rulesets/<id>` when either changes.

## 5. Labels and milestones

Issues carry one kind (`bug`, `enhancement`, `documentation`, `tests`), the areas they touch (`area: app`, `area: worker`, `area: mailbox`, `area: auth`, `area: assistant`, `area: release`, `area: repository`), and where they apply `security`, `i18n`, `decision` (a decision record comes before code) and `needs lead` (only the project lead can close it). A new issue starts with `triage`.

Milestones follow the [roadmap](roadmap.md): "Before the repository is public", then its milestones 2, 3 and 4, then phase B. The roadmap gives the order; an issue carries the detail.
