# Podbay: the repository and its settings

- Companion to [`GOVERNANCE.md`](../GOVERNANCE.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the [status](status.md).
- Question answered here: where the repository lives, which settings guard it, which are in force today, and what is done on the day it becomes public.

The repository is `github.com/cloudhal-dev/podbay`. Settings live on GitHub, not in the tree, so this page is their record: change the setting and this page in the same sitting. Last checked against GitHub: 2026-11-18.

## 1. Private until the name is reviewed

The repository is **private**. [ADR-0001](adr/0001-founding-decisions.md) (decision 8) and [ADR-0003](adr/0003-project-home-on-cloudhal-dev.md) hold the public launch until the name "Podbay" has had a trademark review. Opening the repository is the project lead's step and nobody else's.

The organisation is on GitHub's free plan. On that plan several protections exist only for public repositories. Each one in section 3 was asked for on 2026-11-18 and refused by GitHub for this repository while it is private; they are written down here and applied when it opens.

## 2. In force today

| Setting | Value | Why |
|---|---|---|
| Merging | Merge commits only; squash and rebase are off | A change keeps its commits and their messages |
| Branches | Deleted when their pull request merges; "Update branch" offered | |
| Sign-off | Required for commits made on the web | Every commit carries `Signed-off-by` ([`CONTRIBUTING.md`](../CONTRIBUTING.md)) |
| Wiki and projects | Off | Documents live in `docs/`, where the checks read them |
| Actions that may run | GitHub's own and `pnpm/action-setup`, each pinned by full commit id; GitHub refuses a workflow that is not | Rule S16 |
| The workflow token | Read-only by default; workflows cannot approve pull requests | Rule S16 |
| Dependabot | Alerts and security updates on; weekly version updates by [`.github/dependabot.yml`](../.github/dependabot.yml) | Rules V2 and S15 |
| Issues | On, through two forms; blank issues are off, and a vulnerability is sent to the private report | [`SECURITY.md`](../SECURITY.md) |

The checks of [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) run on every pull request and every push to `main`: `pnpm check` and `pnpm test:workerd` on two versions of Node, and `pnpm e2e`. They use no secret and no account.

## 3. Applied when the repository is public

| Protection | What it does | Where it is written |
|---|---|---|
| Ruleset `main` | `main` cannot be deleted or force-pushed. A change arrives by pull request, with a review from an owner of the code for the paths in [`.github/CODEOWNERS`](../.github/CODEOWNERS), every conversation resolved, and the three checks green. A repository administrator may merge their own pull request without the review, never push past one | [`.github/rulesets/main.json`](../.github/rulesets/main.json) |
| Ruleset `release tags` | A tag cannot be moved or deleted, by anyone | [`.github/rulesets/release-tags.json`](../.github/rulesets/release-tags.json) |
| Secret scanning with push protection | A push that carries a known kind of credential is refused | A repository setting |
| Private vulnerability reporting | The form `SECURITY.md` links to | A repository setting |
| Code scanning | Static analysis of `main` and of every pull request | A repository setting (default setup) |
| Approval for workflows from forks | A first pull request from outside does not run a workflow until a maintainer allows it | A repository setting |
| Auto-merge | A pull request merges by itself once its requirements are met | A repository setting |

## 4. The day it opens

In order, by the project lead or with their word:

1. The name review is closed, with its outcome written on its issue.
2. Read the tracked files and the history once more: `pnpm static secrets`, `pnpm static names`, and `git log --format='%ae %ce' | sort -u` shows no private address.
3. Make the repository public.
4. Create the two rulesets from their files:

   ```bash
   gh api -X POST repos/cloudhal-dev/podbay/rulesets --input .github/rulesets/main.json
   gh api -X POST repos/cloudhal-dev/podbay/rulesets --input .github/rulesets/release-tags.json
   ```

5. Turn on secret scanning with push protection, private vulnerability reporting, code scanning, the approval for workflows from forks, and auto-merge.
6. Open `SECURITY.md`'s report link while signed out of the organisation and see the form.
7. Change sections 1 to 3 of this page to what is now true, with the date, in a pull request: the first one the ruleset checks.

## 5. Labels and milestones

Issues carry one kind (`bug`, `enhancement`, `documentation`, `tests`), the areas they touch (`area: app`, `area: worker`, `area: mailbox`, `area: auth`, `area: assistant`, `area: release`, `area: repository`), and where they apply `security`, `i18n`, `decision` (a decision record comes before code) and `needs lead` (only the project lead can close it). A new issue starts with `triage`.

Milestones follow the [roadmap](roadmap.md): "Before the repository is public", then its milestones 2, 3 and 4, then phase B. The roadmap gives the order; an issue carries the detail.
